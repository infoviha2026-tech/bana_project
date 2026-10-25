// Backend test suite: run with `npm test`. Uses a throwaway database in a temp folder.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bana-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.API_RATE_LIMIT = '100000';
process.env.LOGIN_RATE_LIMIT = '1000';

const { createApp } = await import('../server/app.js');
const { seedDemo } = await import('../server/seed.js');
const { db } = await import('../server/db.js');

let server, BASE;
const tokens = {};

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function call(method, url, token, body, headers = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(BASE + url, { method, headers: h, body: payload });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const get = (u, t) => call('GET', u, t);
const post = (u, t, b) => call('POST', u, t, b);
const put = (u, t, b) => call('PUT', u, t, b);
const patch = (u, t, b) => call('PATCH', u, t, b);
const del = (u, t) => call('DELETE', u, t);

async function login(identifier, password) {
  const r = await post('/auth/login', null, { identifier, password });
  assert.equal(r.status, 200, `login ${identifier}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

function upload(token, { buf = PDF, type = 'application/pdf', name = 'doc.pdf', title = 'Test certificate', category = 'Academic' } = {}) {
  const fd = new FormData();
  if (title !== null) fd.append('title', title);
  fd.append('category', category);
  if (buf) fd.append('file', new Blob([buf], { type }), name);
  return post('/student/certificates', token, fd);
}

function importFile(token, type, csv, name = 'data.csv') {
  const fd = new FormData();
  fd.append('type', type);
  fd.append('file', new Blob([csv], { type: 'text/csv' }), name);
  return post('/admin/imports/preview', token, fd);
}

before(async () => {
  seedDemo();
  const app = await createApp({ quiet: true });
  await new Promise((res) => { server = app.listen(0, res); });
  BASE = `http://127.0.0.1:${server.address().port}/api`;
  tokens.super = await login('superadmin@bana.org', 'Admin@123');
  tokens.staff = await login('staff@bana.org', 'Staff@123');
  tokens.student = await login('BANA-001', 'Student@123');
  tokens.student2 = await login('BANA-002', 'Student@123');
  tokens.donor = await login('ravi.reddy@example.com', 'Donor@123');
  tokens.donor2 = await login('sunitha.rao@example.com', 'Donor@123');
});

after(() => {
  server?.close();
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

describe('platform', () => {
  test('health check reports database and schema', async () => {
    const r = await get('/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.db, true);
    assert.ok(r.data.schema >= 1);
  });

  test('security headers and request id are set', async () => {
    const r = await get('/health');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('x-request-id'), /^[0-9a-f]{8}$/);
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('malformed JSON → 400, wrong content type → 415, oversized body → 413', async () => {
    assert.equal((await call('POST', '/auth/login', null, '{bad json', { 'Content-Type': 'application/json' })).status, 400);
    assert.equal((await call('POST', '/auth/login', null, 'identifier=x', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await post('/admin/announcements', tokens.staff, { title: 'x', body: 'y'.repeat(300_000) })).status, 413);
  });

  test('unknown API route → 404 JSON', async () => {
    const r = await get('/nope', tokens.super);
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'Not found');
  });

  test('non-numeric IDs in URLs are rejected', async () => {
    assert.equal((await get('/admin/students/1abc', tokens.staff)).status, 400);
    assert.equal((await get('/admin/students/-1', tokens.staff)).status, 400);
    assert.equal((await get('/certificates/0/file', tokens.student)).status, 400);
  });

  test('SQL injection in filters is treated as plain text', async () => {
    const r = await get(`/admin/students?q=${encodeURIComponent("' OR 1=1 --")}`, tokens.staff);
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 0);
    assert.equal((await get('/admin/donations?donor_id=1%20OR%201=1', tokens.staff)).status, 400);
    assert.equal((await get('/admin/donations?from=yesterday', tokens.staff)).status, 400);
  });
});

describe('authentication', () => {
  test('wrong password and unknown user give the same answer', async () => {
    const a = await post('/auth/login', null, { identifier: 'BANA-003', password: 'Wrong123' });
    const b = await post('/auth/login', null, { identifier: 'nobody@example.com', password: 'Wrong123' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.data.error, b.data.error);
  });

  test('missing, malformed, and forged tokens are rejected', async () => {
    assert.equal((await get('/auth/me')).status, 401);
    assert.equal((await get('/auth/me', 'not.a.jwt')).status, 401);
    const [h, p] = tokens.student.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 1, role: 'super_admin', tv: 0 })).toString('base64url')}.${p}`;
    assert.equal((await get('/admin/dashboard', forged)).status, 401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":1}').toString('base64url')}.`;
    assert.equal((await get('/admin/dashboard', none)).status, 401);
  });

  test('account locks after 5 failed attempts; admin reset unlocks it', async () => {
    for (let i = 0; i < 5; i++) await post('/auth/login', null, { identifier: 'BANA-004', password: `Wrong${i}xyz` });
    const locked = await post('/auth/login', null, { identifier: 'BANA-004', password: 'Student@123' });
    assert.equal(locked.status, 423, 'correct password is refused while locked');
    const uid = db.prepare("SELECT id FROM users WHERE student_code = 'BANA-004'").get().id;
    assert.equal((await post(`/admin/users/${uid}/reset-password`, tokens.staff, { password: 'Fresh2026pw' })).status, 200);
    assert.equal((await post('/auth/login', null, { identifier: 'BANA-004', password: 'Fresh2026pw' })).status, 200);
  });

  test('password policy is enforced', async () => {
    const t = await login('BANA-005', 'Student@123');
    const tryPw = (next) => post('/auth/change-password', t, { current: 'Student@123', next });
    assert.match((await tryPw('short1')).data.error, /at least 8/);
    assert.match((await tryPw('onlyletters')).data.error, /letter and one number/);
    assert.match((await tryPw('password123')).data.error, /too common/);
    assert.match((await tryPw('Sneha2026x')).data.error, /name/); // BANA-005 is Sneha Patil
    assert.equal((await post('/auth/change-password', t, { current: 'nope', next: 'Good2026pass' })).status, 400);
  });

  test('changing password revokes other sessions but returns a fresh token', async () => {
    const t1 = await login('BANA-006', 'Student@123');
    const t2 = await login('BANA-006', 'Student@123');
    const r = await post('/auth/change-password', t1, { current: 'Student@123', next: 'River2026walk' });
    assert.equal(r.status, 200);
    assert.equal((await get('/auth/me', t1)).status, 401, 'old token revoked');
    assert.equal((await get('/auth/me', t2)).status, 401, 'other device revoked');
    assert.equal((await get('/student/dashboard', r.data.token)).status, 200, 'fresh token works');
  });

  test('sign out everywhere revokes all tokens', async () => {
    const t1 = await login('BANA-007', 'Student@123');
    const t2 = await login('BANA-007', 'Student@123');
    assert.equal((await post('/auth/logout-all', t1)).status, 200);
    assert.equal((await get('/auth/me', t2)).status, 401);
  });

  test('deactivation takes effect immediately', async () => {
    const t = await login('BANA-008', 'Student@123');
    const uid = db.prepare("SELECT id FROM users WHERE student_code = 'BANA-008'").get().id;
    assert.equal((await patch(`/admin/users/${uid}/active`, tokens.staff, { active: false })).status, 200);
    assert.equal((await get('/student/dashboard', t)).status, 401);
    assert.equal((await post('/auth/login', null, { identifier: 'BANA-008', password: 'Student@123' })).status, 403);
    await patch(`/admin/users/${uid}/active`, tokens.staff, { active: true });
  });

  test('temporary password must be changed before anything else', async () => {
    const created = await post('/admin/students', tokens.staff, { student_code: 'T-TEMP-1', name: 'Temp Student' });
    assert.equal(created.status, 201);
    const t = await login('T-TEMP-1', 'Bana@123');
    const blocked = await get('/student/dashboard', t);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await get('/auth/me', t)).status, 200, '/auth routes still work');
    const r = await post('/auth/change-password', t, { current: 'Bana@123', next: 'Mango2026tree' });
    assert.equal((await get('/student/dashboard', r.data.token)).status, 200);
  });
});

describe('authorisation', () => {
  const adminOnly = ['/admin/dashboard', '/admin/students', '/admin/donors', '/admin/donations', '/admin/aid', '/admin/certificates', '/admin/imports', '/admin/export/donors'];
  const superOnly = ['/super/users', '/super/settings', '/super/audit', '/super/backup'];

  test('students and donors cannot reach admin APIs', async () => {
    for (const u of adminOnly) {
      assert.equal((await get(u, tokens.student)).status, 403, `student ${u}`);
      assert.equal((await get(u, tokens.donor)).status, 403, `donor ${u}`);
    }
  });

  test('staff admins cannot reach super admin APIs', async () => {
    for (const u of superOnly) assert.equal((await get(u, tokens.staff)).status, 403, u);
    for (const u of superOnly) assert.equal((await get(u, tokens.super)).status, 200, u);
  });

  test('cross-role portals are separated', async () => {
    assert.equal((await get('/donor/dashboard', tokens.student)).status, 403);
    assert.equal((await get('/student/dashboard', tokens.donor)).status, 403);
  });

  test('only super admin can permanently delete or manage staff', async () => {
    assert.equal((await del('/admin/donors/1', tokens.staff)).status, 403);
    assert.equal((await del('/admin/students/1', tokens.staff)).status, 403);
    assert.equal((await post('/admin/users/1/reset-password', tokens.staff, {})).status, 403);
    const staffId = db.prepare("SELECT id FROM users WHERE email = 'staff@bana.org'").get().id;
    assert.equal((await patch(`/admin/users/${staffId}/active`, tokens.staff, { active: false })).status, 403);
  });

  test('last active super admin is protected', async () => {
    assert.equal((await patch('/admin/users/1/active', tokens.super, { active: false })).status, 400);
    assert.equal((await del('/super/users/1', tokens.super)).status, 400);
    assert.equal((await put('/super/users/1', tokens.super, { role: 'admin' })).status, 400);
  });

  test('role change revokes the user’s sessions', async () => {
    const created = await post('/super/users', tokens.super, { role: 'admin', name: 'Role Tester', email: 'role.tester@bana.org', password: 'Desk2026lamp' });
    assert.equal(created.status, 201);
    db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(created.data.id);
    const t = await login('role.tester@bana.org', 'Desk2026lamp');
    assert.equal((await put(`/super/users/${created.data.id}`, tokens.super, { role: 'super_admin' })).status, 200);
    assert.equal((await get('/admin/dashboard', t)).status, 401);
  });
});

describe('data isolation', () => {
  test('a student cannot open another student’s certificate file', async () => {
    const up = await upload(tokens.student);
    assert.equal(up.status, 201);
    assert.equal((await get(`/certificates/${up.data.id}/file`, tokens.student)).status, 200);
    assert.equal((await get(`/certificates/${up.data.id}/file`, tokens.student2)).status, 404);
    assert.equal((await get(`/certificates/${up.data.id}/file`, tokens.donor)).status, 404);
    assert.equal((await get(`/certificates/${up.data.id}/file`, tokens.staff)).status, 200);
  });

  test('a student cannot delete another student’s certificate', async () => {
    const up = await upload(tokens.student);
    assert.equal((await del(`/student/certificates/${up.data.id}`, tokens.student2)).status, 404);
    assert.equal((await del(`/student/certificates/${up.data.id}`, tokens.student)).status, 200);
  });

  test('a donor cannot see another donor’s receipt', async () => {
    const mine = (await get('/donor/donations', tokens.donor)).data;
    assert.ok(mine.length > 0);
    assert.equal((await get(`/donations/${mine[0].id}/receipt`, tokens.donor)).status, 200);
    assert.equal((await get(`/donations/${mine[0].id}/receipt`, tokens.donor2)).status, 404);
    assert.equal((await get(`/donations/${mine[0].id}/receipt`, tokens.student)).status, 404);
  });

  test('students can only edit their contact fields', async () => {
    const r = await patch('/student/profile', tokens.student, { phone: '9876501234', school: 'Hacked School', status: 'Alumni' });
    assert.equal(r.status, 200);
    const p = (await get('/student/profile', tokens.student)).data;
    assert.equal(p.phone, '9876501234');
    assert.notEqual(p.school, 'Hacked School');
    assert.equal(p.status, 'Active');
  });

  test('donor totals equal the sum of their donations', async () => {
    const d = (await get('/donor/dashboard', tokens.donor)).data;
    const list = (await get('/donor/donations', tokens.donor)).data;
    assert.equal(d.count, list.length);
    assert.ok(Math.abs(d.lifetime - list.reduce((s, x) => s + x.amount, 0)) < 0.005);
  });
});

describe('certificate uploads', () => {
  test('real PDF and PNG files are accepted', async () => {
    assert.equal((await upload(tokens.student2)).status, 201);
    assert.equal((await upload(tokens.student2, { buf: PNG, type: 'image/png', name: 'photo.png' })).status, 201);
  });

  test('a renamed executable is rejected even with a PDF MIME type', async () => {
    const r = await upload(tokens.student2, { buf: Buffer.from('MZ\x90\x00 this is not a pdf'), type: 'application/pdf', name: 'fake.pdf' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /not a real PDF/);
  });

  test('content that does not match the declared type is rejected', async () => {
    const r = await upload(tokens.student2, { buf: PNG, type: 'application/pdf', name: 'x.pdf' });
    assert.equal(r.status, 400);
  });

  test('disallowed types, empty files, missing title, and oversize files are rejected', async () => {
    assert.equal((await upload(tokens.student2, { buf: Buffer.from('<svg/>'), type: 'image/svg+xml', name: 'x.svg' })).status, 400);
    assert.equal((await upload(tokens.student2, { buf: Buffer.alloc(0), name: 'empty.pdf' })).status, 400);
    assert.equal((await upload(tokens.student2, { title: null })).status, 400);
    assert.equal((await upload(tokens.student2, { title: 'x'.repeat(151) })).status, 400);
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    assert.equal((await upload(tokens.student2, { buf: big })).status, 400);
  });

  test('path traversal in the file name is neutralised', async () => {
    const up = await upload(tokens.student2, { name: '../../etc/passwd.pdf' });
    assert.equal(up.status, 201);
    const row = db.prepare('SELECT file_name, file_path FROM certificates WHERE id = ?').get(up.data.id);
    assert.equal(row.file_name, 'passwd.pdf');
    assert.match(row.file_path, /^[0-9a-f-]{36}\.pdf$/);
  });

  test('rejected uploads leave no stray files behind', async () => {
    const before = fs.readdirSync(path.join(DATA_DIR, 'uploads')).length;
    await upload(tokens.student2, { buf: Buffer.from('nope'), name: 'n.pdf' });
    assert.equal(fs.readdirSync(path.join(DATA_DIR, 'uploads')).length, before);
  });

  test('review workflow: reject needs remarks, verified cannot be deleted by student', async () => {
    const up = await upload(tokens.student2, { title: 'Workflow cert' });
    assert.equal((await patch(`/admin/certificates/${up.data.id}/review`, tokens.staff, { status: 'Rejected' })).status, 400);
    assert.equal((await patch(`/admin/certificates/${up.data.id}/review`, tokens.staff, { status: 'Approved' })).status, 400);
    assert.equal((await patch(`/admin/certificates/${up.data.id}/review`, tokens.staff, { status: 'Verified', remarks: 'OK' })).status, 200);
    const c = (await get('/student/certificates', tokens.student2)).data.find((x) => x.id === up.data.id);
    assert.equal(c.status, 'Verified');
    assert.equal((await del(`/student/certificates/${up.data.id}`, tokens.student2)).status, 400);
  });
});

describe('validation', () => {
  const student = (over) => post('/admin/students', tokens.staff, { student_code: `V-${Math.random().toString(36).slice(2, 8)}`, name: 'Valid Name', ...over });

  test('student fields are validated', async () => {
    assert.equal((await student({ name: '' })).status, 400);
    assert.equal((await student({ name: '12345' })).status, 400);
    assert.equal((await student({ student_code: 'bad code!' })).status, 400);
    assert.equal((await student({ email: 'not-an-email' })).status, 400);
    assert.equal((await student({ phone: '12345' })).status, 400);
    assert.equal((await student({ phone: '98765abcde' })).status, 400);
    assert.equal((await student({ dob: '2010-02-30' })).status, 400, 'impossible date');
    assert.equal((await student({ dob: '2099-01-01' })).status, 400, 'future date');
    assert.equal((await student({ gender: 'Robot' })).status, 400);
    assert.equal((await student({ status: 'Graduated' })).status, 400);
    assert.equal((await student({ address: 'x'.repeat(301) })).status, 400);
    assert.equal((await student({ dob: '2012-01-01', joined_on: '2011-01-01' })).status, 400, 'joined before born');
  });

  test('phone numbers are normalised', async () => {
    const r = await student({ phone: '+91 98765-43210', guardian_phone: '09876543211' });
    assert.equal(r.status, 201);
    const s = (await get(`/admin/students/${r.data.id}`, tokens.staff)).data;
    assert.equal(s.phone, '9876543210');
    assert.equal(s.guardian_phone, '9876543211');
  });

  test('duplicate student IDs and emails are rejected', async () => {
    assert.equal((await student({ student_code: 'BANA-001' })).status, 409);
    assert.equal((await student({ email: 'staff@bana.org' })).status, 409);
  });

  test('donor PAN, email, and uniqueness are validated', async () => {
    assert.equal((await post('/admin/donors', tokens.staff, { name: 'No Mail' })).status, 400);
    assert.equal((await post('/admin/donors', tokens.staff, { name: 'Bad Pan', email: 'pan1@example.com', pan: 'ABC123' })).status, 400);
    assert.equal((await post('/admin/donors', tokens.staff, { name: 'Dup Pan', email: 'pan2@example.com', pan: 'ABCDE1000F' })).status, 409);
    assert.equal((await post('/admin/donors', tokens.staff, { name: 'Dup Mail', email: 'RAVI.REDDY@example.com' })).status, 409);
    const ok = await post('/admin/donors', tokens.staff, { name: 'Good Donor', email: 'good.donor@example.com', pan: 'pqrst9876z' });
    assert.equal(ok.status, 201);
  });

  test('donation amount, date, mode, and reference are validated', async () => {
    const d = (over) => post('/admin/donations', tokens.staff, { donor_id: 1, amount: 1000, donated_on: '2026-05-01', mode: 'Cash', ...over });
    assert.equal((await d({ amount: -5 })).status, 400);
    assert.equal((await d({ amount: 0 })).status, 400);
    assert.equal((await d({ amount: 'abc' })).status, 400);
    assert.equal((await d({ amount: 1e12 })).status, 400, 'above ₹10 crore cap');
    assert.equal((await d({ donated_on: '2099-01-01' })).status, 400);
    assert.equal((await d({ mode: 'Bitcoin' })).status, 400);
    assert.equal((await d({ mode: 'UPI' })).status, 400, 'UPI needs a reference');
    assert.equal((await d({ donor_id: 99999 })).status, 400);
    assert.equal((await d({ donor_id: 'abc' })).status, 400);
    assert.equal((await d({ amount: '₹1,500.50' })).status, 201, 'rupee formatting accepted');
  });

  test('the same UPI reference cannot be recorded twice', async () => {
    const body = { donor_id: 1, amount: 500, donated_on: '2026-06-01', mode: 'UPI', reference_no: 'UTR-DUP-777' };
    assert.equal((await post('/admin/donations', tokens.staff, body)).status, 201);
    const dup = await post('/admin/donations', tokens.staff, body);
    assert.equal(dup.status, 409);
    assert.match(dup.data.error, /already recorded/);
  });

  test('receipt numbers are sequential per financial year', async () => {
    const a = await post('/admin/donations', tokens.staff, { donor_id: 2, amount: 100, donated_on: '2026-04-01', mode: 'Cash' });
    const b = await post('/admin/donations', tokens.staff, { donor_id: 2, amount: 100, donated_on: '2026-04-02', mode: 'Cash' });
    const ra = db.prepare('SELECT receipt_no FROM donations WHERE id = ?').get(a.data.id).receipt_no;
    const rb = db.prepare('SELECT receipt_no FROM donations WHERE id = ?').get(b.data.id).receipt_no;
    assert.match(ra, /^BANA\/2026-27\/\d{4}$/);
    assert.equal(Number(rb.slice(-4)), Number(ra.slice(-4)) + 1);
  });

  test('announcements and settings are validated', async () => {
    assert.equal((await post('/admin/announcements', tokens.staff, { title: '', body: 'x' })).status, 400);
    assert.equal((await post('/admin/announcements', tokens.staff, { title: 'x'.repeat(161), body: 'x' })).status, 400);
    assert.equal((await put('/super/settings', tokens.super, { default_password: 'weak' })).status, 400);
    assert.equal((await put('/super/settings', tokens.super, { contact_email: 'nope' })).status, 400);
    assert.equal((await put('/super/settings', tokens.super, { trust_name: '' })).status, 400);
    assert.equal((await put('/super/settings', tokens.super, { contact_phone: '040 2345 6789', pan_80g_no: 'AAATB1234C' })).status, 200);
  });

  test('objects and arrays are not accepted as text fields', async () => {
    assert.equal((await post('/admin/donors', tokens.staff, { name: { $gt: '' }, email: 'obj@example.com' })).status, 400);
    assert.equal((await post('/auth/login', null, { identifier: ['a'], password: 'x' })).status, 400);
  });
});

describe('excel import and export', () => {
  test('preview validates every row without saving anything', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM donors').get().n;
    const csv = 'Full Name,Email,Phone,PAN\nImport One,import.one@example.com,9000011111,\nNo Email,,9000011112,\nBad Pan,bad.pan@example.com,,XYZ\nImport One Again,import.one@example.com,,\n';
    const r = await importFile(tokens.staff, 'donors', csv);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results.map((x) => x.status), ['create', 'error', 'error', 'update']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM donors').get().n, before, 'dry run saved nothing');
  });

  test('commit saves only valid rows and records history', async () => {
    const csv = 'Full Name,Email\nCommit Donor,commit.donor@example.com\nBroken,not-email\n';
    const pv = await importFile(tokens.staff, 'donors', csv);
    const valid = pv.data.rows.filter((row) => pv.data.results.find((x) => x.row === row._row).status !== 'error');
    const c = await post('/admin/imports/commit', tokens.staff, { type: 'donors', fileName: 'donors.csv', rows: valid });
    assert.equal(c.data.created, 1);
    assert.ok(db.prepare("SELECT 1 FROM users WHERE email = 'commit.donor@example.com'").get());
    assert.ok((await get('/admin/imports', tokens.staff)).data.some((i) => i.file_name === 'donors.csv'));
  });

  test('donation import links by donor email and catches duplicates within the file', async () => {
    const csv = 'Donor Email,Amount,Date,Mode,Reference No\ncommit.donor@example.com,"₹10,000",15/08/2026,UPI,UTR-IMP-1\ncommit.donor@example.com,500,2026-09-01,UPI,UTR-IMP-1\nghost@example.com,500,2026-09-01,Cash,\ncommit.donor@example.com,2500.5,31/02/2026,Cash,\n';
    const r = await importFile(tokens.staff, 'donations', csv);
    assert.deepEqual(r.data.results.map((x) => x.status), ['create', 'error', 'error', 'error']);
    assert.match(r.data.results[1].error, /already recorded/);
    assert.match(r.data.results[2].error, /No donor/);
    assert.match(r.data.results[3].error, /not a real date/);
  });

  test('commit re-validates rows sent by the client', async () => {
    const r = await post('/admin/imports/commit', tokens.staff, { type: 'donors', rows: [{ _row: 2, name: 'X', email: 'bad' }] });
    assert.equal(r.data.created, 0);
    assert.equal(r.data.skipped, 1);
    assert.equal((await post('/admin/imports/commit', tokens.staff, { type: 'evil', rows: [{}] })).status, 400);
    assert.equal((await post('/admin/imports/commit', tokens.staff, { type: 'donors', rows: ['x'] })).status, 400);
  });

  test('flexible headers are matched', async () => {
    const r = await importFile(tokens.staff, 'students', 'student_id,FULLNAME,Mobile\nFLEX-1,Flex Header,9123456780\n');
    assert.equal(r.status, 200);
    assert.equal(r.data.results[0].status, 'create');
  });

  test('missing required columns and non-spreadsheet files are rejected', async () => {
    assert.equal((await importFile(tokens.staff, 'donors', 'Phone\n9000000000\n')).status, 400);
    const fd = new FormData();
    fd.append('type', 'donors');
    fd.append('file', new Blob(['MZ'], { type: 'application/octet-stream' }), 'virus.exe');
    assert.equal((await post('/admin/imports/preview', tokens.staff, fd)).status, 400);
    const fd2 = new FormData();
    fd2.append('type', 'donors');
    fd2.append('file', new Blob(['not a zip']), 'fake.xlsx');
    assert.equal((await post('/admin/imports/preview', tokens.staff, fd2)).status, 400);
  });

  test('templates round-trip through the importer', async () => {
    for (const type of ['students', 'donors']) {
      const tpl = await get(`/admin/imports/template/${type}`, tokens.staff);
      assert.equal(tpl.status, 200);
      const fd = new FormData();
      fd.append('type', type);
      fd.append('file', new Blob([tpl.data]), `${type}.xlsx`);
      const pv = await post('/admin/imports/preview', tokens.staff, fd);
      assert.equal(pv.status, 200, JSON.stringify(pv.data));
      assert.notEqual(pv.data.results[0].status, 'error', JSON.stringify(pv.data.results));
    }
  });

  test('every list exports to xlsx', async () => {
    for (const t of ['students', 'donors', 'donations', 'aid', 'certificates']) {
      const r = await get(`/admin/export/${t}`, tokens.staff);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /spreadsheetml/);
      assert.equal(r.data.subarray(0, 2).toString(), 'PK', 'xlsx is a zip file');
    }
    assert.equal((await get('/admin/export/users', tokens.staff)).status, 404);
  });
});

describe('audit and backup', () => {
  test('actions are written to the audit log with IP and request id', async () => {
    await post('/admin/announcements', tokens.staff, { title: 'Audit me', body: 'Body' });
    const row = db.prepare("SELECT * FROM audit_log WHERE action = 'create' AND entity = 'announcement' ORDER BY id DESC").get();
    assert.ok(row.user_id);
    assert.ok(row.ip);
    assert.match(row.request_id, /^[0-9a-f]{8}$/);
  });

  test('failed sign-ins are audited', async () => {
    await post('/auth/login', null, { identifier: 'BANA-009', password: 'Wrong999' });
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'login_failed'").get());
  });

  test('super admin can download a consistent database backup', async () => {
    const r = await get('/super/backup', tokens.super);
    assert.equal(r.status, 200);
    assert.equal(r.data.subarray(0, 15).toString(), 'SQLite format 3');
  });
});
