import crypto from 'node:crypto';
import fs from 'node:fs';
import { requestContext } from './db.js';
import { HttpError } from './auth.js';

/**
 * In-memory fixed-window rate limiter keyed by client IP (single-process deployment).
 * With skipSuccessful, only responses with status >= 400 count towards the limit.
 */
export function rateLimit({ windowMs, max, skipSuccessful = false, message = 'Too many requests. Please slow down', key = (req) => req.ip }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    if (entry.count >= max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return next(new HttpError(429, message));
    }
    if (skipSuccessful) res.on('finish', () => { if (res.statusCode >= 400) entry.count++; });
    else entry.count++;
    next();
  };
}

/** Conservative security headers. CSP only in production (Vite's dev client needs inline scripts). */
export function securityHeaders({ prod }) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "frame-src 'self' blob: https://api.razorpay.com https://checkout.razorpay.com",
    "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The public impact page may be embedded on the foundation's own website; everything else may not be framed
    const embeddable = req.path === '/impact';
    if (!embeddable) res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'microphone=(), geolocation=(), usb=(), payment=(self "https://api.razorpay.com")');
    // same-origin-allow-popups: Razorpay opens bank / 3-D Secure windows that need window.opener
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (prod) {
      res.setHeader('Content-Security-Policy', embeddable ? csp.replace("frame-ancestors 'none'", 'frame-ancestors *') : csp);
      if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

/** Assigns a request ID, exposes { ip, requestId } to the audit log, and writes one log line per API request */
export function requestLogger({ quiet = false } = {}) {
  return (req, res, next) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    const start = process.hrtime.bigint();
    res.setHeader('X-Request-Id', requestId);
    req.requestId = requestId;
    if (!quiet && req.path.startsWith('/api/')) {
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        console.log(JSON.stringify({
          t: new Date().toISOString(), id: requestId, ip: req.ip, user: req.user?.id ?? null,
          method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms),
        }));
      });
    }
    requestContext.run({ ip: req.ip, requestId }, next);
  };
}

/** Only JSON or multipart bodies are accepted on write requests */
export function requireBodyType(req, _res, next) {
  const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && hasBody && !req.is('application/json') && !req.is('multipart/form-data')) {
    return next(new HttpError(415, 'Send JSON or multipart form data'));
  }
  next();
}

const SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

/** Detect a file's real type from its first bytes (never trust the browser-supplied MIME type) */
export function sniffFileType(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    return SIGNATURES.find((s) => n >= s.bytes.length && s.bytes.every((b, i) => buf[i] === b))?.mime ?? null;
  } finally {
    fs.closeSync(fd);
  }
}

/** Keep only a safe display name: no paths, control or reserved characters */
export function safeFileName(name, fallback = 'file') {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001F\u007F<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  return (base || fallback).slice(-120);
}
