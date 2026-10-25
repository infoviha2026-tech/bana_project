import { db } from './db.js';
import { HttpError } from './auth.js';
import { normDate } from './services.js';

/**
 * Run a list query with optional pagination. `sql` must be a full SELECT without ORDER/LIMIT.
 * In export mode every row is returned.
 */
export function list(req, sql, params, order, { sumCol, exportAll = req.path.startsWith('/export') } = {}) {
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const meta = db.prepare(`SELECT COUNT(*) total${sumCol ? `, COALESCE(SUM(${sumCol}),0) sum` : ''} FROM (${sql})`).get(...params);
  const rows = exportAll
    ? db.prepare(`${sql} ORDER BY ${order}`).all(...params)
    : db.prepare(`${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return { rows, total: meta.total, sum: meta.sum, page, pageSize };
}

export const like = (q) => `%${String(q).trim()}%`;

export const INR_FMT = '"₹"#,##,##0.00';

/** Excel export registry: type → { query(req) → [sql, params], order, columns } */
export const EXPORTS = {};
export function registerExport(type, def) {
  EXPORTS[type] = def;
}

/** Reject oversized or malformed list filters before they reach SQL (all values are bound parameters anyway) */
export function queryGuard(req, _res, next) {
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v !== 'string' || v.length > 100) return next(new HttpError(400, `Invalid filter "${k}"`));
  }
  for (const k of ['from', 'to']) {
    if (req.query[k]) {
      try { req.query[k] = normDate(req.query[k], k === 'from' ? 'From date' : 'To date', { allowFuture: true }); } catch (e) { return next(e); }
    }
  }
  for (const [k, v] of Object.entries(req.query)) {
    if ((k.endsWith('_id') || k === 'page' || k === 'pageSize') && v !== '' && !/^\d{1,9}$/.test(v)) return next(new HttpError(400, `Invalid filter "${k}"`));
  }
  next();
}
