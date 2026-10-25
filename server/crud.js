import { db, audit, tx } from './db.js';
import { h, HttpError } from './auth.js';
import { list, like, registerExport } from './listing.js';

/**
 * Mount list / get / create / update / delete routes for a simple table.
 *
 * def = {
 *   path: '/expenses', table: 'expenses', entity: 'expense', label: 'Expense',
 *   fields: { column: (value, body, existing) => normalisedValue },   // validators; throw HttpError(400) on bad input
 *   select: 'SELECT e.*, p.name project_name FROM expenses e LEFT JOIN projects p ON p.id = e.project_id', alias: 'e',
 *   search: ['e.vendor', 'e.description'],              // columns matched by ?q=
 *   filters: { category: 'e.category', project_id: 'e.project_id', from: 'e.spent_on >=', to: 'e.spent_on <=' },
 *   order: 'e.spent_on DESC', sumCol: 'amount',
 *   stamp: true,                                         // set created_by on insert
 *   validate(data, existing, req) {},                    // cross-field checks
 *   afterSave(id, data, created, req) {}, beforeDelete(row, req) {},
 *   readOnly: false, export: { type, columns },
 *   guard(req) {}                                        // extra permission check for writes
 * }
 */
export function crud(r, def) {
  const alias = def.alias || def.table;
  const select = def.select || `SELECT * FROM ${def.table}`;
  // Does the outer query already have a WHERE? (ignore WHEREs inside sub-queries)
  let outer = select;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, '');
  const hasWhere = /\bWHERE\b/i.test(outer);

  function query(req) {
    const where = [], p = [];
    if (req.query.q && def.search?.length) {
      where.push(`(${def.search.map((c) => `${c} LIKE ?`).join(' OR ')})`);
      p.push(...def.search.map(() => like(req.query.q)));
    }
    for (const [param, col] of Object.entries(def.filters || {})) {
      const v = req.query[param];
      if (v === undefined || v === '') continue;
      where.push(/[<>=]$/.test(col) ? `${col} ?` : `${col} = ?`);
      p.push(v);
    }
    const sql = where.length ? `${select} ${hasWhere ? 'AND' : 'WHERE'} ${where.join(' AND ')}` : select;
    return [sql, p];
  }

  const one = (id) => db.prepare(`${select} ${hasWhere ? 'AND' : 'WHERE'} ${alias}.id = ?`).get(id);

  function payload(body, existing, req) {
    const data = {};
    for (const [col, fn] of Object.entries(def.fields)) data[col] = fn(body?.[col], body || {}, existing);
    def.validate?.(data, existing, req);
    return data;
  }

  r.get(def.path, h((req, res) => {
    const [sql, p] = query(req);
    res.json(list(req, sql, p, def.order || `${alias}.id DESC`, { sumCol: def.sumCol, exportAll: false }));
  }));

  r.get(`${def.path}/:id`, h((req, res) => {
    const row = one(req.params.id);
    if (!row) throw new HttpError(404, `${def.label} not found`);
    res.json(def.detail ? def.detail(row) : row);
  }));

  if (!def.readOnly) {
    r.post(def.path, h((req, res) => {
      def.guard?.(req);
      const id = tx(() => {
        const data = payload(req.body, null, req);
        if (def.stamp) data.created_by = req.user.id;
        const cols = Object.keys(data);
        const out = db.prepare(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => data[c]));
        const newId = Number(out.lastInsertRowid);
        def.afterSave?.(newId, data, true, req);
        return newId;
      });
      audit(req.user.id, 'create', def.entity, id);
      res.status(201).json({ id });
    }));

    r.put(`${def.path}/:id`, h((req, res) => {
      def.guard?.(req);
      const existing = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(req.params.id);
      if (!existing) throw new HttpError(404, `${def.label} not found`);
      tx(() => {
        const data = payload(req.body, existing, req);
        const cols = Object.keys(data);
        db.prepare(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), existing.id);
        def.afterSave?.(existing.id, data, false, req);
      });
      audit(req.user.id, 'update', def.entity, existing.id);
      res.json({ ok: true });
    }));

    r.delete(`${def.path}/:id`, h((req, res) => {
      def.guard?.(req);
      const row = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(req.params.id);
      if (!row) throw new HttpError(404, `${def.label} not found`);
      def.beforeDelete?.(row, req);
      db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(row.id);
      audit(req.user.id, 'delete', def.entity, row.id);
      res.json({ ok: true });
    }));
  }

  if (def.export) registerExport(def.export.type, { query, order: def.order || `${alias}.id DESC`, columns: def.export.columns });
  return { query, one };
}
