import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from './db.js';

function loadSecret() {
  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return process.env.JWT_SECRET;
  }
  const file = path.join(DATA_DIR, '.jwt-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();
const JWT_OPTS = { algorithm: 'HS256', issuer: 'bana-connect', audience: 'bana-portal' };
export const TOKEN_TTL = '7d';

export const ADMIN_ROLES = ['super_admin', 'admin'];

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

/** Token carries the user's token_version; bumping it revokes every session for that user */
export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version ?? 0 }, SECRET, { ...JWT_OPTS, expiresIn: TOKEN_TTL });
}

/** Short-lived token proving the password step passed, used to finish a two-step sign-in */
export function signChallenge(user) {
  return jwt.sign({ sub: user.id, purpose: '2fa', tv: user.token_version ?? 0 }, SECRET, { ...JWT_OPTS, expiresIn: '5m' });
}
export function verifyChallenge(token) {
  try {
    const p = jwt.verify(String(token || ''), SECRET, { algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: JWT_OPTS.audience });
    return p.purpose === '2fa' ? p : null;
  } catch {
    return null;
  }
}

/** Keyed hash for OTPs, recovery codes and ID-card verification links */
export const hmac = (value) => crypto.createHmac('sha256', SECRET).update(String(value)).digest('hex');

export function revokeSessions(userId) {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
}

const userStmt = db.prepare('SELECT id, role, email, student_code, name, phone, is_active, must_change_password, token_version FROM users WHERE id = ?');

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next(new HttpError(401, 'Please sign in'));
  let payload;
  try {
    payload = jwt.verify(token, SECRET, { algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: JWT_OPTS.audience });
  } catch {
    return next(new HttpError(401, 'Your session has expired. Please sign in again'));
  }
  // Special-purpose tokens (e.g. the 2-step challenge) are never valid sessions
  if (payload.purpose) return next(new HttpError(401, 'Please sign in'));
  const user = userStmt.get(payload.sub);
  if (!user || !user.is_active) return next(new HttpError(401, 'Account is not active'));
  if ((payload.tv ?? 0) !== user.token_version) return next(new HttpError(401, 'You were signed out. Please sign in again'));
  req.user = user;
  // A temporary password must be replaced before anything else can be done
  if (user.must_change_password && !req.originalUrl.startsWith('/api/auth/')) {
    return next(new HttpError(403, 'Please change your temporary password first', 'PASSWORD_CHANGE_REQUIRED'));
  }
  next();
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have access to this'));

export const requireAdmin = requireRole(...ADMIN_ROLES);
export const requireSuper = requireRole('super_admin');

/** Wrap a sync/async handler so thrown errors reach the error middleware */
export const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (e) {
    next(e);
  }
};

/** Reject any :id-style route parameter that isn't a positive integer */
export function validateIdParams(router, ...names) {
  for (const name of names) {
    router.param(name, (_req, _res, next, value) => {
      const n = Number(value);
      next(Number.isSafeInteger(n) && n > 0 && String(n) === value ? undefined : new HttpError(400, 'Invalid ID in URL'));
    });
  }
}

export function studentFor(userId) {
  return db.prepare('SELECT * FROM students WHERE user_id = ?').get(userId);
}
export function donorFor(userId) {
  return db.prepare('SELECT * FROM donors WHERE user_id = ?').get(userId);
}
