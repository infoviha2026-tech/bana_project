import { Router } from 'express';
import { db, audit, tx, getSettings } from '../db.js';
import { h, HttpError, requireAuth, requireAdmin, validateIdParams, hmac } from '../auth.js';
import { crud } from '../crud.js';
import { queryGuard, INR_FMT } from '../listing.js';
import { text, amount, date, oneOf, bool, num, ref, month, academicYear, phone, email, name } from '../fields.js';
import { CERT_CATEGORIES, TERMS, EVENT_STATUSES, STUDENT_STATUSES, clean, normId, pick } from '../services.js';
import { checklistFor, progressFor, atRiskStudents, nextClass } from '../academics.js';
import { notifyUser } from '../notify.js';
import { imageUpload, acceptImage, removeUpload } from '../uploads.js';
import { studentIdCard } from '../pdf.js';

const r = Router();
r.use(requireAuth, requireAdmin);
validateIdParams(r, 'id');
r.use(queryGuard);

const studentJoin = 'JOIN students s ON s.id = x.student_id JOIN users u ON u.id = s.user_id';

/* ---------------- Marks ---------------- */

crud(r, {
  path: '/marks', table: 'marks', entity: 'marks', label: 'Marks record', alias: 'x',
  select: `SELECT x.*, u.name student_name, s.student_code FROM marks x ${studentJoin}`,
  search: ['u.name', 's.student_code'],
  filters: { student_id: 'x.student_id', academic_year: 'x.academic_year', term: 'x.term' },
  order: 'x.academic_year DESC, x.term, u.name',
  fields: {
    student_id: ref('students', 'Student', { req: true }),
    academic_year: academicYear(),
    term: oneOf(TERMS, 'Term'),
    percentage: num('Percentage', 0, 100),
    grade: text('Grade', 5),
    remarks: text('Remarks', 300),
  },
  validate(d, existing) {
    const dup = db.prepare('SELECT id FROM marks WHERE student_id = ? AND academic_year = ? AND term = ? AND id != ?').get(d.student_id, d.academic_year, d.term, existing?.id ?? 0);
    if (dup) throw new HttpError(409, `Marks for ${d.term} ${d.academic_year} are already recorded for this student`);
  },
  export: {
    type: 'marks',
    columns: [
      { header: 'Student ID', key: 'student_code' }, { header: 'Student', key: 'student_name', width: 24 }, { header: 'Academic Year', key: 'academic_year' },
      { header: 'Term', key: 'term' }, { header: 'Percentage', key: 'percentage' }, { header: 'Grade', key: 'grade' }, { header: 'Remarks', key: 'remarks', width: 30 },
    ],
  },
});

/* ---------------- Attendance ---------------- */

crud(r, {
  path: '/attendance', table: 'attendance', entity: 'attendance', label: 'Attendance record', alias: 'x',
  select: `SELECT x.*, ROUND(100.0 * x.days_present / x.days_total) pct, u.name student_name, s.student_code FROM attendance x ${studentJoin}`,
  search: ['u.name', 's.student_code'],
  filters: { student_id: 'x.student_id', month: 'x.month' },
  order: 'x.month DESC, u.name',
  fields: {
    student_id: ref('students', 'Student', { req: true }),
    month: month(),
    days_present: num('Days present', 0, 31, { integer: true }),
    days_total: num('Working days', 1, 31, { integer: true }),
  },
  validate(d, existing) {
    if (d.days_present > d.days_total) throw new HttpError(400, 'Days present cannot be more than working days');
    const dup = db.prepare('SELECT id FROM attendance WHERE student_id = ? AND month = ? AND id != ?').get(d.student_id, d.month, existing?.id ?? 0);
    if (dup) throw new HttpError(409, `Attendance for ${d.month} is already recorded for this student`);
  },
  export: {
    type: 'attendance',
    columns: [
      { header: 'Student ID', key: 'student_code' }, { header: 'Student', key: 'student_name', width: 24 }, { header: 'Month', key: 'month' },
      { header: 'Days Present', key: 'days_present' }, { header: 'Working Days', key: 'days_total' }, { header: 'Attendance %', key: 'pct' },
    ],
  },
});

r.get('/academics/at-risk', (_req, res) => {
  const s = getSettings();
  res.json({ rows: atRiskStudents(), marksThreshold: Number(s.marks_threshold), attendanceThreshold: Number(s.attendance_threshold) });
});

r.get('/students/:id/progress', h((req, res) => {
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!st) throw new HttpError(404, 'Student not found');
  res.json({ ...progressFor(st.id), checklist: checklistFor(st) });
}));

/* ---------------- Document checklist ---------------- */

crud(r, {
  path: '/doc-requirements', table: 'doc_requirements', entity: 'doc_requirement', label: 'Document requirement',
  order: 'sort, name',
  fields: {
    name: text('Document name', 120, { req: true }),
    category: oneOf(CERT_CATEGORIES, 'Category', 'Other'),
    programme: text('Programme', 100),
    description: text('Description', 300),
    active: bool(),
    sort: num('Order', 0, 999, { req: false, integer: true }),
  },
});

/* ---------------- Scholarships ---------------- */

crud(r, {
  path: '/scholarship-calls', table: 'scholarship_calls', entity: 'scholarship_call', label: 'Scholarship', alias: 'c', stamp: true,
  select: `SELECT c.*, (SELECT COUNT(*) FROM scholarship_applications a WHERE a.call_id = c.id) applications,
             (SELECT COUNT(*) FROM scholarship_applications a WHERE a.call_id = c.id AND a.status IN ('Submitted','Under review')) pending,
             (SELECT COALESCE(SUM(amount_approved),0) FROM scholarship_applications a WHERE a.call_id = c.id AND a.status = 'Approved') approved_total
           FROM scholarship_calls c`,
  search: ['c.title'], filters: { status: 'c.status' }, order: "c.status = 'Open' DESC, c.deadline DESC",
  fields: {
    title: text('Title', 150, { req: true }),
    description: text('Description', 3000),
    academic_year: academicYear('Academic year', { req: false }),
    programme: text('Eligible programme', 100),
    max_amount: amount('Maximum amount'),
    deadline: date('Deadline', { req: true, allowFuture: true }),
    status: oneOf(['Open', 'Closed'], 'Status'),
  },
  afterSave(id, d, created) {
    if (!created || d.status !== 'Open') return;
    const students = db.prepare(`SELECT user_id FROM students WHERE status = 'Active' AND (? IS NULL OR programme = ?)`).all(d.programme, d.programme);
    for (const s of students) notifyUser(s.user_id, { title: `Scholarship open: ${d.title}`, body: `Apply before ${d.deadline}.`, link: '/scholarships' });
  },
  beforeDelete(row) {
    if (db.prepare("SELECT 1 FROM scholarship_applications WHERE call_id = ? AND status = 'Approved'").get(row.id)) {
      throw new HttpError(400, 'This scholarship has approved applications. Close it instead of deleting');
    }
  },
});

const appSelect = `SELECT a.*, c.title call_title, c.max_amount, c.deadline, u.name student_name, s.student_code, s.class_year, s.school, rv.name reviewer
  FROM scholarship_applications a JOIN scholarship_calls c ON c.id = a.call_id JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
  LEFT JOIN users rv ON rv.id = a.reviewed_by`;

r.get('/scholarship-applications', (req, res) => {
  const where = ['1=1'], p = [];
  if (req.query.call_id) { where.push('a.call_id = ?'); p.push(req.query.call_id); }
  if (req.query.status) { where.push('a.status = ?'); p.push(req.query.status); }
  if (req.query.q) { where.push('(u.name LIKE ? OR s.student_code LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = db.prepare(`${appSelect} WHERE ${where.join(' AND ')} ORDER BY a.status IN ('Submitted','Under review') DESC, a.created_at DESC LIMIT 500`).all(...p);
  for (const row of rows) {
    const ids = JSON.parse(row.certificate_ids || '[]');
    row.certificates = ids.length ? db.prepare(`SELECT id, title, status, mime_type FROM certificates WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  }
  res.json(rows);
});

r.patch('/scholarship-applications/:id', h((req, res) => {
  const a = db.prepare(`${appSelect} WHERE a.id = ?`).get(req.params.id);
  if (!a) throw new HttpError(404, 'Application not found');
  if (['Approved', 'Rejected'].includes(a.status)) throw new HttpError(400, `This application is already ${a.status.toLowerCase()}`);
  const status = pick(req.body?.status, ['Under review', 'Approved', 'Rejected'], null, 'Status');
  if (!status) throw new HttpError(400, 'Choose a decision');
  const remarks = clean(req.body?.remarks, 500, 'Remarks');
  if (status === 'Rejected' && !remarks) throw new HttpError(400, 'Please give a reason when rejecting');
  let approved = null;
  if (status === 'Approved') {
    approved = amount('Approved amount')(req.body?.amount_approved ?? a.amount_requested);
    if (approved > a.max_amount) throw new HttpError(400, `Approved amount cannot exceed the scholarship maximum of Rs. ${a.max_amount}`);
  }
  tx(() => {
    let aidId = null;
    if (status === 'Approved') {
      aidId = Number(db.prepare("INSERT INTO aid (student_id, amount, given_on, type, notes, created_by) VALUES (?, ?, date('now'), 'Scholarship', ?, ?)")
        .run(a.student_id, approved, `${a.call_title} (application #${a.id})`, req.user.id).lastInsertRowid);
    }
    db.prepare("UPDATE scholarship_applications SET status = ?, amount_approved = ?, remarks = ?, aid_id = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
      .run(status, approved, remarks, aidId, req.user.id, a.id);
  });
  audit(req.user.id, `scholarship_${status.toLowerCase().replace(' ', '_')}`, 'scholarship_application', a.id, { amount: approved, remarks });
  const userId = db.prepare('SELECT user_id FROM students WHERE id = ?').get(a.student_id).user_id;
  if (status !== 'Under review') {
    notifyUser(userId, {
      title: status === 'Approved' ? `Scholarship approved: ${a.call_title}` : `Scholarship not approved: ${a.call_title}`,
      body: status === 'Approved' ? `Congratulations! Rs. ${approved.toLocaleString('en-IN')} has been approved.${remarks ? ` ${remarks}` : ''}` : `Reason: ${remarks}`,
      link: '/scholarships', email: true, sms: status === 'Approved' ? `BANA: your scholarship "${a.call_title}" of Rs. ${approved} is approved.` : false,
    });
  }
  res.json({ ok: true });
}));

/* ---------------- Sponsorships ---------------- */

crud(r, {
  path: '/sponsorships', table: 'sponsorships', entity: 'sponsorship', label: 'Sponsorship', alias: 'x',
  select: `SELECT x.*, du.name donor_name, du.email donor_email, u.name student_name, s.student_code, s.class_year, s.school, s.village
           FROM sponsorships x JOIN donors d ON d.id = x.donor_id JOIN users du ON du.id = d.user_id ${studentJoin}`,
  search: ['du.name', 'u.name', 's.student_code'],
  filters: { donor_id: 'x.donor_id', student_id: 'x.student_id', active: 'x.active' },
  order: 'x.active DESC, du.name, u.name',
  fields: {
    donor_id: ref('donors', 'Donor', { req: true }),
    student_id: ref('students', 'Student', { req: true }),
    start_date: date('Start date', { req: true, allowFuture: true }),
    end_date: date('End date', { allowFuture: true }),
    annual_amount: amount('Annual amount', { req: false }),
    notes: text('Notes', 300),
    active: bool(),
  },
  validate(d, existing) {
    if (d.end_date && d.end_date < d.start_date) throw new HttpError(400, 'End date cannot be before the start date');
    const dup = db.prepare('SELECT id FROM sponsorships WHERE donor_id = ? AND student_id = ? AND id != ?').get(d.donor_id, d.student_id, existing?.id ?? 0);
    if (dup) throw new HttpError(409, 'This donor already sponsors this student');
  },
  afterSave(id, d, created) {
    if (!created) return;
    const donorUser = db.prepare('SELECT user_id FROM donors WHERE id = ?').get(d.donor_id).user_id;
    notifyUser(donorUser, { title: 'You are now a sponsor', body: 'Thank you! You can follow your sponsored student’s progress in the portal.', link: '/sponsorships', email: true });
  },
  export: {
    type: 'sponsorships',
    columns: [
      { header: 'Donor', key: 'donor_name', width: 24 }, { header: 'Donor Email', key: 'donor_email', width: 26 }, { header: 'Student ID', key: 'student_code' },
      { header: 'Student', key: 'student_name', width: 24 }, { header: 'Start', key: 'start_date' }, { header: 'End', key: 'end_date' },
      { header: 'Annual Amount', key: 'annual_amount', numFmt: INR_FMT }, { header: 'Active', key: 'active' },
    ],
  },
});

/* ---------------- Events & volunteers ---------------- */

crud(r, {
  path: '/events', table: 'events', entity: 'event', label: 'Event', alias: 'e', stamp: true,
  select: `SELECT e.*, (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.id) attendees,
             (SELECT COALESCE(SUM(hours),0) FROM volunteer_hours v WHERE v.event_id = e.id) volunteer_hours FROM events e`,
  search: ['e.title', 'e.location'], filters: { status: 'e.status', from: 'e.event_date >=', to: 'e.event_date <=' },
  order: "e.status = 'Upcoming' DESC, e.event_date DESC",
  fields: {
    title: text('Title', 150, { req: true }),
    event_date: date('Date', { req: true, allowFuture: true }),
    location: text('Location', 150),
    description: text('Description', 3000),
    status: oneOf(EVENT_STATUSES, 'Status'),
  },
  afterSave(id, d, created, req) {
    if (created && d.status === 'Upcoming' && req.body.notify_students) {
      for (const s of db.prepare("SELECT user_id FROM students WHERE status = 'Active'").all()) {
        notifyUser(s.user_id, { title: `Event: ${d.title}`, body: `${d.event_date}${d.location ? ` at ${d.location}` : ''}`, link: '/events' });
      }
    }
  },
  detail(row) {
    return {
      ...row,
      attendeeList: db.prepare('SELECT s.id, s.student_code, u.name FROM event_attendees a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id WHERE a.event_id = ? ORDER BY u.name').all(row.id),
      hoursList: db.prepare('SELECT h.*, v.name volunteer_name FROM volunteer_hours h JOIN volunteers v ON v.id = h.volunteer_id WHERE h.event_id = ? ORDER BY h.worked_on DESC').all(row.id),
    };
  },
});

r.put('/events/:id/attendees', h((req, res) => {
  if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(req.params.id)) throw new HttpError(404, 'Event not found');
  const ids = req.body?.student_ids;
  if (!Array.isArray(ids) || ids.length > 2000) throw new HttpError(400, 'student_ids must be a list');
  const clean = [...new Set(ids.map((i) => normId(i, 'student')))];
  tx(() => {
    db.prepare('DELETE FROM event_attendees WHERE event_id = ?').run(req.params.id);
    const ins = db.prepare('INSERT INTO event_attendees (event_id, student_id) SELECT ?, id FROM students WHERE id = ?');
    for (const id of clean) ins.run(req.params.id, id);
  });
  audit(req.user.id, 'update_attendance', 'event', Number(req.params.id), { count: clean.length });
  res.json({ ok: true, count: clean.length });
}));

crud(r, {
  path: '/volunteers', table: 'volunteers', entity: 'volunteer', label: 'Volunteer', alias: 'v',
  select: `SELECT v.*, (SELECT COALESCE(SUM(hours),0) FROM volunteer_hours h WHERE h.volunteer_id = v.id) total_hours,
             (SELECT MAX(worked_on) FROM volunteer_hours h WHERE h.volunteer_id = v.id) last_active FROM volunteers v`,
  search: ['v.name', 'v.phone', 'v.email', 'v.skills', 'v.village'], filters: { active: 'v.active', village: 'v.village' },
  order: 'v.active DESC, v.name',
  fields: {
    name: name(), phone: phone(), email: email(),
    skills: text('Skills', 200), village: text('Village', 100),
    active: bool(), joined_on: date('Joined on'),
  },
  detail: (row) => ({ ...row, hours: db.prepare('SELECT h.*, e.title event_title FROM volunteer_hours h LEFT JOIN events e ON e.id = h.event_id WHERE h.volunteer_id = ? ORDER BY h.worked_on DESC').all(row.id) }),
  export: {
    type: 'volunteers',
    columns: [
      { header: 'Name', key: 'name', width: 24 }, { header: 'Phone', key: 'phone' }, { header: 'Email', key: 'email', width: 26 }, { header: 'Skills', key: 'skills', width: 26 },
      { header: 'Village', key: 'village' }, { header: 'Active', key: 'active' }, { header: 'Joined On', key: 'joined_on' }, { header: 'Total Hours', key: 'total_hours' },
    ],
  },
});

crud(r, {
  path: '/volunteer-hours', table: 'volunteer_hours', entity: 'volunteer_hours', label: 'Hours entry', alias: 'h',
  select: 'SELECT h.*, v.name volunteer_name, e.title event_title FROM volunteer_hours h JOIN volunteers v ON v.id = h.volunteer_id LEFT JOIN events e ON e.id = h.event_id',
  filters: { volunteer_id: 'h.volunteer_id', event_id: 'h.event_id', from: 'h.worked_on >=', to: 'h.worked_on <=' },
  order: 'h.worked_on DESC', sumCol: 'hours',
  fields: {
    volunteer_id: ref('volunteers', 'Volunteer', { req: true }),
    event_id: ref('events', 'Event'),
    worked_on: date('Date', { req: true }),
    hours: num('Hours', 0.25, 24),
    activity: text('Activity', 200),
  },
});

/* ---------------- Bulk actions ---------------- */

function bulkIds(body, max = 2000) {
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Select at least one record');
  if (ids.length > max) throw new HttpError(400, `Select at most ${max} records at a time`);
  return [...new Set(ids.map((i) => normId(i)))];
}

function bulkMessage(userIds, body, req) {
  const title = clean(body.title, 160, 'Title');
  const message = clean(body.body, 2000, 'Message');
  if (!title || !message) throw new HttpError(400, 'Title and message are required');
  for (const uid of userIds) notifyUser(uid, { title, body: message, email: !!body.email, sms: body.sms ? `${title}: ${message}`.slice(0, 300) : false });
  audit(req.user.id, 'bulk_message', 'users', null, { count: userIds.length, title, email: !!body.email, sms: !!body.sms });
  return userIds.length;
}

r.post('/students/bulk', h((req, res) => {
  const ids = bulkIds(req.body);
  const action = req.body?.action;
  const rows = db.prepare(`SELECT id, user_id, class_year FROM students WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (rows.length !== ids.length) throw new HttpError(400, 'Some selected students no longer exist');
  let changed = 0;
  if (action === 'promote') {
    const explicit = clean(req.body.class_year, 50, 'Class / Year');
    tx(() => {
      const up = db.prepare('UPDATE students SET class_year = ? WHERE id = ?');
      for (const s of rows) {
        const next = explicit || nextClass(s.class_year);
        if (next && next !== s.class_year) { up.run(next, s.id); changed++; }
      }
    });
  } else if (action === 'status') {
    const status = pick(req.body.status, STUDENT_STATUSES, null, 'Status');
    if (!status) throw new HttpError(400, 'Choose a status');
    changed = db.prepare(`UPDATE students SET status = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(status, ...ids).changes;
  } else if (action === 'message') {
    changed = bulkMessage(rows.map((s) => s.user_id), req.body, req);
  } else {
    throw new HttpError(400, 'Unknown bulk action');
  }
  if (action !== 'message') audit(req.user.id, `bulk_${action}`, 'student', null, { count: changed, ids: ids.slice(0, 50) });
  res.json({ ok: true, changed });
}));

r.post('/donors/bulk-message', h((req, res) => {
  const userIds = req.body?.all
    ? db.prepare('SELECT d.user_id FROM donors d JOIN users u ON u.id = d.user_id WHERE u.is_active = 1').all().map((x) => x.user_id)
    : (() => {
      const ids = bulkIds(req.body);
      return db.prepare(`SELECT user_id FROM donors WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => x.user_id);
    })();
  res.json({ ok: true, changed: bulkMessage(userIds, req.body, req) });
}));

/* ---------------- Photos & ID cards ---------------- */

const photoUpload = imageUpload('photos', 2);

r.post('/students/:id/photo', photoUpload.single('photo'), h((req, res) => {
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!st) {
    if (req.file) removeUpload('photos', req.file.filename);
    throw new HttpError(404, 'Student not found');
  }
  const file = acceptImage(req.file);
  db.prepare('UPDATE students SET photo_path = ? WHERE id = ?').run(file, st.id);
  removeUpload('photos', st.photo_path);
  audit(req.user.id, 'update_photo', 'student', st.id);
  res.json({ ok: true });
}));

r.delete('/students/:id/photo', h((req, res) => {
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!st) throw new HttpError(404, 'Student not found');
  db.prepare('UPDATE students SET photo_path = NULL WHERE id = ?').run(st.id);
  removeUpload('photos', st.photo_path);
  audit(req.user.id, 'remove_photo', 'student', st.id);
  res.json({ ok: true });
}));

export function idCardUrl(req, code) {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/verify/${encodeURIComponent(code)}?s=${hmac(`id:${code}`).slice(0, 16)}`;
}

export function idCardValidTill() {
  const d = new Date();
  const y = d.getMonth() >= 5 ? d.getFullYear() + 1 : d.getFullYear();
  return `${y}-05-31`;
}

export function sendIdCard(req, res, studentId) {
  const st = db.prepare('SELECT s.*, u.name FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(studentId);
  if (!st) throw new HttpError(404, 'Student not found');
  if (st.status !== 'Active') throw new HttpError(400, 'ID cards are only issued to active students');
  audit(req.user.id, 'id_card', 'student', st.id);
  return studentIdCard(res, { student: st, verifyUrl: idCardUrl(req, st.student_code), validTill: idCardValidTill() });
}

r.get('/students/:id/id-card', h((req, res) => sendIdCard(req, res, req.params.id)));

/* ---------------- Villages ---------------- */

r.get('/villages', (_req, res) => {
  const names = db.prepare(`SELECT DISTINCT TRIM(village) v FROM (
      SELECT village FROM students UNION ALL SELECT village FROM projects UNION ALL SELECT village FROM volunteers UNION ALL SELECT village FROM stories)
    WHERE village IS NOT NULL AND TRIM(village) != '' ORDER BY 1 COLLATE NOCASE`).all().map((x) => x.v);
  res.json(names.map((v) => ({
    village: v,
    students: db.prepare('SELECT COUNT(*) n, COALESCE(SUM(status = \'Active\'),0) active FROM students WHERE village = ? COLLATE NOCASE').get(v),
    aid: db.prepare('SELECT COALESCE(SUM(a.amount),0) n FROM aid a JOIN students s ON s.id = a.student_id WHERE s.village = ? COLLATE NOCASE').get(v).n,
    projects: db.prepare('SELECT COUNT(*) n FROM projects WHERE village = ? COLLATE NOCASE').get(v).n,
    raised: db.prepare('SELECT COALESCE(SUM(dn.amount),0) n FROM donations dn JOIN projects p ON p.id = dn.project_id WHERE p.village = ? COLLATE NOCASE').get(v).n,
    volunteers: db.prepare('SELECT COUNT(*) n FROM volunteers WHERE village = ? COLLATE NOCASE AND active = 1').get(v).n,
  })));
});

r.get('/villages/:name', h((req, res) => {
  const v = clean(req.params.name, 100, 'Village');
  const students = db.prepare(`SELECT s.id, s.student_code, s.class_year, s.school, s.status, s.programme, u.name,
      (SELECT COALESCE(SUM(amount),0) FROM aid a WHERE a.student_id = s.id) aid_total
    FROM students s JOIN users u ON u.id = s.user_id WHERE s.village = ? COLLATE NOCASE ORDER BY u.name`).all(v);
  const projects = db.prepare(`SELECT p.*, (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.project_id = p.id) raised,
      (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.project_id = p.id) spent FROM projects p WHERE p.village = ? COLLATE NOCASE ORDER BY p.status, p.name`).all(v);
  const stories = db.prepare('SELECT id, title, created_at, image_path IS NOT NULL has_image FROM stories WHERE village = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 10').all(v);
  const volunteers = db.prepare('SELECT id, name, skills, active FROM volunteers WHERE village = ? COLLATE NOCASE ORDER BY name').all(v);
  const aidByYear = db.prepare(`SELECT substr(a.given_on,1,4) year, SUM(a.amount) total FROM aid a JOIN students s ON s.id = a.student_id
    WHERE s.village = ? COLLATE NOCASE GROUP BY year ORDER BY year`).all(v);
  if (!students.length && !projects.length && !stories.length && !volunteers.length) throw new HttpError(404, 'Village not found');
  res.json({ village: v, students, projects, stories, volunteers, aidByYear });
}));

export default r;
