import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { db, audit, fyRange, fyOf, getSettings, UPLOAD_DIR } from '../db.js';
import { h, HttpError, requireAuth, requireRole, studentFor, donorFor, validateIdParams, ADMIN_ROLES } from '../auth.js';
import { clean, normDate, normPhone, pick, CERT_CATEGORIES } from '../services.js';
import { sniffFileType, safeFileName } from '../security.js';
import { notifyAdmins } from '../notify.js';

const r = Router();
r.use(requireAuth);
validateIdParams(r, 'id');

const MAX_CERTIFICATES = 100; // per student

const ALLOWED = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
export const certUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, fieldSize: 2000 },
  fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Only PDF, JPG and PNG files are allowed'))),
});

const announcementsFor = (role, limit = 50) =>
  db.prepare(`SELECT a.*, u.name AS author FROM announcements a LEFT JOIN users u ON u.id = a.created_by
              WHERE ? OR a.audience IN ('all', ?) ORDER BY a.pinned DESC, a.created_at DESC LIMIT ?`)
    .all(ADMIN_ROLES.includes(role) ? 1 : 0, role === 'student' ? 'students' : 'donors', limit);

r.get('/announcements', (req, res) => res.json(announcementsFor(req.user.role)));

/* ---------------- Student ---------------- */

const student = Router();
validateIdParams(student, 'id');
student.use(requireRole('student'));
student.use((req, _res, next) => {
  req.student = studentFor(req.user.id);
  next(req.student ? undefined : new HttpError(404, 'Student record not found'));
});

student.get('/dashboard', (req, res) => {
  const s = req.student;
  const certs = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM certificates WHERE student_id = ? GROUP BY status').all(s.id).map((x) => [x.status, x.n]));
  const aid = db.prepare('SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM aid WHERE student_id = ?').get(s.id);
  const profileFields = ['gender', 'dob', 'guardian_name', 'guardian_phone', 'address', 'village', 'school', 'class_year'];
  const filled = profileFields.filter((f) => s[f]).length + (req.user.email ? 1 : 0) + (req.user.phone ? 1 : 0);
  res.json({
    certificates: { Pending: certs.Pending || 0, Verified: certs.Verified || 0, Rejected: certs.Rejected || 0 },
    aid,
    profileCompletion: Math.round((filled / (profileFields.length + 2)) * 100),
    recentCertificates: db.prepare('SELECT id, title, category, status, created_at FROM certificates WHERE student_id = ? ORDER BY created_at DESC LIMIT 5').all(s.id),
    announcements: announcementsFor('student', 3),
  });
});

student.get('/profile', (req, res) => res.json({ ...req.student, name: req.user.name, email: req.user.email, phone: req.user.phone }));

student.patch('/profile', h((req, res) => {
  const b = req.body || {};
  const phone = normPhone(b.phone);
  const address = clean(b.address, 300, 'Address');
  const guardianName = clean(b.guardian_name, 120, 'Guardian name');
  const guardianPhone = normPhone(b.guardian_phone, 'Guardian phone');
  db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.user.id);
  db.prepare('UPDATE students SET address = ?, guardian_name = ?, guardian_phone = ? WHERE id = ?')
    .run(address, guardianName, guardianPhone, req.student.id);
  audit(req.user.id, 'update_profile', 'student', req.student.id);
  res.json({ ok: true });
}));

student.get('/certificates', (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.title, c.category, c.issued_on, c.file_name, c.mime_type, c.size, c.status, c.remarks, c.reviewed_at, c.created_at, c.requirement_id, r.name requirement_name
    FROM certificates c LEFT JOIN doc_requirements r ON r.id = c.requirement_id WHERE c.student_id = ? ORDER BY c.created_at DESC`).all(req.student.id));
});

student.post('/certificates', certUpload.single('file'), h((req, res) => {
  const f = req.file;
  try {
    if (!f) throw new HttpError(400, 'Please choose a file to upload');
    if (f.size === 0) throw new HttpError(400, 'The file is empty');
    // The browser's MIME type is only a hint — check the file's actual bytes
    const realType = sniffFileType(f.path);
    if (!realType) throw new HttpError(400, 'This file is not a real PDF, JPG or PNG. Please upload the original document');
    if (realType !== f.mimetype) throw new HttpError(400, `File content (${realType}) does not match its extension. Please upload the original document`);
    const title = clean(req.body.title, 150, 'Title');
    if (!title) throw new HttpError(400, 'Title is required');
    const category = pick(req.body.category, CERT_CATEGORIES, 'Other', 'Category');
    // Optional link to a document-checklist item
    let requirementId = null;
    if (req.body.requirement_id) {
      requirementId = Number(req.body.requirement_id);
      if (!Number.isSafeInteger(requirementId) || !db.prepare('SELECT 1 FROM doc_requirements WHERE id = ? AND active = 1').get(requirementId)) throw new HttpError(400, 'Unknown checklist item');
    }
    const issued = normDate(req.body.issued_on, 'Issue date', { min: '1990-01-01' });
    const count = db.prepare('SELECT COUNT(*) n FROM certificates WHERE student_id = ?').get(req.student.id).n;
    if (count >= MAX_CERTIFICATES) throw new HttpError(400, `You can keep at most ${MAX_CERTIFICATES} certificates. Please contact the office`);
    const out = db.prepare('INSERT INTO certificates (student_id, title, category, issued_on, file_path, file_name, mime_type, size, requirement_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.student.id, title, category, issued, f.filename, safeFileName(f.originalname, `certificate${ALLOWED[realType]}`), realType, f.size, requirementId);
    audit(req.user.id, 'upload_certificate', 'certificate', Number(out.lastInsertRowid), { title });
    notifyAdmins({ title: 'New certificate to review', body: `${req.user.name} uploaded "${title}"`, link: '/certificates' });
    res.status(201).json({ id: Number(out.lastInsertRowid) });
  } catch (e) {
    if (f) fs.rmSync(f.path, { force: true });
    throw e;
  }
}));

student.delete('/certificates/:id', h((req, res) => {
  const c = db.prepare('SELECT * FROM certificates WHERE id = ? AND student_id = ?').get(req.params.id, req.student.id);
  if (!c) throw new HttpError(404, 'Certificate not found');
  if (c.status !== 'Pending') throw new HttpError(400, 'Only pending certificates can be deleted');
  db.prepare('DELETE FROM certificates WHERE id = ?').run(c.id);
  fs.rm(path.join(UPLOAD_DIR, c.file_path), () => {});
  audit(req.user.id, 'delete_certificate', 'certificate', c.id, { title: c.title });
  res.json({ ok: true });
}));

student.get('/aid', (req, res) => {
  res.json(db.prepare('SELECT id, amount, given_on, type, notes FROM aid WHERE student_id = ? ORDER BY given_on DESC').all(req.student.id));
});

r.use('/student', student);

/* ---------------- Donor ---------------- */

const donor = Router();
donor.use(requireRole('donor'));
donor.use((req, _res, next) => {
  req.donor = donorFor(req.user.id);
  next(req.donor ? undefined : new HttpError(404, 'Donor record not found'));
});

export function impactStats() {
  return {
    activeStudents: db.prepare("SELECT COUNT(*) n FROM students WHERE status = 'Active'").get().n,
    certificatesVerified: db.prepare("SELECT COUNT(*) n FROM certificates WHERE status = 'Verified'").get().n,
    aidDisbursed: db.prepare('SELECT COALESCE(SUM(amount),0) n FROM aid').get().n,
    villages: db.prepare("SELECT COUNT(DISTINCT village) n FROM students WHERE village IS NOT NULL AND village != ''").get().n,
  };
}

donor.get('/dashboard', (req, res) => {
  const id = req.donor.id;
  const [from, to] = fyRange();
  const all = db.prepare('SELECT amount, donated_on FROM donations WHERE donor_id = ? ORDER BY donated_on').all(id);
  const byFy = {};
  for (const d of all) byFy[fyOf(d.donated_on)] = (byFy[fyOf(d.donated_on)] || 0) + d.amount;
  res.json({
    lifetime: all.reduce((s, d) => s + d.amount, 0),
    thisFy: all.filter((d) => d.donated_on >= from && d.donated_on <= to).reduce((s, d) => s + d.amount, 0),
    currentFy: fyOf(new Date().toISOString()),
    count: all.length,
    last: db.prepare('SELECT * FROM donations WHERE donor_id = ? ORDER BY donated_on DESC, id DESC LIMIT 1').get(id) || null,
    byFy: Object.entries(byFy).map(([fy, total]) => ({ fy, total })),
    impact: impactStats(),
    announcements: announcementsFor('donor', 3),
  });
});

donor.get('/donations', (req, res) => {
  const rows = db.prepare('SELECT * FROM donations WHERE donor_id = ? ORDER BY donated_on DESC, id DESC').all(req.donor.id);
  res.json(rows.map((d) => ({ ...d, fy: fyOf(d.donated_on) })));
});

donor.get('/profile', (req, res) => res.json({ ...req.donor, name: req.user.name, email: req.user.email, phone: req.user.phone }));

donor.patch('/profile', h((req, res) => {
  const b = req.body || {};
  const phone = normPhone(b.phone);
  const address = clean(b.address, 300, 'Address');
  const city = clean(b.city, 80, 'City');
  db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.user.id);
  db.prepare('UPDATE donors SET address = ?, city = ? WHERE id = ?').run(address, city, req.donor.id);
  audit(req.user.id, 'update_profile', 'donor', req.donor.id);
  res.json({ ok: true });
}));

r.use('/donor', donor);

/* ---------------- Shared: receipts and certificate files ---------------- */

r.get('/donations/:id/receipt', h((req, res) => {
  const d = db.prepare(`SELECT dn.*, u.name donor_name, u.email donor_email, u.phone donor_phone, d.pan, d.address, d.city, d.user_id
                        FROM donations dn JOIN donors d ON d.id = dn.donor_id JOIN users u ON u.id = d.user_id WHERE dn.id = ?`).get(req.params.id);
  if (!d || (!ADMIN_ROLES.includes(req.user.role) && d.user_id !== req.user.id)) throw new HttpError(404, 'Receipt not found');
  res.json({ donation: d, trust: getSettings() });
}));

r.get('/certificates/:id/file', h((req, res) => {
  const c = db.prepare('SELECT c.*, s.user_id FROM certificates c JOIN students s ON s.id = c.student_id WHERE c.id = ?').get(req.params.id);
  if (!c || (!ADMIN_ROLES.includes(req.user.role) && c.user_id !== req.user.id)) throw new HttpError(404, 'File not found');
  res.setHeader('Content-Type', c.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const ascii = c.file_name.replace(/[^\x20-\x7E]|["\\]/g, '_');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(c.file_name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  const file = path.join(UPLOAD_DIR, path.basename(c.file_path));
  if (!fs.existsSync(file)) throw new HttpError(410, 'This file is missing on the server. Please ask the student to upload it again');
  res.sendFile(file);
}));

export default r;
