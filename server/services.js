import bcrypt from 'bcryptjs';
import { db, getSettings, nextReceiptNo } from './db.js';
import { HttpError } from './auth.js';

export const DONATION_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Online', 'Other'];
export const EXPENSE_CATEGORIES = ['Salaries', 'Educational Supplies', 'Infrastructure', 'Events', 'Travel', 'Administration', 'Utilities', 'Other'];
export const PLEDGE_FREQUENCIES = ['Monthly', 'Quarterly', 'Yearly'];
export const PROJECT_STATUSES = ['Active', 'Completed', 'On hold'];
export const EVENT_STATUSES = ['Upcoming', 'Completed', 'Cancelled'];
export const APPLICATION_STATUSES = ['Submitted', 'Under review', 'Approved', 'Rejected'];
export const TERMS = ['Term 1', 'Term 2', 'Term 3', 'Half-yearly', 'Annual'];
export const AID_TYPES = ['Scholarship', 'Fees', 'Books', 'Uniform', 'Other'];
export const DONOR_TYPES = ['Individual', 'Organisation', 'Trustee'];
export const STUDENT_STATUSES = ['Active', 'Alumni', 'Inactive'];
export const GENDERS = ['Female', 'Male', 'Other'];
export const CERT_CATEGORIES = ['Academic', 'Marksheet', 'Sports', 'Cultural', 'Skill/Training', 'Identity', 'Other'];

export const MAX_AMOUNT = 100_000_000; // ₹10 crore per single entry
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const STUDENT_CODE_RE = /^[A-Z0-9][A-Z0-9\-/_.]{1,29}$/;
// Control characters other than tab/newline are never valid in form input
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const bad = (msg) => new HttpError(400, msg);

/* ---------------- Field normalisers (throw HttpError 400 on bad input) ---------------- */

/** Trim, strip control characters, enforce max length. Empty → null. */
export function clean(v, max = 200, label = 'Value') {
  if (v == null) return null;
  if (typeof v === 'object') throw bad(`${label} must be text`);
  const s = String(v).replace(CONTROL_RE, '').trim();
  if (s === '') return null;
  if (s.length > max) throw bad(`${label} must be at most ${max} characters`);
  return s;
}

export function normName(v, label = 'Full name') {
  const s = clean(v, 120, label);
  if (!s) throw bad(`${label} is required`);
  if (s.length < 2) throw bad(`${label} is too short`);
  if (!/\p{L}/u.test(s)) throw bad(`${label} must contain letters`);
  return s.replace(/\s+/g, ' ');
}

export function normEmail(v) {
  const s = clean(v, 254, 'Email');
  if (!s) return null;
  if (!EMAIL_RE.test(s)) throw bad(`Invalid email "${s}"`);
  return s.toLowerCase();
}

/** Indian phone numbers: 10-digit mobile (optionally +91/0 prefix) or a landline with STD code */
export function normPhone(v, label = 'Phone') {
  const s = clean(v, 20, label);
  if (!s) return null;
  let digits = s.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) throw bad(`${label} "${s}" must contain only digits`);
  digits = digits.replace(/^\+?91(?=[6-9]\d{9}$)/, '').replace(/^0(?=[6-9]\d{9}$)/, '');
  if (/^[6-9]\d{9}$/.test(digits)) return digits;
  if (/^0\d{9,11}$/.test(digits)) return digits; // landline with STD code
  throw bad(`${label} "${s}" is not a valid 10-digit Indian phone number`);
}

export function normPan(v) {
  const s = clean(v, 10, 'PAN')?.toUpperCase();
  if (!s) return null;
  if (!PAN_RE.test(s)) throw bad(`PAN "${s}" is not valid (format: ABCDE1234F)`);
  return s;
}

export function normStudentCode(v) {
  const s = clean(v, 30, 'Student ID')?.toUpperCase();
  if (!s) throw bad('Student ID is required');
  if (!STUDENT_CODE_RE.test(s)) throw bad(`Student ID "${s}" may only use letters, digits, and - / _ .`);
  return s;
}

const todayPlus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

/**
 * Accepts Date, ISO, dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy, Excel serial numbers → YYYY-MM-DD.
 * Rejects impossible dates (31/02) and, unless allowFuture, dates after today.
 */
export function normDate(v, label = 'Date', { allowFuture = false, min = '1900-01-01' } = {}) {
  if (v == null || v === '') return null;
  let y, m, d;
  if (v instanceof Date) {
    if (isNaN(v)) throw bad(`Invalid ${label}`);
    [y, m, d] = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
  } else if (typeof v === 'number') {
    const dt = new Date(Math.round((v - 25569) * 86400000));
    if (isNaN(dt)) throw bad(`Invalid ${label} "${v}"`);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else {
    const s = String(v).trim();
    let mt;
    if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
    else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [y, m, d] = [+mt[3], +mt[2], +mt[1]];
    else throw bad(`Invalid ${label} "${s}" — use YYYY-MM-DD or DD/MM/YYYY`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw bad(`${label} "${v}" is not a real date`);
  const iso = dt.toISOString().slice(0, 10);
  if (iso < min) throw bad(`${label} ${iso} is too far in the past`);
  if (!allowFuture && iso > todayPlus(1)) throw bad(`${label} ${iso} cannot be in the future`);
  return iso;
}

export function normAmount(v) {
  if (v == null || v === '') throw bad('Amount is required');
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]|rs\.?|inr/gi, ''));
  if (!Number.isFinite(n) || n <= 0) throw bad(`Amount must be a positive number (got "${v}")`);
  if (n > MAX_AMOUNT) throw bad(`Amount ${n} is larger than the ₹10 crore limit for a single entry`);
  return Math.round(n * 100) / 100;
}

export function pick(value, allowed, fallback, label = 'Value') {
  const s = clean(value, 60, label);
  if (!s) return fallback;
  const hit = allowed.find((a) => a.toLowerCase() === s.toLowerCase());
  if (!hit) throw bad(`${label} "${s}" must be one of: ${allowed.join(', ')}`);
  return hit;
}

export function normId(v, label = 'ID') {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw bad(`Invalid ${label}`);
  return n;
}

/* ---------------- Passwords ---------------- */

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'welcome123', 'abc12345', 'letmein1', 'india123', 'bana1234']);

/** Password policy: 8–128 chars, at least one letter and one digit, not a common password, not the user's own name/email */
export function checkPassword(pw, { email, name, studentCode } = {}) {
  if (typeof pw !== 'string') throw bad('Password is required');
  if (pw.length < 8) throw bad('Password must be at least 8 characters');
  if (pw.length > 128) throw bad('Password must be at most 128 characters');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must contain at least one letter and one number');
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) throw bad('That password is too common. Please choose another');
  for (const part of [email?.split('@')[0], studentCode, ...(name || '').split(/\s+/)]) {
    if (part && part.length >= 4 && lower.includes(part.toLowerCase())) throw bad('Password must not contain your name, email, or Student ID');
  }
  return pw;
}

export const hashPassword = (pw) => bcrypt.hashSync(pw, 12);

function assertUniqueEmail(email, exceptUserId = 0) {
  if (!email) return;
  const row = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, exceptUserId);
  if (row) throw new HttpError(409, `Email ${email} is already used by another account`);
}

function initialPassword(input, identity) {
  const pw = input.password != null && String(input.password).trim() !== '' ? String(input.password) : getSettings().default_password;
  return checkPassword(pw, identity);
}

/* ---------------- Students ---------------- */

const STUDENT_FIELDS = ['gender', 'dob', 'guardian_name', 'guardian_phone', 'address', 'village', 'school', 'class_year', 'programme', 'joined_on', 'status'];

function studentPayload(input) {
  const p = {
    gender: pick(input.gender, GENDERS, null, 'Gender'),
    dob: normDate(input.dob, 'Date of birth', { min: '1950-01-01' }),
    guardian_name: clean(input.guardian_name, 120, 'Guardian name'),
    guardian_phone: normPhone(input.guardian_phone, 'Guardian phone'),
    address: clean(input.address, 300, 'Address'),
    village: clean(input.village, 100, 'Village'),
    school: clean(input.school, 150, 'School / College'),
    class_year: clean(input.class_year, 50, 'Class / Year'),
    programme: clean(input.programme, 100, 'Programme'),
    joined_on: normDate(input.joined_on, 'Joined date', { min: '1990-01-01' }),
    status: pick(input.status, STUDENT_STATUSES, 'Active', 'Status'),
  };
  if (p.dob && p.dob > todayPlus(-365 * 3)) throw bad('Date of birth must be at least 3 years ago');
  if (p.dob && p.joined_on && p.joined_on < p.dob) throw bad('Joined date cannot be before the date of birth');
  return p;
}

/** Upsert by student_code. Returns { id, created } */
export function saveStudent(input, { id } = {}) {
  const code = normStudentCode(input.student_code);
  const name = normName(input.name);
  const email = normEmail(input.email);
  const phone = normPhone(input.phone);
  const p = studentPayload(input);

  const existing = id
    ? db.prepare('SELECT * FROM students WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM students WHERE student_code = ?').get(code);
  if (id && !existing) throw new HttpError(404, 'Student not found');

  const clash = db.prepare('SELECT id FROM students WHERE student_code = ? AND id != ?').get(code, existing?.id ?? 0);
  if (clash) throw new HttpError(409, `Student ID ${code} already exists`);
  const userClash = db.prepare('SELECT id FROM users WHERE student_code = ? AND id != ?').get(code, existing?.user_id ?? 0);
  if (userClash) throw new HttpError(409, `Student ID ${code} is already used as a login`);
  assertUniqueEmail(email, existing?.user_id ?? 0);

  if (existing) {
    db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, student_code = ? WHERE id = ?').run(name, email, phone, code, existing.user_id);
    db.prepare(`UPDATE students SET student_code = ?, ${STUDENT_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
      .run(code, ...STUDENT_FIELDS.map((f) => p[f]), existing.id);
    return { id: existing.id, created: false };
  }
  const pw = initialPassword(input, { email, name, studentCode: code });
  const u = db.prepare('INSERT INTO users (role, email, student_code, password_hash, name, phone, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run('student', email, code, hashPassword(pw), name, phone);
  const s = db.prepare(`INSERT INTO students (user_id, student_code, ${STUDENT_FIELDS.join(', ')}) VALUES (?, ?, ${STUDENT_FIELDS.map(() => '?').join(', ')})`)
    .run(u.lastInsertRowid, code, ...STUDENT_FIELDS.map((f) => p[f]));
  return { id: Number(s.lastInsertRowid), created: true };
}

/* ---------------- Donors ---------------- */

/** Upsert by email. Returns { id, created } */
export function saveDonor(input, { id } = {}) {
  const name = normName(input.name, 'Name');
  const email = normEmail(input.email);
  if (!email) throw bad('Email is required (donors sign in with email)');
  const p = {
    pan: normPan(input.pan),
    address: clean(input.address, 300, 'Address'),
    city: clean(input.city, 80, 'City'),
    donor_type: pick(input.donor_type, DONOR_TYPES, 'Individual', 'Donor type'),
  };
  const phone = normPhone(input.phone);

  const existing = id
    ? db.prepare('SELECT * FROM donors WHERE id = ?').get(id)
    : db.prepare('SELECT d.* FROM donors d JOIN users u ON u.id = d.user_id WHERE u.email = ?').get(email);
  if (id && !existing) throw new HttpError(404, 'Donor not found');
  assertUniqueEmail(email, existing?.user_id ?? 0);
  if (p.pan) {
    const panClash = db.prepare('SELECT d.id FROM donors d WHERE d.pan = ? AND d.id != ?').get(p.pan, existing?.id ?? 0);
    if (panClash) throw new HttpError(409, `PAN ${p.pan} is already recorded for another donor`);
  }

  if (existing) {
    db.prepare('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?').run(name, email, phone, existing.user_id);
    db.prepare('UPDATE donors SET pan = ?, address = ?, city = ?, donor_type = ? WHERE id = ?').run(p.pan, p.address, p.city, p.donor_type, existing.id);
    return { id: existing.id, created: false };
  }
  const pw = initialPassword(input, { email, name });
  const u = db.prepare('INSERT INTO users (role, email, password_hash, name, phone, must_change_password) VALUES (?, ?, ?, ?, ?, 1)')
    .run('donor', email, hashPassword(pw), name, phone);
  const d = db.prepare('INSERT INTO donors (user_id, pan, address, city, donor_type) VALUES (?, ?, ?, ?, ?)')
    .run(u.lastInsertRowid, p.pan, p.address, p.city, p.donor_type);
  return { id: Number(d.lastInsertRowid), created: true };
}

/* ---------------- Donations ---------------- */

export function donationPayload(input) {
  const donated_on = normDate(input.donated_on, 'Donation date', { min: '2000-01-01' });
  if (!donated_on) throw bad('Donation date is required');
  const mode = pick(input.mode, DONATION_MODES, 'Bank Transfer', 'Mode');
  const reference_no = clean(input.reference_no, 60, 'Reference no')?.toUpperCase() ?? null;
  if (reference_no && !/^[A-Z0-9\-/_. ]+$/.test(reference_no)) throw bad('Reference no may only contain letters, digits, and - / _ .');
  if (['UPI', 'Bank Transfer', 'Cheque', 'Online'].includes(mode) && !reference_no) {
    throw bad(`A reference number (UTR / transaction / cheque no.) is required for ${mode} donations`);
  }
  return {
    amount: normAmount(input.amount),
    donated_on,
    mode,
    purpose: clean(input.purpose, 100, 'Purpose') || 'General Fund',
    reference_no,
    notes: clean(input.notes, 500, 'Notes'),
  };
}

/** The same bank/UPI reference can't be recorded twice — catches double entry and repeated imports */
export function assertUniqueReference(p, exceptId = 0) {
  if (!p.reference_no) return;
  const dup = db.prepare('SELECT receipt_no FROM donations WHERE reference_no = ? COLLATE NOCASE AND mode = ? AND id != ?').get(p.reference_no, p.mode, exceptId);
  if (dup) throw new HttpError(409, `A ${p.mode} donation with reference ${p.reference_no} is already recorded (receipt ${dup.receipt_no})`);
}

/** Optional links from a donation to a project and to one of the same donor's pledges */
export function donationLinks(input, donorId) {
  const project_id = input.project_id ? normId(input.project_id, 'project') : null;
  if (project_id && !db.prepare('SELECT id FROM projects WHERE id = ?').get(project_id)) throw bad('Project not found');
  const pledge_id = input.pledge_id ? normId(input.pledge_id, 'pledge') : null;
  if (pledge_id && !db.prepare('SELECT id FROM pledges WHERE id = ? AND donor_id = ?').get(pledge_id, donorId)) throw bad('That pledge does not belong to this donor');
  return { project_id, pledge_id };
}

export function createDonation(donorId, input, userId) {
  if (!db.prepare('SELECT id FROM donors WHERE id = ?').get(donorId)) throw bad('Donor not found');
  const p = donationPayload(input);
  const links = donationLinks(input, donorId);
  assertUniqueReference(p);
  const r = db.prepare('INSERT INTO donations (donor_id, amount, donated_on, mode, purpose, reference_no, receipt_no, notes, created_by, project_id, pledge_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(donorId, p.amount, p.donated_on, p.mode, p.purpose, p.reference_no, nextReceiptNo(p.donated_on), p.notes, userId, links.project_id, links.pledge_id);
  return Number(r.lastInsertRowid);
}

/** Thank-you notification (in-app + email) when a donation is recorded */
export async function notifyDonation(donationId) {
  const { notifyUser } = await import('./notify.js');
  const d = db.prepare('SELECT dn.*, x.user_id FROM donations dn JOIN donors x ON x.id = dn.donor_id WHERE dn.id = ?').get(donationId);
  if (!d) return;
  notifyUser(d.user_id, {
    title: 'Thank you for your donation',
    body: `Your donation of Rs. ${d.amount.toLocaleString('en-IN')} on ${d.donated_on} has been recorded. Receipt number: ${d.receipt_no}.`,
    link: `/receipt/${d.id}`, email: true,
  });
}

/* ---------------- Aid ---------------- */

export function aidPayload(input) {
  const given_on = normDate(input.given_on, 'Date', { min: '2000-01-01' });
  if (!given_on) throw bad('Date is required');
  return { amount: normAmount(input.amount), given_on, type: pick(input.type, AID_TYPES, 'Scholarship', 'Type'), notes: clean(input.notes, 500, 'Notes') };
}

export function createAid(studentId, input, userId) {
  if (!db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) throw bad('Student not found');
  const p = aidPayload(input);
  const r = db.prepare('INSERT INTO aid (student_id, amount, given_on, type, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(studentId, p.amount, p.given_on, p.type, p.notes, userId);
  return Number(r.lastInsertRowid);
}
