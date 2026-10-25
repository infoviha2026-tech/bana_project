import { Router } from 'express';
import { db, audit, fyOf } from '../db.js';
import { h, HttpError, requireAuth, requireAdmin, validateIdParams } from '../auth.js';
import { crud } from '../crud.js';
import { queryGuard, list, INR_FMT } from '../listing.js';
import { text, amount, date, oneOf, bool, ref } from '../fields.js';
import { EXPENSE_CATEGORIES, PLEDGE_FREQUENCIES, PROJECT_STATUSES, DONATION_MODES, clean } from '../services.js';
import { pledgeStatus } from '../academics.js';
import { imageUpload, acceptImage, removeUpload } from '../uploads.js';
import { annualSummary } from '../pdf.js';
import { sendWorkbook } from '../excel.js';

const r = Router();
r.use(requireAuth, requireAdmin);
validateIdParams(r, 'id');
r.use(queryGuard);

/* ---------------- Projects ---------------- */

const projectSelect = `SELECT p.*,
    (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.project_id = p.id) raised,
    (SELECT COUNT(DISTINCT donor_id) FROM donations d WHERE d.project_id = p.id) donors,
    (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.project_id = p.id) spent
  FROM projects p`;

crud(r, {
  path: '/projects', table: 'projects', entity: 'project', label: 'Project', alias: 'p', stamp: true,
  select: projectSelect, search: ['p.name', 'p.village', 'p.description'], filters: { status: 'p.status', village: 'p.village' },
  order: "p.status = 'Active' DESC, p.created_at DESC",
  fields: {
    name: text('Project name', 150, { req: true }),
    description: text('Description', 3000),
    village: text('Village', 100),
    goal_amount: amount('Funding goal'),
    start_date: date('Start date', { allowFuture: true }),
    end_date: date('End date', { allowFuture: true }),
    status: oneOf(PROJECT_STATUSES, 'Status'),
  },
  validate(d) {
    if (d.start_date && d.end_date && d.end_date < d.start_date) throw new HttpError(400, 'End date cannot be before the start date');
  },
  detail: (row) => ({
    ...row,
    donations: db.prepare('SELECT dn.id, dn.amount, dn.donated_on, dn.receipt_no, u.name donor_name FROM donations dn JOIN donors d ON d.id = dn.donor_id JOIN users u ON u.id = d.user_id WHERE dn.project_id = ? ORDER BY dn.donated_on DESC LIMIT 200').all(row.id),
    expenses: db.prepare('SELECT * FROM expenses WHERE project_id = ? ORDER BY spent_on DESC LIMIT 200').all(row.id),
    stories: db.prepare('SELECT id, title, created_at FROM stories WHERE project_id = ? ORDER BY created_at DESC').all(row.id),
  }),
  export: {
    type: 'projects',
    columns: [
      { header: 'Project', key: 'name', width: 30 }, { header: 'Village', key: 'village' }, { header: 'Status', key: 'status' },
      { header: 'Goal', key: 'goal_amount', numFmt: INR_FMT }, { header: 'Raised', key: 'raised', numFmt: INR_FMT }, { header: 'Spent', key: 'spent', numFmt: INR_FMT },
      { header: 'Donors', key: 'donors' }, { header: 'Start', key: 'start_date' }, { header: 'End', key: 'end_date' },
    ],
  },
});

/* ---------------- Pledges ---------------- */

const pledgeCrud = crud(r, {
  path: '/pledges', table: 'pledges', entity: 'pledge', label: 'Pledge', alias: 'pl', stamp: true,
  select: `SELECT pl.*, u.name donor_name, u.email donor_email, pr.name project_name FROM pledges pl JOIN donors d ON d.id = pl.donor_id
           JOIN users u ON u.id = d.user_id LEFT JOIN projects pr ON pr.id = pl.project_id`,
  search: ['u.name', 'u.email', 'pl.purpose'], filters: { donor_id: 'pl.donor_id', status: 'pl.status', frequency: 'pl.frequency' },
  order: "pl.status = 'Active' DESC, u.name",
  fields: {
    donor_id: ref('donors', 'Donor', { req: true }),
    amount: amount('Amount per instalment'),
    frequency: oneOf(PLEDGE_FREQUENCIES, 'Frequency'),
    start_date: date('Start date', { req: true, allowFuture: true }),
    end_date: date('End date', { allowFuture: true }),
    purpose: text('Purpose', 100),
    project_id: ref('projects', 'Project'),
    status: oneOf(['Active', 'Paused', 'Ended'], 'Status'),
    notes: text('Notes', 300),
  },
  validate(d) {
    if (d.end_date && d.end_date < d.start_date) throw new HttpError(400, 'End date cannot be before the start date');
  },
  detail: (row) => ({ ...row, ...pledgeStatus(row), donations: db.prepare('SELECT id, amount, donated_on, receipt_no FROM donations WHERE pledge_id = ? ORDER BY donated_on DESC').all(row.id) }),
});

// List with computed status (expected vs received)
r.get('/pledges-status', (req, res) => {
  const [sql, p] = pledgeCrud.query(req);
  const out = list(req, sql, p, "pl.status = 'Active' DESC, u.name", { exportAll: false });
  out.rows = out.rows.map((row) => ({ ...row, ...pledgeStatus(row) }));
  res.json(out);
});

/* ---------------- Expenses ---------------- */

crud(r, {
  path: '/expenses', table: 'expenses', entity: 'expense', label: 'Expense', alias: 'e', stamp: true,
  select: 'SELECT e.*, p.name project_name FROM expenses e LEFT JOIN projects p ON p.id = e.project_id',
  search: ['e.vendor', 'e.description', 'e.reference_no'],
  filters: { category: 'e.category', project_id: 'e.project_id', from: 'e.spent_on >=', to: 'e.spent_on <=' },
  order: 'e.spent_on DESC, e.id DESC', sumCol: 'amount',
  fields: {
    spent_on: date('Date', { req: true }),
    category: oneOf(EXPENSE_CATEGORIES, 'Category', 'Other'),
    amount: amount(),
    vendor: text('Paid to', 150),
    description: text('Description', 500),
    project_id: ref('projects', 'Project'),
    mode: oneOf(DONATION_MODES, 'Payment mode', 'Bank Transfer'),
    reference_no: text('Reference no', 60),
  },
  export: {
    type: 'expenses',
    columns: [
      { header: 'Date', key: 'spent_on', width: 12 }, { header: 'Category', key: 'category', width: 20 }, { header: 'Amount', key: 'amount', numFmt: INR_FMT },
      { header: 'Paid To', key: 'vendor', width: 24 }, { header: 'Description', key: 'description', width: 34 }, { header: 'Project', key: 'project_name', width: 24 },
      { header: 'Mode', key: 'mode' }, { header: 'Reference No', key: 'reference_no', width: 18 },
    ],
  },
});

/* ---------------- Impact stories ---------------- */

crud(r, {
  path: '/stories', table: 'stories', entity: 'story', label: 'Story', alias: 's', stamp: true,
  select: 'SELECT s.*, p.name project_name, u.name author FROM stories s LEFT JOIN projects p ON p.id = s.project_id LEFT JOIN users u ON u.id = s.created_by',
  search: ['s.title', 's.body', 's.village'], filters: { project_id: 's.project_id', published: 's.published' },
  order: 's.created_at DESC',
  fields: {
    title: text('Title', 160, { req: true }),
    body: text('Story', 10000, { req: true }),
    project_id: ref('projects', 'Project'),
    village: text('Village', 100),
    published: bool(),
  },
  beforeDelete: (row) => removeUpload('stories', row.image_path),
});

const storyImage = imageUpload('stories', 5);
r.post('/stories/:id/image', storyImage.single('image'), h((req, res) => {
  const s = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!s) {
    if (req.file) removeUpload('stories', req.file.filename);
    throw new HttpError(404, 'Story not found');
  }
  const file = acceptImage(req.file);
  db.prepare('UPDATE stories SET image_path = ? WHERE id = ?').run(file, s.id);
  removeUpload('stories', s.image_path);
  audit(req.user.id, 'update_image', 'story', s.id);
  res.json({ ok: true });
}));

/* ---------------- Online payments log ---------------- */

r.get('/payments', (req, res) => {
  const where = ['1=1'], p = [];
  if (req.query.status) { where.push('pm.status = ?'); p.push(req.query.status); }
  if (req.query.q) { where.push('(u.name LIKE ? OR pm.order_id LIKE ? OR pm.payment_id LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
  res.json(list(req, `SELECT pm.*, u.name donor_name, dn.receipt_no FROM payments pm JOIN donors d ON d.id = pm.donor_id JOIN users u ON u.id = d.user_id
    LEFT JOIN donations dn ON dn.id = pm.donation_id WHERE ${where.join(' AND ')}`, p, 'pm.created_at DESC', { sumCol: "CASE WHEN status = 'paid' THEN amount ELSE 0 END", exportAll: false }));
});

/* ---------------- Reports ---------------- */

function parseFy(v) {
  const fy = clean(v, 7, 'Financial year') || fyOf(new Date().toISOString());
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) throw new HttpError(400, 'Financial year must look like 2025-26');
  return { fy, from: `${m[1]}-04-01`, to: `${Number(m[1]) + 1}-03-31` };
}

export function fySummary(fyStr) {
  const { fy, from, to } = parseFy(fyStr);
  const sum = (sql, ...p) => db.prepare(sql).get(...p).n;
  const income = sum('SELECT COALESCE(SUM(amount),0) n FROM donations WHERE donated_on BETWEEN ? AND ?', from, to);
  const aid = sum('SELECT COALESCE(SUM(amount),0) n FROM aid WHERE given_on BETWEEN ? AND ?', from, to);
  const expenses = sum('SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE spent_on BETWEEN ? AND ?', from, to);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(from.slice(0, 4)), 3 + i, 1));
    return d.toISOString().slice(0, 7);
  });
  const byMonth = (sql) => Object.fromEntries(db.prepare(sql).all(from, to).map((x) => [x.m, x.t]));
  const inc = byMonth('SELECT substr(donated_on,1,7) m, SUM(amount) t FROM donations WHERE donated_on BETWEEN ? AND ? GROUP BY m');
  const aidM = byMonth('SELECT substr(given_on,1,7) m, SUM(amount) t FROM aid WHERE given_on BETWEEN ? AND ? GROUP BY m');
  const expM = byMonth('SELECT substr(spent_on,1,7) m, SUM(amount) t FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY m');
  return {
    fy, from, to, income, aid, expenses,
    monthly: months.map((m) => ({ month: m, income: inc[m] || 0, aid: aidM[m] || 0, expenses: expM[m] || 0 })),
    byPurpose: db.prepare('SELECT purpose, COUNT(*) n, SUM(amount) total FROM donations WHERE donated_on BETWEEN ? AND ? GROUP BY purpose ORDER BY total DESC').all(from, to),
    byMode: db.prepare('SELECT mode, COUNT(*) n, SUM(amount) total FROM donations WHERE donated_on BETWEEN ? AND ? GROUP BY mode ORDER BY total DESC').all(from, to),
    aidByType: db.prepare('SELECT type, COUNT(*) n, SUM(amount) total FROM aid WHERE given_on BETWEEN ? AND ? GROUP BY type ORDER BY total DESC').all(from, to),
    expensesByCategory: db.prepare('SELECT category, COUNT(*) n, SUM(amount) total FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY category ORDER BY total DESC').all(from, to),
    donors: sum('SELECT COUNT(DISTINCT donor_id) n FROM donations WHERE donated_on BETWEEN ? AND ?', from, to),
    newDonors: sum('SELECT COUNT(*) n FROM (SELECT donor_id, MIN(donated_on) first FROM donations GROUP BY donor_id) WHERE first BETWEEN ? AND ?', from, to),
    activeStudents: sum("SELECT COUNT(*) n FROM students WHERE status = 'Active'"),
    newStudents: sum('SELECT COUNT(*) n FROM students WHERE joined_on BETWEEN ? AND ?', from, to),
    certificatesVerified: sum("SELECT COUNT(*) n FROM certificates WHERE status = 'Verified' AND substr(reviewed_at,1,10) BETWEEN ? AND ?", from, to),
    scholarshipsApproved: sum("SELECT COUNT(*) n FROM scholarship_applications WHERE status = 'Approved' AND substr(reviewed_at,1,10) BETWEEN ? AND ?", from, to),
    events: sum("SELECT COUNT(*) n FROM events WHERE status != 'Cancelled' AND event_date BETWEEN ? AND ?", from, to),
    volunteerHours: sum('SELECT COALESCE(SUM(hours),0) n FROM volunteer_hours WHERE worked_on BETWEEN ? AND ?', from, to),
    projects: db.prepare(`SELECT p.id, p.name, p.status, p.goal_amount, p.village,
        (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.project_id = p.id) raised,
        (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.project_id = p.id AND d.donated_on BETWEEN ? AND ?) raised_fy,
        (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.project_id = p.id AND e.spent_on BETWEEN ? AND ?) spent_fy
      FROM projects p ORDER BY p.status, p.name`).all(from, to, from, to),
    cashOver2000: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM donations WHERE mode = 'Cash' AND amount > 2000 AND donated_on BETWEEN ? AND ?").get(from, to),
    missingPan: db.prepare(`SELECT COUNT(DISTINCT dn.donor_id) n FROM donations dn JOIN donors d ON d.id = dn.donor_id WHERE (d.pan IS NULL OR d.pan = '') AND dn.donated_on BETWEEN ? AND ?`).get(from, to).n,
  };
}

r.get('/reports/summary', h((req, res) => res.json(fySummary(req.query.fy))));

r.get('/reports/annual.pdf', h((req, res) => {
  const s = fySummary(req.query.fy);
  audit(req.user.id, 'report', 'annual_summary', null, { fy: s.fy });
  return annualSummary(res, s);
}));

/** Form 10BD (statement of donations, Rule 18AB): one row per donor × donation type × mode of receipt */
const MODE_10BD = (m) => (m === 'Cash' ? 'Cash' : m === 'Other' ? 'Others' : 'Electronic modes including account payee cheque/draft');
r.get('/reports/form-10bd', h(async (req, res) => {
  const { fy, from, to } = parseFy(req.query.fy);
  const rows = db.prepare(`SELECT d.id donor_id, d.pan, u.name, d.address, d.city, dn.mode, dn.purpose, dn.amount
    FROM donations dn JOIN donors d ON d.id = dn.donor_id JOIN users u ON u.id = d.user_id WHERE dn.donated_on BETWEEN ? AND ?`).all(from, to);
  const groups = new Map();
  for (const x of rows) {
    const type = /corpus/i.test(x.purpose || '') ? 'Corpus' : 'Others';
    const mode = MODE_10BD(x.mode);
    const key = `${x.donor_id}|${type}|${mode}`;
    const g = groups.get(key) || { ...x, type, mode10: mode, total: 0, cashOver: false };
    g.total += x.amount;
    if (x.mode === 'Cash' && x.amount > 2000) g.cashOver = true;
    groups.set(key, g);
  }
  const out = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map((g, i) => ({
    sl: i + 1, ack: '', id_code: g.pan ? '1 - Permanent Account Number' : '', uid: g.pan || '', section: 'Section 80G',
    urn: '', urn_date: '', name: g.name, address: [g.address, g.city].filter(Boolean).join(', '), type: g.type, mode: g.mode10, amount: g.total,
    check: [!g.pan && 'PAN missing — add PAN or Aadhaar before filing', g.cashOver && 'Includes cash over Rs. 2,000 (not eligible under 80G)'].filter(Boolean).join('; '),
  }));
  audit(req.user.id, 'report', 'form_10bd', null, { fy, rows: out.length });
  await sendWorkbook(res, `form-10BD-FY${fy}.xlsx`, `Form 10BD FY ${fy}`, [
    { header: 'Sl. No.', key: 'sl', width: 7 }, { header: 'Pre Acknowledgement Number', key: 'ack', width: 18 }, { header: 'ID Code', key: 'id_code', width: 26 },
    { header: 'Unique Identification Number', key: 'uid', width: 18 }, { header: 'Section Code', key: 'section', width: 13 },
    { header: 'Unique Registration Number (URN)', key: 'urn', width: 18 }, { header: 'Date of Issuance of URN', key: 'urn_date', width: 14 },
    { header: 'Name of donor', key: 'name', width: 26 }, { header: 'Address of donor', key: 'address', width: 34 }, { header: 'Donation Type', key: 'type', width: 12 },
    { header: 'Mode of receipt', key: 'mode', width: 40 }, { header: 'Amount of donation (Indian rupees)', key: 'amount', numFmt: '#,##0.00', width: 18 },
    { header: 'Check before filing', key: 'check', width: 50 },
  ], out);
}));

r.get('/reports/fund-utilisation.xlsx', h(async (req, res) => {
  const s = fySummary(req.query.fy);
  const rows = [
    ...s.byPurpose.map((x) => ({ section: 'Income', item: x.purpose, count: x.n, amount: x.total })),
    { section: 'Income', item: 'TOTAL INCOME', count: '', amount: s.income },
    ...s.aidByType.map((x) => ({ section: 'Student aid', item: x.type, count: x.n, amount: x.total })),
    ...s.expensesByCategory.map((x) => ({ section: 'Expenses', item: x.category, count: x.n, amount: x.total })),
    { section: 'Spending', item: 'TOTAL SPENDING', count: '', amount: s.aid + s.expenses },
    { section: 'Result', item: 'SURPLUS / (DEFICIT)', count: '', amount: s.income - s.aid - s.expenses },
    ...s.projects.map((p) => ({ section: 'Projects', item: `${p.name} — raised this FY (spent: ${p.spent_fy})`, count: '', amount: p.raised_fy })),
  ];
  await sendWorkbook(res, `fund-utilisation-FY${s.fy}.xlsx`, `Fund utilisation ${s.fy}`, [
    { header: 'Section', key: 'section', width: 14 }, { header: 'Item', key: 'item', width: 50 }, { header: 'Entries', key: 'count', width: 9 }, { header: 'Amount', key: 'amount', numFmt: INR_FMT, width: 18 },
  ], rows);
}));

export default r;
