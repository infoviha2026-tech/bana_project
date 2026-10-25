import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { db, SCHEMA_VERSION } from './db.js';
import { rateLimit, securityHeaders, requestLogger, requireBodyType } from './security.js';
import authRoutes from './routes/auth.js';
import selfRoutes from './routes/self.js';
import adminRoutes from './routes/admin.js';
import superRoutes from './routes/super.js';
import programRoutes from './routes/programs.js';
import financeRoutes from './routes/finance.js';
import portalRoutes from './routes/portal.js';
import publicRoutes from './routes/public.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = Date.now();

/** Map low-level errors to safe, meaningful HTTP responses */
function toHttp(err) {
  if (err.status && err.status < 500) return [err.status, err.message, err.code];
  if (err instanceof multer.MulterError) {
    const msg = { LIMIT_FILE_SIZE: 'File is too large', LIMIT_FILE_COUNT: 'Upload one file at a time', LIMIT_UNEXPECTED_FILE: 'Unexpected file field' }[err.code];
    return [400, msg || 'Invalid upload'];
  }
  if (err.type === 'entity.parse.failed') return [400, 'Request body is not valid JSON'];
  if (err.type === 'entity.too.large') return [413, 'Request is too large'];
  if (err.code === 'ERR_SQLITE_ERROR' || /constraint failed/i.test(err.message)) {
    if (/UNIQUE constraint/i.test(err.message)) return [409, 'This record already exists'];
    if (/FOREIGN KEY constraint/i.test(err.message)) return [409, 'This record is linked to other data and cannot be changed this way'];
    if (/CHECK constraint|NOT NULL constraint/i.test(err.message)) return [400, 'Some required information is missing or invalid'];
  }
  return [500, 'Something went wrong on the server'];
}

export async function createApp({ prod = false, quiet = false, vite = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  app.use(requestLogger({ quiet }));
  app.use(securityHeaders({ prod }));

  // API: general per-IP limit, then body parsing with tight size limits
  app.use('/api', rateLimit({ windowMs: 60_000, max: Number(process.env.API_RATE_LIMIT) || 3000 }));
  // Public endpoints and the payment webhook (raw body for signature check) come before JSON parsing and auth
  app.use('/api', publicRoutes);
  app.use('/api', requireBodyType);
  app.use('/api/admin/imports/commit', express.json({ limit: '15mb' }));
  app.use('/api', express.json({ limit: '200kb', strict: true }));

  app.get('/api/health', (_req, res) => {
    let dbOk = true;
    try { db.prepare('SELECT 1').get(); } catch { dbOk = false; }
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', db: dbOk, schema: SCHEMA_VERSION, uptime: Math.round((Date.now() - startedAt) / 1000) });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/super', superRoutes);
  app.use('/api/admin', programRoutes);
  app.use('/api/admin', financeRoutes);
  app.use('/api', selfRoutes);
  app.use('/api', portalRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const [status, message, code] = toHttp(err);
    if (status >= 500) console.error(JSON.stringify({ t: new Date().toISOString(), id: req.requestId, error: err.stack || String(err) }));
    if (res.headersSent) return res.destroy(); // never leave a half-sent response hanging
    res.status(status).json({ error: message, ...(code ? { code } : {}), requestId: req.requestId });
  });

  if (prod) {
    const dist = path.join(root, 'dist');
    if (!fs.existsSync(dist)) throw new Error('Run "npm run build" before starting in production mode');
    app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, p) => /(\.html|[\\/]sw\.js|\.webmanifest)$/.test(p) && res.setHeader('Cache-Control', 'no-cache') }));
    app.get('*', (_req, res) => res.setHeader('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')));
  } else if (vite) {
    const { createServer } = await import('vite');
    const server = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
    app.use(server.middlewares);
  }
  return app;
}
