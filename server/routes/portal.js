import { Router } from 'express';
import { db, audit, fyOf, getSettings } from '../db.js';
import { h, HttpError, requireAuth, requireRole, validateIdParams, studentFor, donorFor, ADMIN_ROLES } from '../auth.js';
import { clean, normId } from '../services.js';
import { amount } from '../fields.js';
import { checklistFor, progressFor, privateName, pledgeStatus } from '../academics.js';
import { notifyAdmins } from '../notify.js';
import { imageUpload, acceptImage, removeUpload, sendUpload } from '../uploads.js';
import { donorStatement } from '../pdf.js';
import { sendIdCard } from './programs.js';
import { paymentsConfigured, createOrder, verifyCheckoutSignature, finalizePayment, MIN_ONLINE, MAX_ONLINE } from '../payments.js';
import { rateLimit } from '../security.js';

const r = Router();
r.use(requireAuth);
validateIdParams(r, 'id');

/* ---------------- Notifications (every role) ---------------- */

r.get('/notifications', (req, res) => {
  res.json({
    rows: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id),
    unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n,
  });
});

r.post('/notifications/read', h((req, res) => {
  if (req.body?.all) {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
  } else {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200).map((i) => normId(i)) : [];
    if (ids.length) db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`).run(req.user.id, ...ids);
  }
  res.json({ ok: true });
}));

/* ---------------- Shared images ---------------- */

/** Student photo: the student, admins, and donors actively sponsoring that student */
r.get('/photos/students/:id', h((req, res) => {
  const st = db.prepare('SELECT id, user_id, photo_path FROM students WHERE id = ?').get(req.params.id);
  if (!st?.photo_path) throw new HttpError(404, 'No photo');
  const allowed = ADMIN_ROLES.includes(req.user.role) || st.user_id === req.user.id
    || (req.user.role === 'donor' && db.prepare('SELECT 1 FROM sponsorships sp JOIN donors d ON d.id = sp.donor_id WHERE d.user_id = ? AND sp.student_id = ? AND sp.active = 1').get(req.user.id, st.id));
  if (!allowed) throw new HttpError(404, 'No photo');
  sendUpload(res, 'photos', st.photo_path);
}));

r.get('/stories/:id/image', h((req, res) => {
  const s = db.prepare('SELECT image_path, published FROM stories WHERE id = ?').get(req.params.id);
  if (!s || (!s.published && !ADMIN_ROLES.includes(req.user.role))) throw new HttpError(404, 'Image not found');
  sendUpload(res, 'stories', s.image_path);
}));

const storySelect = `SELECT s.id, s.title, s.body, s.village, s.created_at, s.project_id, p.name project_name, s.image_path IS NOT NULL has_image
  FROM stories s LEFT JOIN projects p ON p.id = s.project_id WHERE s.published = 1`;

r.get('/stories', (req, res) => {
  let funded = new Set();
  if (req.user.role === 'donor') {
    const d = donorFor(req.user.id);
    funded = new Set(db.prepare('SELECT DISTINCT project_id FROM donations WHERE donor_id = ? AND project_id IS NOT NULL').all(d?.id ?? 0).map((x) => x.project_id));
  }
  res.json(db.prepare(`${storySelect} ORDER BY s.created_at DESC LIMIT 50`).all().map((s) => ({ ...s, funded_by_me: funded.has(s.project_id) })));
});

/* ---------------- Student ---------------- */

const student = Router();
validateIdParams(student, 'id');
student.use(requireRole('student'));
student.use((req, _res, next) => {
  req.student = studentFor(req.user.id);
  next(req.student ? undefined : new HttpError(404, 'Student record not found'));
});

student.get('/progress', (req, res) => {
  const s = getSettings();
  res.json({ ...progressFor(req.student.id), marksThreshold: Number(s.marks_threshold), attendanceThreshold: Number(s.attendance_threshold) });
});

student.get('/checklist', (req, res) => res.json(checklistFor(req.student)));

student.get('/scholarships', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const open = db.prepare(`SELECT c.*, (SELECT id FROM scholarship_applications a WHERE a.call_id = c.id AND a.student_id = ?) applied_id
    FROM scholarship_calls c WHERE c.status = 'Open' AND c.deadline >= ? AND (c.programme IS NULL OR c.programme = '' OR c.programme = ?) ORDER BY c.deadline`)
    .all(req.student.id, today, req.student.programme || '');
  const mine = db.prepare(`SELECT a.*, c.title call_title, c.max_amount FROM scholarship_applications a JOIN scholarship_calls c ON c.id = a.call_id
    WHERE a.student_id = ? ORDER BY a.created_at DESC`).all(req.student.id);
  res.json({ open, mine });
});

student.post('/scholarships/:id/apply', h((req, res) => {
  const c = db.prepare('SELECT * FROM scholarship_calls WHERE id = ?').get(req.params.id);
  const today = new Date().toISOString().slice(0, 10);
  if (!c || c.status !== 'Open' || c.deadline < today) throw new HttpError(400, 'This scholarship is not open for applications');
  if (c.programme && c.programme !== req.student.programme) throw new HttpError(403, `This scholarship is only for the ${c.programme} programme`);
  if (req.student.status !== 'Active') throw new HttpError(403, 'Only active students can apply');
  if (db.prepare('SELECT 1 FROM scholarship_applications WHERE call_id = ? AND student_id = ?').get(c.id, req.student.id)) throw new HttpError(409, 'You have already applied for this scholarship');
  const amt = amount('Amount requested')(req.body?.amount_requested);
  if (amt > c.max_amount) throw new HttpError(400, `You can request at most Rs. ${c.max_amount.toLocaleString('en-IN')}`);
  const reason = clean(req.body?.reason, 2000, 'Reason');
  if (!reason || reason.length < 20) throw new HttpError(400, 'Please explain why you need this scholarship (at least 20 characters)');
  const certIds = Array.isArray(req.body?.certificate_ids) ? [...new Set(req.body.certificate_ids.slice(0, 20).map((i) => normId(i, 'certificate')))] : [];
  if (certIds.length) {
    const own = db.prepare(`SELECT COUNT(*) n FROM certificates WHERE student_id = ? AND id IN (${certIds.map(() => '?').join(',')})`).get(req.student.id, ...certIds).n;
    if (own !== certIds.length) throw new HttpError(400, 'You can only attach your own certificates');
  }
  const out = db.prepare('INSERT INTO scholarship_applications (call_id, student_id, amount_requested, reason, certificate_ids) VALUES (?, ?, ?, ?, ?)')
    .run(c.id, req.student.id, amt, reason, JSON.stringify(certIds));
  audit(req.user.id, 'scholarship_apply', 'scholarship_application', Number(out.lastInsertRowid), { call: c.title, amount: amt });
  notifyAdmins({ title: 'New scholarship application', body: `${req.user.name} applied for "${c.title}"`, link: '/scholarships' });
  res.status(201).json({ id: Number(out.lastInsertRowid) });
}));

student.delete('/applications/:id', h((req, res) => {
  const a = db.prepare('SELECT * FROM scholarship_applications WHERE id = ? AND student_id = ?').get(req.params.id, req.student.id);
  if (!a) throw new HttpError(404, 'Application not found');
  if (a.status !== 'Submitted') throw new HttpError(400, 'You can only withdraw an application before it is reviewed');
  db.prepare('DELETE FROM scholarship_applications WHERE id = ?').run(a.id);
  audit(req.user.id, 'scholarship_withdraw', 'scholarship_application', a.id);
  res.json({ ok: true });
}));

student.get('/events', (req, res) => {
  res.json({
    upcoming: db.prepare("SELECT id, title, event_date, location, description FROM events WHERE status = 'Upcoming' AND event_date >= date('now') ORDER BY event_date LIMIT 20").all(),
    attended: db.prepare('SELECT e.id, e.title, e.event_date, e.location FROM event_attendees a JOIN events e ON e.id = a.event_id WHERE a.student_id = ? ORDER BY e.event_date DESC').all(req.student.id),
  });
});

const photoUpload = imageUpload('photos', 2);
student.post('/photo', photoUpload.single('photo'), h((req, res) => {
  const file = acceptImage(req.file);
  db.prepare('UPDATE students SET photo_path = ? WHERE id = ?').run(file, req.student.id);
  removeUpload('photos', req.student.photo_path);
  audit(req.user.id, 'update_photo', 'student', req.student.id);
  res.json({ ok: true });
}));

student.delete('/photo', h((req, res) => {
  db.prepare('UPDATE students SET photo_path = NULL WHERE id = ?').run(req.student.id);
  removeUpload('photos', req.student.photo_path);
  res.json({ ok: true });
}));

student.get('/id-card', h((req, res) => sendIdCard(req, res, req.student.id)));

r.use('/student', student);

/* ---------------- Donor ---------------- */

const donor = Router();
validateIdParams(donor, 'id');
donor.use(requireRole('donor'));
donor.use((req, _res, next) => {
  req.donor = donorFor(req.user.id);
  next(req.donor ? undefined : new HttpError(404, 'Donor record not found'));
});

donor.get('/projects', (req, res) => {
  res.json(db.prepare(`SELECT p.id, p.name, p.description, p.village, p.goal_amount, p.status, p.start_date, p.end_date,
      (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.project_id = p.id) raised,
      (SELECT COUNT(DISTINCT donor_id) FROM donations d WHERE d.project_id = p.id) donors,
      (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.project_id = p.id AND d.donor_id = ?) my_total
    FROM projects p WHERE p.status != 'On hold' ORDER BY p.status = 'Active' DESC, p.created_at DESC`).all(req.donor.id));
});

/** Sponsored students — privacy-limited: first name + initial, no contact details or address */
donor.get('/sponsorships', (req, res) => {
  const rows = db.prepare(`SELECT sp.id, sp.start_date, sp.end_date, sp.annual_amount, s.id student_id, u.name, s.class_year, s.school, s.programme, s.village, s.status,
      s.photo_path IS NOT NULL has_photo,
      (SELECT COUNT(*) FROM certificates c WHERE c.student_id = s.id AND c.status = 'Verified') certificates_verified,
      (SELECT COALESCE(SUM(amount),0) FROM aid a WHERE a.student_id = s.id) aid_total
    FROM sponsorships sp JOIN students s ON s.id = sp.student_id JOIN users u ON u.id = s.user_id
    WHERE sp.donor_id = ? AND sp.active = 1 ORDER BY sp.start_date`).all(req.donor.id);
  res.json(rows.map(({ name, ...x }) => {
    const p = progressFor(x.student_id);
    return {
      ...x, name: privateName(name), latestMarks: p.latestMarks, attendancePct: p.attendancePct,
      marks: p.marks.map((m) => ({ label: `${m.term} ${m.academic_year}`, value: m.percentage })),
      achievements: db.prepare("SELECT title, category, issued_on FROM certificates WHERE student_id = ? AND status = 'Verified' AND category IN ('Academic','Sports','Cultural','Skill/Training') ORDER BY created_at DESC LIMIT 5").all(x.student_id),
    };
  }));
});

donor.get('/pledges', (req, res) => {
  res.json(db.prepare('SELECT pl.*, pr.name project_name FROM pledges pl LEFT JOIN projects pr ON pr.id = pl.project_id WHERE pl.donor_id = ? ORDER BY pl.status = \'Active\' DESC, pl.start_date DESC')
    .all(req.donor.id).map((p) => ({ ...p, ...pledgeStatus(p) })));
});

donor.get('/statement-years', (req, res) => {
  const years = [...new Set(db.prepare('SELECT donated_on FROM donations WHERE donor_id = ? ORDER BY donated_on DESC').all(req.donor.id).map((d) => fyOf(d.donated_on)))];
  res.json(years);
});

donor.get('/statement', h((req, res) => {
  const fy = clean(req.query.fy, 7, 'Financial year');
  const m = fy?.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new HttpError(400, 'Choose a financial year');
  const donations = db.prepare('SELECT * FROM donations WHERE donor_id = ? AND donated_on BETWEEN ? AND ? ORDER BY donated_on')
    .all(req.donor.id, `${m[1]}-04-01`, `${Number(m[1]) + 1}-03-31`);
  if (!donations.length) throw new HttpError(404, `No donations in FY ${fy}`);
  const d = db.prepare('SELECT d.*, u.name, u.email FROM donors d JOIN users u ON u.id = d.user_id WHERE d.id = ?').get(req.donor.id);
  audit(req.user.id, 'statement_80g', 'donor', req.donor.id, { fy });
  return donorStatement(res, { donor: d, donations, fy });
}));

/* Online donations */

donor.get('/payments/config', (_req, res) => {
  const s = getSettings();
  res.json({
    enabled: paymentsConfigured(), keyId: paymentsConfigured() ? process.env.RAZORPAY_KEY_ID : null, min: MIN_ONLINE, max: MAX_ONLINE,
    bank: { name: s.bank_name, account: s.bank_account, ifsc: s.bank_ifsc, upi: s.upi_id, trust: s.trust_name },
  });
});

const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'Too many payment attempts. Please try again later' });

donor.post('/payments/order', orderLimiter, h(async (req, res) => {
  if (!paymentsConfigured()) throw new HttpError(503, 'Online payments are not set up yet. Please use bank transfer or UPI');
  const amt = amount()(req.body?.amount);
  if (amt < MIN_ONLINE || amt > MAX_ONLINE) throw new HttpError(400, `Online donations must be between Rs. ${MIN_ONLINE} and Rs. ${MAX_ONLINE.toLocaleString('en-IN')}`);
  const purpose = clean(req.body?.purpose, 100, 'Purpose') || 'General Fund';
  const projectId = req.body?.project_id ? normId(req.body.project_id, 'project') : null;
  if (projectId && !db.prepare("SELECT 1 FROM projects WHERE id = ? AND status = 'Active'").get(projectId)) throw new HttpError(400, 'That project is not accepting donations');
  const pledgeId = req.body?.pledge_id ? normId(req.body.pledge_id, 'pledge') : null;
  if (pledgeId && !db.prepare('SELECT 1 FROM pledges WHERE id = ? AND donor_id = ?').get(pledgeId, req.donor.id)) throw new HttpError(400, 'Pledge not found');
  const order = await createOrder({ amount: amt, receipt: `D${req.donor.id}-${Date.now()}`, notes: { donor_id: String(req.donor.id), purpose } });
  db.prepare('INSERT INTO payments (donor_id, order_id, amount, purpose, project_id, pledge_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.donor.id, order.id, amt, purpose, projectId, pledgeId);
  audit(req.user.id, 'payment_order', 'payment', null, { order: order.id, amount: amt });
  res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, name: req.user.name, email: req.user.email, phone: req.user.phone });
}));

donor.post('/payments/verify', h((req, res) => {
  const { order_id: orderId, payment_id: paymentId, signature } = req.body || {};
  const p = db.prepare('SELECT * FROM payments WHERE order_id = ? AND donor_id = ?').get(String(orderId || ''), req.donor.id);
  if (!p) throw new HttpError(404, 'Payment not found');
  if (!verifyCheckoutSignature(p.order_id, String(paymentId || ''), String(signature || ''))) {
    db.prepare("UPDATE payments SET status = 'failed', error = 'signature mismatch' WHERE id = ? AND status = 'created'").run(p.id);
    audit(req.user.id, 'payment_signature_invalid', 'payment', p.id);
    throw new HttpError(400, 'We could not verify this payment. If money was deducted, it will be confirmed automatically or refunded by Razorpay');
  }
  const donationId = finalizePayment(p.order_id, String(paymentId), 'checkout');
  res.json({ ok: true, donationId });
}));

r.use('/donor', donor);

export default r;
