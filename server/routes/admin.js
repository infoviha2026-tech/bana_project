import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { db, audit, tx, fyRange, fyOf, getSettings, UPLOAD_DIR } from '../db.js';
import { h, HttpError, requireAuth, requireAdmin, revokeSessions, validateIdParams, ADMIN_ROLES } from '../auth.js';
import {
  saveStudent, saveDonor, createDonation, donationPayload, donationLinks, notifyDonation, assertUniqueReference, createAid, aidPayload, hashPassword, clean, checkPassword, normId, normDate,
  DONATION_MODES, AID_TYPES, DONOR_TYPES, STUDENT_STATUSES, CERT_CATEGORIES, EXPENSE_CATEGORIES, PLEDGE_FREQUENCIES, PROJECT_STATUSES, EVENT_STATUSES, TERMS, APPLICATION_STATUSES,
} from '../services.js';
import { IMPORT_TYPES, parseImport, runImport, templateWorkbook, sendWorkbook } from '../excel.js';
import { impactStats } from './self.js';
import { notifyUser } from '../notify.js';
import { list, like, queryGuard, registerExport, EXPORTS, INR_FMT as inr } from '../listing.js';

const r = Router();
r.use(requireAuth, requireAdmin);
validateIdParams(r, 'id');

r.use(queryGuard);

const isSuper = (req) => req.user.role === 'super_admin';
const superOnly = (req) => {
  if (!isSuper(req)) throw new HttpError(403, 'Only the Super Admin can do this');
};

r.get('/meta', (_req, res) => {
  res.json({
    donationModes: DONATION_MODES, aidTypes: AID_TYPES, donorTypes: DONOR_TYPES, studentStatuses: STUDENT_STATUSES, certCategories: CERT_CATEGORIES,
    expenseCategories: EXPENSE_CATEGORIES, pledgeFrequencies: PLEDGE_FREQUENCIES, projectStatuses: PROJECT_STATUSES, eventStatuses: EVENT_STATUSES, terms: TERMS, applicationStatuses: APPLICATION_STATUSES,
    projects: db.prepare("SELECT id, name, status FROM projects ORDER BY status = 'Active' DESC, name").all(),
    villages: db.prepare("SELECT DISTINCT village v FROM students WHERE village IS NOT NULL AND village != '' ORDER BY 1").all().map((x) => x.v),
    programmes: db.prepare("SELECT DISTINCT programme v FROM students WHERE programme IS NOT NULL ORDER BY 1").all().map((x) => x.v),
    purposes: db.prepare("SELECT DISTINCT purpose v FROM donations WHERE purpose IS NOT NULL ORDER BY 1").all().map((x) => x.v),
    importTypes: Object.entries(IMPORT_TYPES).map(([key, t]) => ({ key, label: t.label, columns: t.columns.map((c) => ({ field: c.field, header: c.header, required: !!c.required })) })),
  });
});

/* ---------------- Dashboard ---------------- */

r.get('/dashboard', (_req, res) => {
  const [from, to] = fyRange();
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthly = Object.fromEntries(
    db.prepare("SELECT substr(donated_on,1,7) m, SUM(amount) t FROM donations WHERE donated_on >= ? GROUP BY m").all(months[0] + '-01').map((x) => [x.m, x.t]),
  );
  res.json({
    students: db.prepare("SELECT COUNT(*) n, SUM(status = 'Active') active FROM students").get(),
    donors: db.prepare('SELECT COUNT(*) n FROM donors').get().n,
    donations: db.prepare('SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM donations').get(),
    donationsFy: db.prepare('SELECT COALESCE(SUM(amount),0) total FROM donations WHERE donated_on BETWEEN ? AND ?').get(from, to).total,
    currentFy: fyOf(now.toISOString()),
    aid: db.prepare('SELECT COALESCE(SUM(amount),0) total FROM aid').get().total,
    pendingCertificates: db.prepare("SELECT COUNT(*) n FROM certificates WHERE status = 'Pending'").get().n,
    monthly: months.map((m) => ({ month: m, total: monthly[m] || 0 })),
    topDonors: db.prepare(`SELECT d.id, u.name, SUM(dn.amount) total FROM donations dn JOIN donors d ON d.id = dn.donor_id JOIN users u ON u.id = d.user_id
                           GROUP BY d.id ORDER BY total DESC LIMIT 5`).all(),
    byPurpose: db.prepare('SELECT purpose, SUM(amount) total FROM donations GROUP BY purpose ORDER BY total DESC LIMIT 6').all(),
    recentCertificates: db.prepare(`SELECT c.id, c.title, c.created_at, u.name student FROM certificates c JOIN students s ON s.id = c.student_id
                                    JOIN users u ON u.id = s.user_id WHERE c.status = 'Pending' ORDER BY c.created_at DESC LIMIT 5`).all(),
    recentDonations: db.prepare(`SELECT dn.id, dn.amount, dn.donated_on, u.name donor FROM donations dn JOIN donors d ON d.id = dn.donor_id
                                 JOIN users u ON u.id = d.user_id ORDER BY dn.donated_on DESC, dn.id DESC LIMIT 5`).all(),
    impact: impactStats(),
  });
});

/* ---------------- Students ---------------- */

function studentQuery(req) {
  const where = ['1=1'], p = [];
  const { q, status, programme, class_year } = req.query;
  if (q) { where.push('(u.name LIKE ? OR s.student_code LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR s.village LIKE ? OR s.school LIKE ?)'); p.push(...Array(6).fill(like(q))); }
  if (status) { where.push('s.status = ?'); p.push(status); }
  if (programme) { where.push('s.programme = ?'); p.push(programme); }
  if (class_year) { where.push('s.class_year = ?'); p.push(class_year); }
  return [`SELECT s.*, u.name, u.email, u.phone, u.is_active, u.last_login_at,
            (SELECT COUNT(*) FROM certificates c WHERE c.student_id = s.id AND c.status = 'Pending') pending_certs,
            (SELECT COUNT(*) FROM certificates c WHERE c.student_id = s.id) cert_count,
            (SELECT COALESCE(SUM(amount),0) FROM aid a WHERE a.student_id = s.id) aid_total
          FROM students s JOIN users u ON u.id = s.user_id WHERE ${where.join(' AND ')}`, p];
}

r.get('/students', (req, res) => {
  const [sql, p] = studentQuery(req);
  res.json(list(req, sql, p, 'u.name COLLATE NOCASE'));
});

r.get('/students/:id', h((req, res) => {
  const s = db.prepare(`SELECT s.*, u.name, u.email, u.phone, u.is_active, u.last_login_at, u.created_at FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(req.params.id);
  if (!s) throw new HttpError(404, 'Student not found');
  res.json({
    ...s,
    certificates: db.prepare('SELECT * FROM certificates WHERE student_id = ? ORDER BY created_at DESC').all(s.id),
    aid: db.prepare('SELECT * FROM aid WHERE student_id = ? ORDER BY given_on DESC').all(s.id),
  });
}));

r.post('/students', h((req, res) => {
  const out = tx(() => saveStudent(req.body || {}));
  if (!out.created) throw new HttpError(409, `Student ID ${req.body.student_code} already exists`);
  audit(req.user.id, 'create', 'student', out.id, { student_code: req.body.student_code, name: req.body.name });
  res.status(201).json(out);
}));

r.put('/students/:id', h((req, res) => {
  const out = tx(() => saveStudent(req.body || {}, { id: Number(req.params.id) }));
  audit(req.user.id, 'update', 'student', out.id);
  res.json(out);
}));

r.delete('/students/:id', h((req, res) => {
  superOnly(req);
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) throw new HttpError(404, 'Student not found');
  const files = db.prepare('SELECT file_path FROM certificates WHERE student_id = ?').all(s.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(s.user_id); // cascades to student, certificates, aid
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.file_path), () => {});
  audit(req.user.id, 'delete', 'student', s.id, { student_code: s.student_code });
  res.json({ ok: true });
}));

/* ---------------- Certificates ---------------- */

function certQuery(req) {
  const where = ['1=1'], p = [];
  const { q, status, category } = req.query;
  if (q) { where.push('(c.title LIKE ? OR u.name LIKE ? OR s.student_code LIKE ?)'); p.push(like(q), like(q), like(q)); }
  if (status) { where.push('c.status = ?'); p.push(status); }
  if (category) { where.push('c.category = ?'); p.push(category); }
  return [`SELECT c.*, u.name student_name, s.student_code, rv.name reviewer
           FROM certificates c JOIN students s ON s.id = c.student_id JOIN users u ON u.id = s.user_id
           LEFT JOIN users rv ON rv.id = c.reviewed_by WHERE ${where.join(' AND ')}`, p];
}

r.get('/certificates', (req, res) => {
  const [sql, p] = certQuery(req);
  res.json(list(req, sql, p, "c.status = 'Pending' DESC, c.created_at DESC"));
});

r.patch('/certificates/:id/review', h((req, res) => {
  const { status } = req.body || {};
  const remarks = clean(req.body?.remarks, 500, 'Remarks');
  if (!['Verified', 'Rejected', 'Pending'].includes(status)) throw new HttpError(400, 'Status must be Verified, Rejected or Pending');
  if (status === 'Rejected' && !remarks) throw new HttpError(400, 'Please give a reason when rejecting, so the student knows what to fix');
  const out = status === 'Pending'
    ? db.prepare('UPDATE certificates SET status = ?, remarks = ?, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?').run(status, remarks, req.params.id)
    : db.prepare("UPDATE certificates SET status = ?, remarks = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?").run(status, remarks, req.user.id, req.params.id);
  if (!out.changes) throw new HttpError(404, 'Certificate not found');
  audit(req.user.id, `certificate_${status.toLowerCase()}`, 'certificate', Number(req.params.id), remarks);
  if (status !== 'Pending') {
    const c = db.prepare('SELECT c.title, s.user_id FROM certificates c JOIN students s ON s.id = c.student_id WHERE c.id = ?').get(req.params.id);
    notifyUser(c.user_id, {
      title: status === 'Verified' ? `Certificate verified: ${c.title}` : `Please re-upload: ${c.title}`,
      body: status === 'Verified' ? (remarks || 'Your certificate has been verified by the trust.') : `Reason: ${remarks}`,
      link: '/certificates', email: true,
      sms: status === 'Rejected' ? `BANA: your certificate "${c.title}" needs to be uploaded again. Reason: ${remarks}`.slice(0, 300) : false,
    });
  }
  res.json({ ok: true });
}));

r.delete('/certificates/:id', h((req, res) => {
  superOnly(req);
  const c = db.prepare('SELECT * FROM certificates WHERE id = ?').get(req.params.id);
  if (!c) throw new HttpError(404, 'Certificate not found');
  db.prepare('DELETE FROM certificates WHERE id = ?').run(c.id);
  fs.rm(path.join(UPLOAD_DIR, c.file_path), () => {});
  audit(req.user.id, 'delete', 'certificate', c.id, { title: c.title });
  res.json({ ok: true });
}));

/* ---------------- Aid ---------------- */

function aidQuery(req) {
  const where = ['1=1'], p = [];
  const { q, type, from, to, student_id } = req.query;
  if (q) { where.push('(u.name LIKE ? OR s.student_code LIKE ? OR a.notes LIKE ?)'); p.push(like(q), like(q), like(q)); }
  if (type) { where.push('a.type = ?'); p.push(type); }
  if (from) { where.push('a.given_on >= ?'); p.push(from); }
  if (to) { where.push('a.given_on <= ?'); p.push(to); }
  if (student_id) { where.push('a.student_id = ?'); p.push(student_id); }
  return [`SELECT a.*, u.name student_name, s.student_code FROM aid a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
           WHERE ${where.join(' AND ')}`, p];
}

r.get('/aid', (req, res) => {
  const [sql, p] = aidQuery(req);
  res.json(list(req, sql, p, 'a.given_on DESC, a.id DESC', { sumCol: 'amount' }));
});

r.post('/aid', h((req, res) => {
  const id = createAid(normId(req.body?.student_id, 'student'), req.body || {}, req.user.id);
  audit(req.user.id, 'create', 'aid', id, { amount: req.body.amount });
  res.status(201).json({ id });
}));

r.put('/aid/:id', h((req, res) => {
  const p = aidPayload(req.body || {});
  const out = db.prepare('UPDATE aid SET amount = ?, given_on = ?, type = ?, notes = ? WHERE id = ?').run(p.amount, p.given_on, p.type, p.notes, req.params.id);
  if (!out.changes) throw new HttpError(404, 'Record not found');
  audit(req.user.id, 'update', 'aid', Number(req.params.id), p);
  res.json({ ok: true });
}));

r.delete('/aid/:id', h((req, res) => {
  const out = db.prepare('DELETE FROM aid WHERE id = ?').run(req.params.id);
  if (!out.changes) throw new HttpError(404, 'Record not found');
  audit(req.user.id, 'delete', 'aid', Number(req.params.id));
  res.json({ ok: true });
}));

/* ---------------- Donors ---------------- */

function donorQuery(req) {
  const where = ['1=1'], p = [];
  const { q, donor_type, city } = req.query;
  if (q) { where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR d.city LIKE ? OR d.pan LIKE ?)'); p.push(...Array(5).fill(like(q))); }
  if (donor_type) { where.push('d.donor_type = ?'); p.push(donor_type); }
  if (city) { where.push('d.city = ?'); p.push(city); }
  return [`SELECT d.*, u.name, u.email, u.phone, u.is_active, u.last_login_at,
            (SELECT COALESCE(SUM(amount),0) FROM donations x WHERE x.donor_id = d.id) total_donated,
            (SELECT COUNT(*) FROM donations x WHERE x.donor_id = d.id) donation_count,
            (SELECT MAX(donated_on) FROM donations x WHERE x.donor_id = d.id) last_donation
          FROM donors d JOIN users u ON u.id = d.user_id WHERE ${where.join(' AND ')}`, p];
}

r.get('/donors', (req, res) => {
  const [sql, p] = donorQuery(req);
  res.json(list(req, sql, p, 'u.name COLLATE NOCASE', { sumCol: 'total_donated' }));
});

r.get('/donors/:id', h((req, res) => {
  const d = db.prepare('SELECT d.*, u.name, u.email, u.phone, u.is_active, u.last_login_at, u.created_at FROM donors d JOIN users u ON u.id = d.user_id WHERE d.id = ?').get(req.params.id);
  if (!d) throw new HttpError(404, 'Donor not found');
  const donations = db.prepare('SELECT * FROM donations WHERE donor_id = ? ORDER BY donated_on DESC, id DESC').all(d.id);
  res.json({ ...d, donations, total: donations.reduce((s, x) => s + x.amount, 0) });
}));

r.post('/donors', h((req, res) => {
  const out = tx(() => saveDonor(req.body || {}));
  if (!out.created) throw new HttpError(409, `A donor with email ${req.body.email} already exists`);
  audit(req.user.id, 'create', 'donor', out.id, { name: req.body.name, email: req.body.email });
  res.status(201).json(out);
}));

r.put('/donors/:id', h((req, res) => {
  const out = tx(() => saveDonor(req.body || {}, { id: Number(req.params.id) }));
  audit(req.user.id, 'update', 'donor', out.id);
  res.json(out);
}));

r.delete('/donors/:id', h((req, res) => {
  superOnly(req);
  const d = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.params.id);
  if (!d) throw new HttpError(404, 'Donor not found');
  db.prepare('DELETE FROM users WHERE id = ?').run(d.user_id);
  audit(req.user.id, 'delete', 'donor', d.id);
  res.json({ ok: true });
}));

/* ---------------- Donations ---------------- */

function donationQuery(req) {
  const where = ['1=1'], p = [];
  const { q, donor_id, mode, purpose, from, to, fy } = req.query;
  if (q) { where.push('(u.name LIKE ? OR u.email LIKE ? OR dn.receipt_no LIKE ? OR dn.reference_no LIKE ?)'); p.push(...Array(4).fill(like(q))); }
  if (donor_id) { where.push('dn.donor_id = ?'); p.push(donor_id); }
  if (mode) { where.push('dn.mode = ?'); p.push(mode); }
  if (purpose) { where.push('dn.purpose = ?'); p.push(purpose); }
  if (from) { where.push('dn.donated_on >= ?'); p.push(from); }
  if (to) { where.push('dn.donated_on <= ?'); p.push(to); }
  if (fy && /^\d{4}-\d{2}$/.test(fy)) { const y = Number(fy.slice(0, 4)); where.push('dn.donated_on BETWEEN ? AND ?'); p.push(`${y}-04-01`, `${y + 1}-03-31`); }
  if (req.query.project_id) { where.push('dn.project_id = ?'); p.push(req.query.project_id); }
  return [`SELECT dn.*, u.name donor_name, u.email donor_email, d.pan donor_pan, pr.name project_name FROM donations dn JOIN donors d ON d.id = dn.donor_id JOIN users u ON u.id = d.user_id
           LEFT JOIN projects pr ON pr.id = dn.project_id
           WHERE ${where.join(' AND ')}`, p];
}

r.get('/donations', (req, res) => {
  const [sql, p] = donationQuery(req);
  res.json(list(req, sql, p, 'dn.donated_on DESC, dn.id DESC', { sumCol: 'amount' }));
});

r.post('/donations', h((req, res) => {
  const id = createDonation(normId(req.body?.donor_id, 'donor'), req.body || {}, req.user.id);
  audit(req.user.id, 'create', 'donation', id, { amount: req.body.amount, donor_id: req.body.donor_id });
  if (req.body.notify !== false) notifyDonation(id);
  res.status(201).json({ id });
}));

r.put('/donations/:id', h((req, res) => {
  const p = donationPayload(req.body || {});
  const donorId = normId(req.body?.donor_id, 'donor');
  if (!db.prepare('SELECT id FROM donors WHERE id = ?').get(donorId)) throw new HttpError(400, 'Donor not found');
  assertUniqueReference(p, Number(req.params.id));
  const links = donationLinks(req.body || {}, donorId);
  const out = db.prepare('UPDATE donations SET donor_id = ?, amount = ?, donated_on = ?, mode = ?, purpose = ?, reference_no = ?, notes = ?, project_id = ?, pledge_id = ? WHERE id = ?')
    .run(donorId, p.amount, p.donated_on, p.mode, p.purpose, p.reference_no, p.notes, links.project_id, links.pledge_id, req.params.id);
  if (!out.changes) throw new HttpError(404, 'Donation not found');
  audit(req.user.id, 'update', 'donation', Number(req.params.id), p);
  res.json({ ok: true });
}));

r.delete('/donations/:id', h((req, res) => {
  const d = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!d) throw new HttpError(404, 'Donation not found');
  db.prepare('DELETE FROM donations WHERE id = ?').run(d.id);
  audit(req.user.id, 'delete', 'donation', d.id, { amount: d.amount, receipt_no: d.receipt_no });
  res.json({ ok: true });
}));

/* ---------------- Announcements ---------------- */

function announcementPayload(b = {}) {
  const title = clean(b.title, 160, 'Title'), body = clean(b.body, 5000, 'Message');
  if (!title || !body) throw new HttpError(400, 'Title and message are required');
  const audience = ['all', 'students', 'donors'].includes(b.audience) ? b.audience : 'all';
  return [title, body, audience, b.pinned ? 1 : 0];
}

r.post('/announcements', h((req, res) => {
  const out = db.prepare('INSERT INTO announcements (title, body, audience, pinned, created_by) VALUES (?, ?, ?, ?, ?)').run(...announcementPayload(req.body), req.user.id);
  audit(req.user.id, 'create', 'announcement', Number(out.lastInsertRowid), { title: req.body.title });
  res.status(201).json({ id: Number(out.lastInsertRowid) });
}));

r.put('/announcements/:id', h((req, res) => {
  const out = db.prepare('UPDATE announcements SET title = ?, body = ?, audience = ?, pinned = ? WHERE id = ?').run(...announcementPayload(req.body), req.params.id);
  if (!out.changes) throw new HttpError(404, 'Announcement not found');
  audit(req.user.id, 'update', 'announcement', Number(req.params.id));
  res.json({ ok: true });
}));

r.delete('/announcements/:id', h((req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'delete', 'announcement', Number(req.params.id));
  res.json({ ok: true });
}));

/* ---------------- Account actions (students/donors for admins; anyone for super admin) ---------------- */

function targetUser(req) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'User not found');
  if (ADMIN_ROLES.includes(u.role) && !isSuper(req)) throw new HttpError(403, 'Only the Super Admin can manage admin accounts');
  return u;
}

r.post('/users/:id/reset-password', h((req, res) => {
  const u = targetUser(req);
  const pw = (typeof req.body?.password === 'string' && req.body.password.trim()) || getSettings().default_password;
  checkPassword(pw, { email: u.email, name: u.name, studentCode: u.student_code });
  // Resetting also unlocks the account and signs the user out everywhere
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = ?')
    .run(hashPassword(pw), u.id);
  audit(req.user.id, 'reset_password', 'user', u.id, { name: u.name });
  res.json({ ok: true, password: pw });
}));

r.patch('/users/:id/active', h((req, res) => {
  const u = targetUser(req);
  const active = req.body?.active ? 1 : 0;
  if (u.id === req.user.id) throw new HttpError(400, 'You cannot deactivate your own account');
  if (!active && u.role === 'super_admin') {
    const others = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'super_admin' AND is_active = 1 AND id != ?").get(u.id).n;
    if (!others) throw new HttpError(400, 'There must always be at least one active Super Admin');
  }
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active, u.id);
  if (!active) revokeSessions(u.id);
  audit(req.user.id, active ? 'activate' : 'deactivate', 'user', u.id, { name: u.name });
  res.json({ ok: true });
}));

/* ---------------- Excel export ---------------- */

const LOCAL_EXPORTS = {
  students: {
    query: studentQuery,
    order: 'u.name COLLATE NOCASE',
    columns: [
      { header: 'Student ID', key: 'student_code' }, { header: 'Full Name', key: 'name', width: 24 }, { header: 'Email', key: 'email', width: 26 },
      { header: 'Phone', key: 'phone' }, { header: 'Gender', key: 'gender', width: 10 }, { header: 'Date of Birth', key: 'dob' },
      { header: 'Guardian Name', key: 'guardian_name', width: 22 }, { header: 'Guardian Phone', key: 'guardian_phone' }, { header: 'Address', key: 'address', width: 28 },
      { header: 'Village', key: 'village' }, { header: 'School / College', key: 'school', width: 26 }, { header: 'Class / Year', key: 'class_year' },
      { header: 'Programme', key: 'programme', width: 22 }, { header: 'Joined On', key: 'joined_on' }, { header: 'Status', key: 'status', width: 10 },
      { header: 'Certificates', key: 'cert_count', width: 12 }, { header: 'Aid Received', key: 'aid_total', numFmt: inr },
    ],
  },
  donors: {
    query: donorQuery,
    order: 'u.name COLLATE NOCASE',
    columns: [
      { header: 'Full Name', key: 'name', width: 24 }, { header: 'Email', key: 'email', width: 26 }, { header: 'Phone', key: 'phone' },
      { header: 'PAN', key: 'pan' }, { header: 'Address', key: 'address', width: 28 }, { header: 'City', key: 'city' }, { header: 'Donor Type', key: 'donor_type' },
      { header: 'Donations', key: 'donation_count', width: 11 }, { header: 'Total Donated', key: 'total_donated', numFmt: inr }, { header: 'Last Donation', key: 'last_donation' },
    ],
  },
  donations: {
    query: donationQuery,
    order: 'dn.donated_on DESC, dn.id DESC',
    columns: [
      { header: 'Receipt No', key: 'receipt_no', width: 20 }, { header: 'Date', key: 'donated_on', width: 12 }, { header: 'Donor', key: 'donor_name', width: 24 },
      { header: 'Donor Email', key: 'donor_email', width: 26 }, { header: 'PAN', key: 'donor_pan' }, { header: 'Amount', key: 'amount', numFmt: inr },
      { header: 'Mode', key: 'mode', width: 14 }, { header: 'Purpose', key: 'purpose', width: 22 }, { header: 'Reference No', key: 'reference_no', width: 20 }, { header: 'Notes', key: 'notes', width: 30 },
    ],
  },
  aid: {
    query: aidQuery,
    order: 'a.given_on DESC, a.id DESC',
    columns: [
      { header: 'Date', key: 'given_on', width: 12 }, { header: 'Student ID', key: 'student_code' }, { header: 'Student', key: 'student_name', width: 24 },
      { header: 'Type', key: 'type', width: 14 }, { header: 'Amount', key: 'amount', numFmt: inr }, { header: 'Notes', key: 'notes', width: 30 },
    ],
  },
  certificates: {
    query: certQuery,
    order: 'c.created_at DESC',
    columns: [
      { header: 'Uploaded', key: 'created_at', width: 20 }, { header: 'Student ID', key: 'student_code' }, { header: 'Student', key: 'student_name', width: 24 },
      { header: 'Title', key: 'title', width: 30 }, { header: 'Category', key: 'category', width: 14 }, { header: 'Issued On', key: 'issued_on', width: 12 },
      { header: 'Status', key: 'status', width: 11 }, { header: 'Remarks', key: 'remarks', width: 30 }, { header: 'Reviewed By', key: 'reviewer', width: 20 },
    ],
  },
};

for (const [type, def] of Object.entries(LOCAL_EXPORTS)) registerExport(type, def);

r.get('/export/:type', h(async (req, res) => {
  const ex = Object.hasOwn(EXPORTS, req.params.type) ? EXPORTS[req.params.type] : null;
  if (!ex) throw new HttpError(404, 'Unknown export');
  const [sql, p] = ex.query(req);
  const { rows } = list(req, sql, p, ex.order, { exportAll: true });
  audit(req.user.id, 'export', req.params.type, null, { rows: rows.length });
  const date = new Date().toISOString().slice(0, 10);
  await sendWorkbook(res, `bana-${req.params.type}-${date}.xlsx`, req.params.type, ex.columns, rows);
}));

/* ---------------- Excel import ---------------- */

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => (/\.(xlsx|csv)$/i.test(file.originalname) ? cb(null, true) : cb(new HttpError(400, 'Please upload an .xlsx or .csv file'))),
});

r.get('/imports/template/:type', h(async (req, res) => {
  const buf = await templateWorkbook(req.params.type);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bana-${req.params.type}-template.xlsx"`);
  res.send(Buffer.from(buf));
}));

r.post('/imports/preview', importUpload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Please choose a file');
  if (!IMPORT_TYPES[req.body.type]) throw new HttpError(400, 'Choose what you are importing');
  const { matched, rows } = await parseImport(req.body.type, req.file.buffer, req.file.originalname);
  if (!rows.length) throw new HttpError(400, 'No data rows found under the header row');
  const result = runImport(req.body.type, rows, req.user.id, { dryRun: true });
  res.json({ fileName: req.file.originalname, type: req.body.type, matched, rows, ...result });
}));

r.post('/imports/commit', h((req, res) => {
  const { type, rows } = req.body || {};
  if (!IMPORT_TYPES[type]) throw new HttpError(400, 'Unknown import type');
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'Nothing to import');
  if (rows.length > 5000) throw new HttpError(400, 'Please import at most 5,000 rows at a time');
  if (rows.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) throw new HttpError(400, 'Invalid import data');
  const fileName = clean(req.body.fileName, 200, 'File name') || 'upload';
  const result = runImport(type, rows, req.user.id, { dryRun: false });
  const out = db.prepare('INSERT INTO imports (type, file_name, created, updated, skipped, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(type, String(fileName || 'upload'), result.created, result.updated, result.skipped, req.user.id);
  audit(req.user.id, 'import', type, Number(out.lastInsertRowid), { file: fileName, created: result.created, updated: result.updated, skipped: result.skipped });
  res.json(result);
}));

r.get('/imports', (_req, res) => {
  res.json(db.prepare('SELECT i.*, u.name by_name FROM imports i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.created_at DESC LIMIT 50').all());
});

export default r;
