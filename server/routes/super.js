import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, audit, getSettings, UPLOAD_DIR } from '../db.js';
import { runBackup, BACKUP_DIR } from '../jobs.js';
import { processOutbox, emailConfigured, smsConfigured } from '../notify.js';
import { paymentsConfigured } from '../payments.js';
import { h, HttpError, requireAuth, requireSuper, revokeSessions, validateIdParams, ADMIN_ROLES } from '../auth.js';
import { clean, normEmail, normName, normPhone, checkPassword, hashPassword } from '../services.js';

const r = Router();
r.use(requireAuth, requireSuper);
validateIdParams(r, 'id');

const ROLES = ['super_admin', 'admin', 'student', 'donor'];
const otherActiveSupers = (id) => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'super_admin' AND is_active = 1 AND id != ?").get(id).n;

r.get('/users', h((req, res) => {
  const where = ['1=1'], p = [];
  const role = clean(req.query.role, 20);
  const q = clean(req.query.q, 100, 'Search');
  if (role) {
    if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown role');
    where.push('role = ?'); p.push(role);
  }
  if (q) { where.push('(name LIKE ? OR email LIKE ? OR student_code LIKE ?)'); p.push(...Array(3).fill(`%${q}%`)); }
  res.json(db.prepare(`SELECT id, role, name, email, student_code, phone, is_active, must_change_password, created_at, last_login_at, locked_until, totp_enabled
                       FROM users WHERE ${where.join(' AND ')} ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'donor' THEN 2 ELSE 3 END, name COLLATE NOCASE LIMIT 500`).all(...p));
}));

/** Create staff accounts. Students and donors are created from their own modules so they get a profile record. */
r.post('/users', h((req, res) => {
  const b = req.body || {};
  if (!ADMIN_ROLES.includes(b.role)) throw new HttpError(400, 'Role must be admin or super_admin');
  const name = normName(b.name);
  const email = normEmail(b.email);
  if (!email) throw new HttpError(400, 'Email is required');
  const phone = normPhone(b.phone);
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'That email is already used');
  const pw = (typeof b.password === 'string' && b.password.trim()) || getSettings().default_password;
  checkPassword(pw, { email, name });
  const out = db.prepare('INSERT INTO users (role, email, password_hash, name, phone, must_change_password) VALUES (?, ?, ?, ?, ?, 1)')
    .run(b.role, email, hashPassword(pw), name, phone);
  audit(req.user.id, 'create', 'user', Number(out.lastInsertRowid), { role: b.role, email });
  res.status(201).json({ id: Number(out.lastInsertRowid), password: pw });
}));

r.put('/users/:id', h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'User not found');
  const b = req.body || {};
  const name = b.name !== undefined ? normName(b.name) : u.name;
  const email = b.email !== undefined ? normEmail(b.email) : u.email;
  const phone = b.phone !== undefined ? normPhone(b.phone) : u.phone;
  if ((u.role === 'donor' || ADMIN_ROLES.includes(u.role)) && !email) throw new HttpError(400, 'This account needs an email to sign in');
  if (email && db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, u.id)) throw new HttpError(409, 'That email is already used');
  let role = u.role;
  if (b.role && b.role !== u.role) {
    if (!ADMIN_ROLES.includes(u.role) || !ADMIN_ROLES.includes(b.role)) throw new HttpError(400, 'Only staff roles (Admin ↔ Super Admin) can be changed');
    if (u.id === req.user.id) throw new HttpError(400, 'You cannot change your own role');
    if (u.role === 'super_admin' && !otherActiveSupers(u.id)) throw new HttpError(400, 'There must always be at least one active Super Admin');
    role = b.role;
  }
  db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, role = ? WHERE id = ?').run(name, email, phone, role, u.id);
  // A role or sign-in email change takes effect immediately on every device
  if (role !== u.role || email !== u.email) revokeSessions(u.id);
  audit(req.user.id, 'update', 'user', u.id, { role, email, ...(role !== u.role ? { previous_role: u.role } : {}) });
  res.json({ ok: true });
}));

r.post('/users/:id/unlock', h((req, res) => {
  const out = db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(req.params.id);
  if (!out.changes) throw new HttpError(404, 'User not found');
  audit(req.user.id, 'unlock', 'user', Number(req.params.id));
  res.json({ ok: true });
}));

r.delete('/users/:id', h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.id === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
  if (u.role === 'super_admin' && !otherActiveSupers(u.id)) throw new HttpError(400, 'There must always be at least one active Super Admin');
  // Remove uploaded files belonging to a student account before the rows cascade away
  const files = db.prepare('SELECT c.file_path FROM certificates c JOIN students s ON s.id = c.student_id WHERE s.user_id = ?').all(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, path.basename(f.file_path)), () => {});
  audit(req.user.id, 'delete', 'user', u.id, { name: u.name, role: u.role });
  res.json({ ok: true });
}));

/* ---------------- Settings ---------------- */

const SETTING_RULES = {
  trust_name: (v) => { const s = clean(v, 150, 'Trust name'); if (!s) throw new HttpError(400, 'Trust name is required'); return s; },
  trust_address: (v) => clean(v, 300, 'Address') ?? '',
  registration_no: (v) => clean(v, 60, 'Registration number') ?? '',
  pan_80g_no: (v) => clean(v, 60, '80G number') ?? '',
  contact_email: (v) => normEmail(v) ?? '',
  contact_phone: (v) => normPhone(v, 'Contact phone') ?? '',
  default_password: (v) => checkPassword(typeof v === 'string' ? v.trim() : v),
  bank_name: (v) => clean(v, 100, 'Bank name') ?? '',
  bank_account: (v) => {
    const s = clean(v, 30, 'Account number') ?? '';
    if (s && !/^\d{6,20}$/.test(s.replace(/\s/g, ''))) throw new HttpError(400, 'Account number must be 6–20 digits');
    return s.replace(/\s/g, '');
  },
  bank_ifsc: (v) => {
    const s = (clean(v, 11, 'IFSC') ?? '').toUpperCase();
    if (s && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)) throw new HttpError(400, 'IFSC must look like SBIN0001234');
    return s;
  },
  upi_id: (v) => {
    const s = clean(v, 60, 'UPI ID') ?? '';
    if (s && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(s)) throw new HttpError(400, 'UPI ID must look like bana@sbi');
    return s;
  },
  attendance_threshold: (v) => thresholdRule(v, 'Attendance alert level'),
  marks_threshold: (v) => thresholdRule(v, 'Marks alert level'),
  public_impact: (v) => (v === true || v === '1' || v === 1 || v === 'on' ? '1' : '0'),
  backup_retention: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 3 || n > 365) throw new HttpError(400, 'Keep between 3 and 365 backups');
    return String(n);
  },
};

function thresholdRule(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, `${label} must be between 0 and 100`);
  return String(Math.round(n));
}

r.get('/settings', (_req, res) => res.json(getSettings()));

r.put('/settings', h((req, res) => {
  const b = req.body || {};
  const changes = {};
  for (const [k, rule] of Object.entries(SETTING_RULES)) if (b[k] !== undefined) changes[k] = rule(b[k]);
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(changes)) stmt.run(k, v);
  audit(req.user.id, 'update', 'settings', null, Object.keys(changes));
  res.json(getSettings());
}));

/* ---------------- Audit log ---------------- */

r.get('/audit', h((req, res) => {
  const where = ['1=1'], p = [];
  const action = clean(req.query.action, 60), entity = clean(req.query.entity, 60), q = clean(req.query.q, 100, 'Search');
  if (action) { where.push('a.action = ?'); p.push(action); }
  if (entity) { where.push('a.entity = ?'); p.push(entity); }
  if (q) { where.push('(u.name LIKE ? OR a.details LIKE ? OR a.ip LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const pageSize = 50, page = Math.min(Math.max(Number(req.query.page) || 1, 1), 100000);
  const sql = `FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')}`;
  res.json({
    rows: db.prepare(`SELECT a.*, u.name user_name, u.role user_role ${sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize),
    total: db.prepare(`SELECT COUNT(*) n ${sql}`).get(...p).n,
    page, pageSize,
    actions: db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY 1').all().map((x) => x.action),
  });
}));

/* ---------------- Backup ---------------- */

/** Consistent snapshot of the live database (VACUUM INTO), streamed as a download */
r.get('/backup', h((req, res) => {
  const file = path.join(os.tmpdir(), `bana-backup-${Date.now()}-${process.pid}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  audit(req.user.id, 'backup', 'database', null, { bytes: fs.statSync(file).size });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.download(file, `bana-connect-${stamp}.db`, () => fs.rm(file, () => {}));
}));

/** Stored backups (automatic daily + manual "Back up now") */
r.get('/backups', (_req, res) => {
  res.json(db.prepare('SELECT * FROM backups ORDER BY id DESC').all());
});

r.post('/backups', h((req, res) => {
  const b = runBackup('manual');
  audit(req.user.id, 'backup', 'database', null, b);
  res.status(201).json(b);
}));

r.get('/backups/:id/download', h((req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  const file = b && path.join(BACKUP_DIR, path.basename(b.file_name));
  if (!file || !fs.existsSync(file)) throw new HttpError(404, 'Backup file not found');
  audit(req.user.id, 'backup_download', 'database', b.id);
  res.download(file, b.file_name);
}));

/* ---------------- Messages (email / SMS outbox) & integrations ---------------- */

r.get('/integrations', (_req, res) => {
  res.json({ email: emailConfigured(), sms: smsConfigured(), payments: paymentsConfigured(), webhook: !!process.env.RAZORPAY_WEBHOOK_SECRET, publicUrl: process.env.PUBLIC_URL || null });
});

r.get('/outbox', h((req, res) => {
  const where = ['1=1'], p = [];
  const status = clean(req.query.status, 10), channel = clean(req.query.channel, 10), q = clean(req.query.q, 100, 'Search');
  if (status) { where.push('o.status = ?'); p.push(status); }
  if (channel) { where.push('o.channel = ?'); p.push(channel); }
  if (q) { where.push('(o.recipient LIKE ? OR o.subject LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
  res.json(db.prepare(`SELECT o.*, u.name user_name FROM outbox o LEFT JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 200`).all(...p));
}));

r.post('/outbox/:id/retry', h(async (req, res) => {
  const out = db.prepare("UPDATE outbox SET status = 'pending', attempts = 0, error = NULL WHERE id = ? AND status IN ('failed','logged')").run(req.params.id);
  if (!out.changes) throw new HttpError(400, 'Only failed or logged messages can be retried');
  await processOutbox();
  res.json(db.prepare('SELECT status, error FROM outbox WHERE id = ?').get(req.params.id));
}));

/** Turn off someone's 2-step verification (e.g. lost phone). They can set it up again after signing in. */
r.post('/users/:id/reset-2fa', h((req, res) => {
  const out = db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes = NULL, token_version = token_version + 1 WHERE id = ?').run(req.params.id);
  if (!out.changes) throw new HttpError(404, 'User not found');
  audit(req.user.id, '2fa_reset', 'user', Number(req.params.id));
  res.json({ ok: true });
}));

export default r;
