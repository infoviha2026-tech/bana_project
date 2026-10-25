import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'bana.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','student','donor')),
  email TEXT UNIQUE COLLATE NOCASE,
  student_code TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  student_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  gender TEXT, dob TEXT, guardian_name TEXT, guardian_phone TEXT,
  address TEXT, village TEXT, school TEXT, class_year TEXT, programme TEXT,
  joined_on TEXT, status TEXT NOT NULL DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS donors (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  pan TEXT, address TEXT, city TEXT, donor_type TEXT DEFAULT 'Individual'
);
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY,
  donor_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  donated_on TEXT NOT NULL,
  mode TEXT, purpose TEXT, reference_no TEXT,
  receipt_no TEXT UNIQUE,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS aid (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  given_on TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Scholarship',
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title TEXT NOT NULL, category TEXT NOT NULL, issued_on TEXT,
  file_path TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Verified','Rejected')),
  remarks TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','students','donors')),
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL, file_name TEXT NOT NULL,
  created INTEGER NOT NULL, updated INTEGER NOT NULL, skipped INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER, details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_id, donated_on);
CREATE INDEX IF NOT EXISTS idx_aid_student ON aid(student_id);
CREATE INDEX IF NOT EXISTS idx_cert_student ON certificates(student_id, status);
`);

/*
 * Versioned migrations. Each entry runs once, in order, inside a transaction;
 * PRAGMA user_version records how far this database has been upgraded.
 */
const MIGRATIONS = [
  // 1: session revocation, account lockout, request context on audit entries
  `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN locked_until TEXT;
   ALTER TABLE users ADD COLUMN password_changed_at TEXT;
   ALTER TABLE audit_log ADD COLUMN ip TEXT;
   ALTER TABLE audit_log ADD COLUMN request_id TEXT;
   CREATE INDEX IF NOT EXISTS idx_donations_ref ON donations(reference_no COLLATE NOCASE);
   CREATE INDEX IF NOT EXISTS idx_aid_given ON aid(given_on);
   CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
   CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, is_active);`,

  // 2: notifications, OTP reset, 2FA, projects, pledges, payments, sponsorships, scholarships,
  //    academics, documents checklist, stories, expenses, events, volunteers, backups
  `CREATE TABLE notifications (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL, body TEXT, link TEXT, read_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
   CREATE TABLE outbox (
     id INTEGER PRIMARY KEY,
     channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
     recipient TEXT NOT NULL, subject TEXT, body TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','logged')),
     attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT);
   CREATE INDEX idx_outbox_status ON outbox(status, created_at);
   CREATE TABLE password_resets (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     code_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   ALTER TABLE users ADD COLUMN totp_secret TEXT;
   ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN recovery_codes TEXT;
   ALTER TABLE users ADD COLUMN language TEXT;
   ALTER TABLE students ADD COLUMN photo_path TEXT;

   CREATE TABLE projects (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL, description TEXT, village TEXT,
     goal_amount REAL NOT NULL CHECK (goal_amount > 0),
     start_date TEXT, end_date TEXT,
     status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed','On hold')),
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE pledges (
     id INTEGER PRIMARY KEY,
     donor_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
     amount REAL NOT NULL CHECK (amount > 0),
     frequency TEXT NOT NULL CHECK (frequency IN ('Monthly','Quarterly','Yearly')),
     start_date TEXT NOT NULL, end_date TEXT, purpose TEXT,
     project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
     status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Paused','Ended')),
     last_reminded TEXT, notes TEXT,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   ALTER TABLE donations ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
   ALTER TABLE donations ADD COLUMN pledge_id INTEGER REFERENCES pledges(id) ON DELETE SET NULL;
   CREATE INDEX idx_donations_project ON donations(project_id);
   CREATE INDEX idx_donations_pledge ON donations(pledge_id);
   CREATE TABLE payments (
     id INTEGER PRIMARY KEY,
     donor_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
     order_id TEXT NOT NULL UNIQUE, payment_id TEXT UNIQUE,
     amount REAL NOT NULL, purpose TEXT,
     project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
     pledge_id INTEGER REFERENCES pledges(id) ON DELETE SET NULL,
     status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed')),
     donation_id INTEGER REFERENCES donations(id) ON DELETE SET NULL,
     error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT);
   CREATE TABLE sponsorships (
     id INTEGER PRIMARY KEY,
     donor_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
     student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
     start_date TEXT NOT NULL, end_date TEXT, annual_amount REAL, notes TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (donor_id, student_id));

   CREATE TABLE scholarship_calls (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL, description TEXT, academic_year TEXT, programme TEXT,
     max_amount REAL NOT NULL CHECK (max_amount > 0), deadline TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Closed')),
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE scholarship_applications (
     id INTEGER PRIMARY KEY,
     call_id INTEGER NOT NULL REFERENCES scholarship_calls(id) ON DELETE CASCADE,
     student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
     amount_requested REAL NOT NULL CHECK (amount_requested > 0),
     reason TEXT NOT NULL, certificate_ids TEXT,
     status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted','Under review','Approved','Rejected')),
     amount_approved REAL, remarks TEXT,
     aid_id INTEGER REFERENCES aid(id) ON DELETE SET NULL,
     reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (call_id, student_id));
   CREATE TABLE marks (
     id INTEGER PRIMARY KEY,
     student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
     academic_year TEXT NOT NULL, term TEXT NOT NULL,
     percentage REAL NOT NULL CHECK (percentage BETWEEN 0 AND 100),
     grade TEXT, remarks TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (student_id, academic_year, term));
   CREATE TABLE attendance (
     id INTEGER PRIMARY KEY,
     student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
     month TEXT NOT NULL,
     days_present INTEGER NOT NULL CHECK (days_present >= 0),
     days_total INTEGER NOT NULL CHECK (days_total > 0 AND days_present <= days_total),
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (student_id, month));
   CREATE TABLE doc_requirements (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other', programme TEXT, description TEXT,
     active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
   ALTER TABLE certificates ADD COLUMN requirement_id INTEGER REFERENCES doc_requirements(id) ON DELETE SET NULL;

   CREATE TABLE stories (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL, body TEXT NOT NULL, image_path TEXT,
     project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, village TEXT,
     published INTEGER NOT NULL DEFAULT 1,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE expenses (
     id INTEGER PRIMARY KEY,
     spent_on TEXT NOT NULL, category TEXT NOT NULL,
     amount REAL NOT NULL CHECK (amount > 0),
     vendor TEXT, description TEXT,
     project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
     mode TEXT, reference_no TEXT,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX idx_expenses_date ON expenses(spent_on);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL, event_date TEXT NOT NULL, location TEXT, description TEXT,
     status TEXT NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming','Completed','Cancelled')),
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE event_attendees (
     event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
     PRIMARY KEY (event_id, student_id));
   CREATE TABLE volunteers (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL, phone TEXT, email TEXT, skills TEXT, village TEXT,
     active INTEGER NOT NULL DEFAULT 1, joined_on TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE volunteer_hours (
     id INTEGER PRIMARY KEY,
     volunteer_id INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
     event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
     worked_on TEXT NOT NULL, hours REAL NOT NULL CHECK (hours > 0 AND hours <= 24), activity TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE backups (
     id INTEGER PRIMARY KEY,
     file_name TEXT NOT NULL, bytes INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('auto','manual')),
     created_at TEXT NOT NULL DEFAULT (datetime('now')));`,
];

{
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${v + 1} failed: ${e.message}`);
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;

const DEFAULT_SETTINGS = {
  trust_name: 'BANA Development Foundation',
  trust_address: '',
  registration_no: '',
  pan_80g_no: '',
  contact_email: '',
  contact_phone: '',
  default_password: 'Bana@123',
  bank_name: '',
  bank_account: '',
  bank_ifsc: '',
  upi_id: '',
  attendance_threshold: '75',
  marks_threshold: '40',
  public_impact: '1',
  backup_retention: '30',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

export function getSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Per-request context ({ ip, requestId }) so audit entries can record where an action came from */
export const requestContext = new AsyncLocalStorage();

const auditStmt = db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
export function audit(userId, action, entity = null, entityId = null, details = null) {
  const ctx = requestContext.getStore() || {};
  const text = details == null ? null : typeof details === 'string' ? details : JSON.stringify(details);
  auditStmt.run(userId ?? null, action, entity, entityId ?? null, text?.slice(0, 2000) ?? null, ctx.ip ?? null, ctx.requestId ?? null);
}

/** Financial year label (Apr–Mar), e.g. 2026-10-17 → "2026-27" */
export function fyOf(dateStr) {
  const d = new Date(dateStr);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function fyRange(dateStr = new Date().toISOString()) {
  const start = Number(fyOf(dateStr).slice(0, 4));
  return [`${start}-04-01`, `${start + 1}-03-31`];
}

export function nextReceiptNo(donatedOn) {
  const fy = fyOf(donatedOn);
  const prefix = `BANA/${fy}/`;
  const row = db.prepare("SELECT receipt_no FROM donations WHERE receipt_no LIKE ? ORDER BY receipt_no DESC LIMIT 1").get(prefix + '%');
  const n = row ? Number(row.receipt_no.slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}
