import { db, getSettings } from './db.js';

/* Shared read models for student progress, used by admin, student, and sponsor views */

export function checklistFor(student) {
  const reqs = db.prepare(`SELECT * FROM doc_requirements WHERE active = 1 AND (programme IS NULL OR programme = '' OR programme = ?) ORDER BY sort, name`).all(student.programme || '');
  const certs = db.prepare('SELECT id, title, status, requirement_id, created_at FROM certificates WHERE student_id = ? AND requirement_id IS NOT NULL ORDER BY created_at DESC').all(student.id);
  const items = reqs.map((r) => {
    const mine = certs.filter((c) => c.requirement_id === r.id);
    const best = mine.find((c) => c.status === 'Verified') || mine.find((c) => c.status === 'Pending') || mine[0];
    return { ...r, status: best ? best.status : 'Missing', certificate_id: best?.id ?? null };
  });
  return { items, done: items.filter((i) => i.status === 'Verified').length, total: items.length };
}

export function progressFor(studentId) {
  const marks = db.prepare('SELECT * FROM marks WHERE student_id = ? ORDER BY academic_year, CASE term WHEN \'Term 1\' THEN 1 WHEN \'Term 2\' THEN 2 WHEN \'Half-yearly\' THEN 2 WHEN \'Term 3\' THEN 3 ELSE 4 END').all(studentId);
  const attendance = db.prepare('SELECT * FROM attendance WHERE student_id = ? ORDER BY month').all(studentId);
  const recent = attendance.slice(-3);
  const attendancePct = recent.length ? Math.round((recent.reduce((s, a) => s + a.days_present, 0) / recent.reduce((s, a) => s + a.days_total, 0)) * 100) : null;
  return { marks, attendance, attendancePct, latestMarks: marks.at(-1)?.percentage ?? null };
}

/** Students who need attention: low marks, a big drop, or low attendance over the last 3 recorded months */
export function atRiskStudents() {
  const s = getSettings();
  const marksMin = Number(s.marks_threshold) || 40;
  const attMin = Number(s.attendance_threshold) || 75;
  const students = db.prepare("SELECT s.id, s.student_code, s.class_year, s.school, s.village, u.name FROM students s JOIN users u ON u.id = s.user_id WHERE s.status = 'Active'").all();
  const out = [];
  for (const st of students) {
    const p = progressFor(st.id);
    const reasons = [];
    const last = p.marks.at(-1), prev = p.marks.at(-2);
    if (last && last.percentage < marksMin) reasons.push(`Marks ${last.percentage}% (${last.term} ${last.academic_year}) below ${marksMin}%`);
    if (last && prev && prev.percentage - last.percentage >= 10) reasons.push(`Marks dropped ${Math.round(prev.percentage - last.percentage)} points`);
    if (p.attendancePct != null && p.attendancePct < attMin) reasons.push(`Attendance ${p.attendancePct}% over the last ${Math.min(3, p.attendance.length)} months (below ${attMin}%)`);
    if (reasons.length) out.push({ ...st, reasons, latestMarks: p.latestMarks, attendancePct: p.attendancePct });
  }
  return out;
}

/** Turn "9th" → "10th", "Inter 1st Year" → "Inter 2nd Year", "B.Sc 2nd Year" → "B.Sc 3rd Year" */
export function nextClass(cls) {
  if (!cls) return cls;
  const m = cls.match(/(\d+)(st|nd|rd|th)?/i);
  if (!m) return cls;
  const n = Number(m[1]) + 1;
  const suffix = m[2] ? (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')) : '';
  return cls.replace(m[0], `${n}${suffix}`);
}

/** First name + last initial — what sponsors see */
export const privateName = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : parts[0];
};

/** Expected vs received for a pledge, up to today (or its end date) */
export function pledgeStatus(p) {
  const months = { Monthly: 1, Quarterly: 3, Yearly: 12 }[p.frequency];
  const today = new Date().toISOString().slice(0, 10);
  const until = p.end_date && p.end_date < today ? p.end_date : today;
  let due = 0;
  let next = null;
  const start = new Date(`${p.start_date}T00:00:00Z`);
  for (let i = 0; i < 600; i++) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i * months);
    const iso = d.toISOString().slice(0, 10);
    if (iso <= until) due++;
    else {
      if (!p.end_date || iso <= p.end_date) next = iso;
      break;
    }
  }
  const expected = due * p.amount;
  const received = db.prepare('SELECT COALESCE(SUM(amount),0) n FROM donations WHERE pledge_id = ?').get(p.id).n;
  let state = 'Not started';
  if (p.status !== 'Active') state = p.status;
  else if (due > 0) state = received >= expected ? 'On track' : 'Behind';
  return { installmentsDue: due, expected, received, balance: Math.max(0, expected - received), nextDue: p.status === 'Active' ? next : null, state };
}
