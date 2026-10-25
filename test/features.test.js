// Tests for notifications, OTP reset, 2FA, scholarships, sponsorships, payments, academics, reports, public pages.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bana-feat-'));
Object.assign(process.env, {
  DATA_DIR, NODE_ENV: 'test', API_RATE_LIMIT: '100000', LOGIN_RATE_LIMIT: '1000', OTP_RATE_LIMIT: '1000',
  RAZORPAY_KEY_ID: 'rzp_test_dummy', RAZORPAY_KEY_SECRET: 'test_secret_123', RAZORPAY_WEBHOOK_SECRET: 'whsec_test_456',
});

const { createApp } = await import('../server/app.js');
const { seedDemo, seedExtras } = await import('../server/seed.js');
const { db } = await import('../server/db.js');
const { totp } = await import('../server/totp.js');
const { finalizePayment } = await import('../server/payments.js');
const { pledgeReminders, runBackup } = await import('../server/jobs.js');
const { nextClass } = await import('../server/academics.js');

let server, BASE;
const T = {};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

async function call(method, url, token, body, headers = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body !== undefined && !(body instanceof FormData) && !Buffer.isBuffer(body) && typeof body !== 'string') {
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
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}
const studentId = (code) => db.prepare('SELECT id FROM students WHERE student_code = ?').get(code).id;
const donorId = (email) => db.prepare('SELECT d.id FROM donors d JOIN users u ON u.id = d.user_id WHERE u.email = ?').get(email).id;
const userIdOf = (ident) => db.prepare('SELECT id FROM users WHERE email = ? OR student_code = ?').get(ident, ident).id;

before(async () => {
  seedDemo();
  seedExtras();
  const app = await createApp({ quiet: true });
  await new Promise((res) => { server = app.listen(0, res); });
  BASE = `http://127.0.0.1:${server.address().port}/api`;
  T.super = await login('superadmin@bana.org', 'Admin@123');
  T.staff = await login('staff@bana.org', 'Staff@123');
  T.s1 = await login('BANA-001', 'Student@123');
  T.s4 = await login('BANA-004', 'Student@123');
  T.ravi = await login('ravi.reddy@example.com', 'Donor@123');
  T.anil = await login('anil.kumar@example.com', 'Donor@123');
});

after(() => {
  server?.close();
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('password reset by one-time code', () => {
  const lastCode = (uid) => {
    const m = db.prepare('SELECT body FROM outbox WHERE user_id = ? ORDER BY id DESC').get(uid);
    return m?.body.match(/\b(\d{6})\b/)?.[1];
  };

  test('request is answered the same way for known and unknown accounts', async () => {
    const a = await post('/auth/forgot', null, { identifier: 'BANA-002' });
    const b = await post('/auth/forgot', null, { identifier: 'nobody-here' });
    assert.equal(a.status, 200);
    assert.deepEqual(a.data, b.data);
  });

  test('code is delivered to the outbox and resets the password', async () => {
    await post('/auth/forgot', null, { identifier: 'BANA-002' });
    const uid = userIdOf('BANA-002');
    const code = lastCode(uid);
    assert.match(code, /^\d{6}$/);
    const t1 = await login('BANA-002', 'Student@123');
    const r = await post('/auth/reset', null, { identifier: 'BANA-002', code, password: 'Monsoon2026rain' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await get('/auth/me', t1)).status, 401, 'old sessions revoked');
    assert.equal((await post('/auth/login', null, { identifier: 'BANA-002', password: 'Monsoon2026rain' })).status, 200);
    assert.equal((await post('/auth/reset', null, { identifier: 'BANA-002', code, password: 'Another2026x' })).status, 400, 'code is single-use');
  });

  test('wrong codes are limited to 5 attempts and expired codes fail', async () => {
    await post('/auth/forgot', null, { identifier: 'BANA-003' });
    const uid = userIdOf('BANA-003');
    const code = lastCode(uid);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await post('/auth/reset', null, { identifier: 'BANA-003', code: wrong, password: 'Valid2026pass' })).status, 400);
    assert.equal((await post('/auth/reset', null, { identifier: 'BANA-003', code, password: 'Valid2026pass' })).status, 400, 'locked after 5 wrong tries');
    await post('/auth/forgot', null, { identifier: 'BANA-003' });
    db.prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00Z' WHERE user_id = ? AND used_at IS NULL").run(uid);
    assert.equal((await post('/auth/reset', null, { identifier: 'BANA-003', code: lastCode(uid), password: 'Valid2026pass' })).status, 400, 'expired');
  });

  test('new password must follow the policy', async () => {
    await post('/auth/forgot', null, { identifier: 'BANA-005' });
    const r = await post('/auth/reset', null, { identifier: 'BANA-005', code: lastCode(userIdOf('BANA-005')), password: 'weak' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /8 characters/);
  });
});

describe('two-step verification', () => {
  let secret, recovery;
  test('setup requires a valid code, then returns recovery codes', async () => {
    const s = await post('/auth/2fa/setup', T.staff);
    assert.equal(s.status, 200);
    assert.match(s.data.otpauth, /^otpauth:\/\/totp\//);
    assert.match(s.data.qr, /^data:image\/png;base64,/);
    secret = s.data.secret;
    assert.equal((await post('/auth/2fa/enable', T.staff, { code: '123456' })).status, 400);
    const e = await post('/auth/2fa/enable', T.staff, { code: totp(secret) });
    assert.equal(e.status, 200);
    assert.equal(e.data.recoveryCodes.length, 10);
    recovery = e.data.recoveryCodes;
  });

  test('password alone no longer signs in; the challenge is not a session', async () => {
    const r = await post('/auth/login', null, { identifier: 'staff@bana.org', password: 'Staff@123' });
    assert.equal(r.data.twoFactorRequired, true);
    assert.equal(r.data.token, undefined);
    assert.equal((await get('/admin/dashboard', r.data.challenge)).status, 401, 'challenge token cannot be used as a session');
    assert.equal((await post('/auth/login/2fa', null, { challenge: r.data.challenge, code: '000000' })).status, 401);
    const ok = await post('/auth/login/2fa', null, { challenge: r.data.challenge, code: totp(secret) });
    assert.equal(ok.status, 200);
    T.staff = ok.data.token;
  });

  test('recovery codes work once, with or without the dash', async () => {
    const r1 = await post('/auth/login', null, { identifier: 'staff@bana.org', password: 'Staff@123' });
    assert.equal((await post('/auth/login/2fa', null, { challenge: r1.data.challenge, code: recovery[0].replace('-', '').toLowerCase() })).status, 200);
    const r2 = await post('/auth/login', null, { identifier: 'staff@bana.org', password: 'Staff@123' });
    assert.equal((await post('/auth/login/2fa', null, { challenge: r2.data.challenge, code: recovery[0] })).status, 401, 'already used');
  });

  test('super admin can reset 2FA for a lost phone', async () => {
    const uid = userIdOf('staff@bana.org');
    assert.equal((await post(`/super/users/${uid}/reset-2fa`, T.super)).status, 200);
    const r = await post('/auth/login', null, { identifier: 'staff@bana.org', password: 'Staff@123' });
    assert.ok(r.data.token, 'plain login works again');
    T.staff = r.data.token;
  });
});

describe('notifications', () => {
  test('certificate review notifies the student in-app and by email', async () => {
    const fd = new FormData();
    fd.append('title', 'Notify test');
    fd.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'n.pdf');
    const up = await post('/student/certificates', T.s1, fd);
    assert.equal(up.status, 201);
    const adminNote = await get('/notifications', T.super);
    assert.ok(adminNote.data.rows.some((n) => n.title === 'New certificate to review'), 'admins are told about uploads');
    await patch(`/admin/certificates/${up.data.id}/review`, T.staff, { status: 'Rejected', remarks: 'Blurry scan' });
    const n = await get('/notifications', T.s1);
    const note = n.data.rows.find((x) => x.title.includes('Notify test'));
    assert.ok(note && note.body.includes('Blurry scan'));
    assert.ok(n.data.unread >= 1);
    assert.ok(db.prepare("SELECT 1 FROM outbox WHERE channel = 'email' AND subject LIKE '%Notify test%'").get(), 'email queued');
    await post('/notifications/read', T.s1, { all: true });
    assert.equal((await get('/notifications', T.s1)).data.unread, 0);
  });

  test('users cannot mark other users’ notifications', async () => {
    const other = db.prepare('SELECT id FROM notifications WHERE user_id != ? AND read_at IS NULL LIMIT 1').get(userIdOf('BANA-001'));
    if (!other) return;
    await post('/notifications/read', T.s1, { ids: [other.id] });
    assert.equal(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(other.id).read_at, null);
  });

  test('bulk message reaches selected students', async () => {
    const ids = [studentId('BANA-001'), studentId('BANA-004')];
    const r = await post('/admin/students/bulk', T.staff, { ids, action: 'message', title: 'Exam tips', body: 'Sleep well before exams' });
    assert.equal(r.data.changed, 2);
    assert.ok((await get('/notifications', T.s4)).data.rows.some((n) => n.title === 'Exam tips'));
  });
});

describe('scholarships', () => {
  let callId;
  test('admin opens a scholarship and eligible students are notified', async () => {
    const r = await post('/admin/scholarship-calls', T.staff, { title: 'Test Fund 2026', max_amount: 8000, deadline: '2099-12-31', status: 'Open' });
    assert.equal(r.status, 201);
    callId = r.data.id;
    assert.ok((await get('/notifications', T.s1)).data.rows.some((n) => n.title.includes('Test Fund 2026')));
  });

  test('application is validated', async () => {
    const apply = (b, t = T.s1) => post(`/student/scholarships/${callId}/apply`, t, b);
    assert.equal((await apply({ amount_requested: 9000, reason: 'x'.repeat(30) })).status, 400, 'above maximum');
    assert.equal((await apply({ amount_requested: 5000, reason: 'too short' })).status, 400, 'reason too short');
    const someoneElsesCert = db.prepare('SELECT id FROM certificates WHERE student_id != ? LIMIT 1').get(studentId('BANA-001')).id;
    assert.equal((await apply({ amount_requested: 5000, reason: 'x'.repeat(30), certificate_ids: [someoneElsesCert] })).status, 400, 'cannot attach other students’ files');
    assert.equal((await apply({ amount_requested: 5000, reason: 'I need help with my school fees this year.' })).status, 201);
    assert.equal((await apply({ amount_requested: 5000, reason: 'I need help with my school fees this year.' })).status, 409, 'one application per scholarship');
    assert.equal((await post('/student/scholarships/999999/apply', T.s1, { amount_requested: 1, reason: 'x'.repeat(30) })).status, 400);
  });

  test('approval creates an aid record exactly once and notifies the student', async () => {
    const app = (await get(`/admin/scholarship-applications?call_id=${callId}`, T.staff)).data[0];
    const before = (await get('/student/aid', T.s1)).data.length;
    assert.equal((await patch(`/admin/scholarship-applications/${app.id}`, T.staff, { status: 'Approved', amount_approved: 9000 })).status, 400, 'over max');
    assert.equal((await patch(`/admin/scholarship-applications/${app.id}`, T.staff, { status: 'Approved', amount_approved: 6000 })).status, 200);
    assert.equal((await get('/student/aid', T.s1)).data.length, before + 1);
    assert.equal((await patch(`/admin/scholarship-applications/${app.id}`, T.staff, { status: 'Rejected', remarks: 'x' })).status, 400, 'decision is final');
    const mine = (await get('/student/scholarships', T.s1)).data.mine.find((a) => a.call_id === callId);
    assert.equal(mine.status, 'Approved');
    assert.equal(mine.amount_approved, 6000);
  });

  test('closed or expired scholarships cannot be applied to', async () => {
    await put(`/admin/scholarship-calls/${callId}`, T.staff, { title: 'Test Fund 2026', max_amount: 8000, deadline: '2099-12-31', status: 'Closed' });
    assert.equal((await post(`/student/scholarships/${callId}/apply`, T.s4, { amount_requested: 100, reason: 'x'.repeat(30) })).status, 400);
  });
});

describe('sponsorships and privacy', () => {
  test('sponsor sees first name + initial and progress, never contact details', async () => {
    const rows = (await get('/donor/sponsorships', T.ravi)).data;
    assert.ok(rows.length >= 1);
    const text = JSON.stringify(rows);
    assert.match(rows[0].name, /^\S+ [A-Z]\.$/);
    for (const forbidden of ['phone', 'email', 'guardian', 'address', 'dob', 'student_code']) assert.ok(!text.includes(`"${forbidden}`), `leaks ${forbidden}`);
    assert.ok('latestMarks' in rows[0] && 'attendancePct' in rows[0]);
  });

  test('sponsor can see the photo of their own student only', async () => {
    const sid = studentId('BANA-001');
    const fd = new FormData();
    fd.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
    assert.equal((await post('/student/photo', T.s1, fd)).status, 200);
    assert.equal((await get(`/photos/students/${sid}`, T.ravi)).status, 200, 'sponsor');
    assert.equal((await get(`/photos/students/${sid}`, T.anil)).status, 404, 'non-sponsor donor');
    assert.equal((await get(`/photos/students/${sid}`, T.s4)).status, 404, 'another student');
    assert.equal((await get(`/photos/students/${sid}`, T.staff)).status, 200, 'staff');
  });

  test('fake images are rejected', async () => {
    const fd = new FormData();
    fd.append('photo', new Blob([Buffer.from('<html>')], { type: 'image/png' }), 'x.png');
    assert.equal((await post('/student/photo', T.s1, fd)).status, 400);
  });

  test('duplicate sponsorship is rejected', async () => {
    const r = await post('/admin/sponsorships', T.staff, { donor_id: donorId('ravi.reddy@example.com'), student_id: studentId('BANA-001'), start_date: '2026-01-01', active: true });
    assert.equal(r.status, 409);
  });
});

describe('online payments', () => {
  const sign = (s, k) => crypto.createHmac('sha256', k).update(s).digest('hex');
  function makeOrder(amount = 1500) {
    const orderId = `order_${crypto.randomBytes(6).toString('hex')}`;
    db.prepare('INSERT INTO payments (donor_id, order_id, amount, purpose) VALUES (?, ?, ?, ?)').run(donorId('ravi.reddy@example.com'), orderId, amount, 'General Fund');
    return orderId;
  }

  test('config exposes only the public key id', async () => {
    const r = await get('/donor/payments/config', T.ravi);
    assert.equal(r.data.enabled, true);
    assert.equal(r.data.keyId, 'rzp_test_dummy');
    assert.ok(!JSON.stringify(r.data).includes('test_secret_123'));
  });

  test('a forged checkout signature is refused and creates no donation', async () => {
    const orderId = makeOrder();
    const before = db.prepare('SELECT COUNT(*) n FROM donations').get().n;
    const r = await post('/donor/payments/verify', T.ravi, { order_id: orderId, payment_id: 'pay_fake', signature: 'deadbeef' });
    assert.equal(r.status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM donations').get().n, before);
  });

  test('a donor cannot confirm another donor’s order', async () => {
    const orderId = makeOrder();
    const sig = sign(`${orderId}|pay_x1`, 'test_secret_123');
    assert.equal((await post('/donor/payments/verify', T.anil, { order_id: orderId, payment_id: 'pay_x1', signature: sig })).status, 404);
  });

  test('a valid signature creates one donation with a receipt; repeats are idempotent', async () => {
    const orderId = makeOrder(2100);
    const paymentId = `pay_${crypto.randomBytes(5).toString('hex')}`;
    const sig = sign(`${orderId}|${paymentId}`, 'test_secret_123');
    const r1 = await post('/donor/payments/verify', T.ravi, { order_id: orderId, payment_id: paymentId, signature: sig });
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    const r2 = await post('/donor/payments/verify', T.ravi, { order_id: orderId, payment_id: paymentId, signature: sig });
    assert.equal(r2.data.donationId, r1.data.donationId, 'same donation');
    const d = db.prepare('SELECT * FROM donations WHERE id = ?').get(r1.data.donationId);
    assert.equal(d.amount, 2100);
    assert.equal(d.mode, 'Online');
    assert.match(d.receipt_no, /^BANA\//);
    assert.equal(finalizePayment(orderId, paymentId, 'test'), r1.data.donationId, 'webhook after checkout does not duplicate');
  });

  test('webhook needs a valid signature and confirms payments on its own', async () => {
    const orderId = makeOrder(999);
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh_1', order_id: orderId } } } });
    const bad = await call('POST', '/payments/webhook', null, body, { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'nope' });
    assert.equal(bad.status, 400);
    const ok = await call('POST', '/payments/webhook', null, body, { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sign(body, 'whsec_test_456') });
    assert.equal(ok.status, 200);
    assert.equal(db.prepare('SELECT status FROM payments WHERE order_id = ?').get(orderId).status, 'paid');
  });

  test('order amount limits are enforced', async () => {
    assert.equal((await post('/donor/payments/order', T.ravi, { amount: 5 })).status, 400);
    assert.equal((await post('/donor/payments/order', T.ravi, { amount: 5_000_000 })).status, 400);
    assert.equal((await post('/donor/payments/order', T.s1, { amount: 500 })).status, 403);
  });
});

describe('pledges, projects, expenses', () => {
  test('pledge status compares expected and received', async () => {
    const rows = (await get('/donor/pledges', T.ravi)).data;
    const p = rows.find((x) => x.frequency === 'Monthly');
    assert.ok(p.installmentsDue >= 9);
    assert.equal(p.received, 8 * 5000);
    assert.equal(p.state, 'Behind');
  });

  test('reminders are sent once per overdue instalment', () => {
    const first = pledgeReminders();
    const second = pledgeReminders();
    assert.ok(first >= 1);
    assert.equal(second, 0);
  });

  test('a donation cannot be linked to another donor’s pledge', async () => {
    const otherPledge = db.prepare('SELECT id FROM pledges WHERE donor_id != ? LIMIT 1').get(donorId('anil.kumar@example.com')).id;
    const r = await post('/admin/donations', T.staff, { donor_id: donorId('anil.kumar@example.com'), amount: 100, donated_on: '2026-09-01', mode: 'Cash', pledge_id: otherPledge });
    assert.equal(r.status, 400);
  });

  test('project totals include linked donations and expenses', async () => {
    const p = (await get('/admin/projects?status=Active', T.staff)).data.rows[0];
    const before = (await get(`/admin/projects/${p.id}`, T.staff)).data;
    await post('/admin/donations', T.staff, { donor_id: donorId('anil.kumar@example.com'), amount: 1234, donated_on: '2026-09-02', mode: 'Cash', project_id: p.id });
    await post('/admin/expenses', T.staff, { spent_on: '2026-09-03', category: 'Infrastructure', amount: 500, project_id: p.id, mode: 'Cash' });
    const after = (await get(`/admin/projects/${p.id}`, T.staff)).data;
    assert.equal(after.raised, before.raised + 1234);
    assert.equal(after.spent, before.spent + 500);
  });

  test('expense validation', async () => {
    assert.equal((await post('/admin/expenses', T.staff, { spent_on: '2099-01-01', category: 'Events', amount: 10 })).status, 400);
    assert.equal((await post('/admin/expenses', T.staff, { spent_on: '2026-01-01', category: 'Parties', amount: 10 })).status, 400);
    assert.equal((await post('/admin/expenses', T.staff, { spent_on: '2026-01-01', category: 'Events', amount: -1 })).status, 400);
    assert.equal((await post('/admin/expenses', T.staff, { spent_on: '2026-01-01', category: 'Events', amount: 10, project_id: 99999 })).status, 400);
  });

  test('students and donors cannot reach finance admin APIs', async () => {
    for (const u of ['/admin/projects', '/admin/expenses', '/admin/pledges-status', '/admin/reports/summary', '/admin/payments', '/admin/marks']) {
      assert.equal((await get(u, T.ravi)).status, 403, u);
      assert.equal((await get(u, T.s1)).status, 403, u);
    }
  });
});

describe('academics', () => {
  test('attendance and marks are validated', async () => {
    const sid = studentId('BANA-001');
    assert.equal((await post('/admin/attendance', T.staff, { student_id: sid, month: '2026-01', days_present: 25, days_total: 20 })).status, 400);
    assert.equal((await post('/admin/attendance', T.staff, { student_id: sid, month: '2099-01', days_present: 1, days_total: 20 })).status, 400);
    assert.equal((await post('/admin/attendance', T.staff, { student_id: sid, month: '2026-13', days_present: 1, days_total: 20 })).status, 400);
    assert.equal((await post('/admin/marks', T.staff, { student_id: sid, academic_year: '2025-27', term: 'Term 1', percentage: 50 })).status, 400);
    assert.equal((await post('/admin/marks', T.staff, { student_id: sid, academic_year: '2025-26', term: 'Term 1', percentage: 101 })).status, 400);
    assert.equal((await post('/admin/marks', T.staff, { student_id: sid, academic_year: '2025-26', term: 'Term 1', percentage: 50 })).status, 409, 'already recorded');
  });

  test('at-risk list flags low marks, drops, and low attendance', async () => {
    const rows = (await get('/admin/academics/at-risk', T.staff)).data.rows;
    const codes = rows.map((r) => r.student_code);
    assert.ok(codes.includes('BANA-008'), 'low marks');
    assert.ok(codes.includes('BANA-010'), 'low attendance');
  });

  test('marks and attendance import upserts', async () => {
    const csv = 'Student ID,Academic Year,Term,Percentage\nBANA-001,2026-27,Term 2,71%\nBANA-001,2026-27,Term 2,73\nNOPE-1,2026-27,Term 2,50\n';
    const fd = new FormData();
    fd.append('type', 'marks');
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'marks.csv');
    const pv = await post('/admin/imports/preview', T.staff, fd);
    assert.deepEqual(pv.data.results.map((r) => r.status), ['create', 'update', 'error']);
    const valid = pv.data.rows.slice(0, 2);
    await post('/admin/imports/commit', T.staff, { type: 'marks', fileName: 'marks.csv', rows: valid });
    const m = db.prepare("SELECT percentage FROM marks WHERE student_id = ? AND academic_year = '2026-27' AND term = 'Term 2'").get(studentId('BANA-001'));
    assert.equal(m.percentage, 73);
  });

  test('document checklist tracks verified uploads', async () => {
    const before = (await get('/student/checklist', T.s4)).data;
    const req = before.items.find((i) => i.status === 'Missing');
    const fd = new FormData();
    fd.append('title', req.name);
    fd.append('requirement_id', String(req.id));
    fd.append('file', new Blob([Buffer.from('%PDF-1.4 y')], { type: 'application/pdf' }), 'doc.pdf');
    const up = await post('/student/certificates', T.s4, fd);
    assert.equal(up.status, 201);
    assert.equal((await get('/student/checklist', T.s4)).data.items.find((i) => i.id === req.id).status, 'Pending');
    await patch(`/admin/certificates/${up.data.id}/review`, T.staff, { status: 'Verified', remarks: 'ok' });
    const after = (await get('/student/checklist', T.s4)).data;
    assert.equal(after.done, before.done + 1);
  });

  test('promotion moves students to the next class', async () => {
    assert.equal(nextClass('9th'), '10th');
    assert.equal(nextClass('Inter 1st Year'), 'Inter 2nd Year');
    assert.equal(nextClass('B.Sc 2nd Year'), 'B.Sc 3rd Year');
    assert.equal(nextClass('10th'), '11th');
    assert.equal(nextClass('Electrician Trade'), 'Electrician Trade');
  });
});

describe('documents, reports, public pages', () => {
  test('ID card PDF only for active students; QR verify checks the signature', async () => {
    const r = await get('/student/id-card', T.s1);
    assert.equal(r.status, 200);
    assert.equal(r.data.subarray(0, 5).toString(), '%PDF-');
    const alumni = db.prepare("SELECT id FROM students WHERE status = 'Alumni'").get();
    assert.equal((await get(`/admin/students/${alumni.id}/id-card`, T.staff)).status, 400);
    const { hmac } = await import('../server/auth.js');
    const good = await get(`/public/verify/BANA-001?s=${hmac('id:BANA-001').slice(0, 16)}`);
    assert.equal(good.data.valid, true);
    assert.match(good.data.name, /^\S+ [A-Z]\.$/);
    assert.equal((await get(`/public/verify/BANA-002?s=${hmac('id:BANA-001').slice(0, 16)}`)).data.valid, false, 'signature is per student');
  });

  test('80G statement is generated for the donor’s own donations only', async () => {
    const years = (await get('/donor/statement-years', T.ravi)).data;
    const r = await get(`/donor/statement?fy=${years[0]}`, T.ravi);
    assert.equal(r.status, 200);
    assert.equal(r.data.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await get('/donor/statement?fy=1999-00', T.ravi)).status, 404);
  });

  test('reports: summary, annual PDF, Form 10BD, fund utilisation', async () => {
    const s = (await get('/admin/reports/summary?fy=2026-27', T.staff)).data;
    assert.equal(s.monthly.length, 12);
    const dbIncome = db.prepare("SELECT SUM(amount) n FROM donations WHERE donated_on BETWEEN '2026-04-01' AND '2027-03-31'").get().n;
    assert.ok(Math.abs(s.income - dbIncome) < 0.01);
    assert.equal((await get('/admin/reports/annual.pdf?fy=2026-27', T.staff)).data.subarray(0, 5).toString(), '%PDF-');
    const tenbd = await get('/admin/reports/form-10bd?fy=2026-27', T.staff);
    assert.equal(tenbd.data.subarray(0, 2).toString(), 'PK');
    assert.equal((await get('/admin/reports/summary?fy=2026', T.staff)).status, 400);
  });

  test('public impact API has no personal data and allows embedding', async () => {
    const r = await get('/public/impact');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const text = JSON.stringify(r.data);
    for (const leak of ['@example.com', 'BANA-0', 'phone', 'guardian', 'pan']) assert.ok(!text.includes(leak), `leaks ${leak}`);
    assert.ok(r.data.students > 0 && Array.isArray(r.data.projects));
    assert.equal((await post('/public/impact', null, {})).status, 405);
  });

  test('public page can be turned off', async () => {
    await put('/super/settings', T.super, { public_impact: false });
    const { default: _ } = await import('../server/routes/public.js');
    // cached for 5 minutes when on; turning it off takes effect immediately
    assert.equal((await get('/public/impact')).status, 404);
    await put('/super/settings', T.super, { public_impact: true });
  });

  test('settings validate bank details', async () => {
    assert.equal((await put('/super/settings', T.super, { bank_ifsc: 'BAD' })).status, 400);
    assert.equal((await put('/super/settings', T.super, { upi_id: 'not a upi' })).status, 400);
    assert.equal((await put('/super/settings', T.super, { attendance_threshold: 150 })).status, 400);
    assert.equal((await put('/super/settings', T.super, { bank_ifsc: 'sbin0001234', upi_id: 'bana@sbi', bank_account: '1234 5678 9012' })).status, 200);
    const cfg = (await get('/donor/payments/config', T.ravi)).data.bank;
    assert.equal(cfg.ifsc, 'SBIN0001234');
    assert.equal(cfg.account, '123456789012');
  });

  test('backups are created, listed, downloadable, and pruned', async () => {
    for (let i = 0; i < 4; i++) runBackup('manual');
    await put('/super/settings', T.super, { backup_retention: 3 });
    runBackup('manual');
    const list = (await get('/super/backups', T.super)).data;
    assert.equal(list.length, 3);
    const dl = await get(`/super/backups/${list[0].id}/download`, T.super);
    assert.equal(dl.data.subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal((await get('/super/backups', T.staff)).status, 403);
  });

  test('villages aggregate students and projects', async () => {
    const v = (await get('/admin/villages', T.staff)).data.find((x) => x.village === 'Kondapur');
    assert.ok(v.students.n > 0 && v.projects > 0);
    const d = (await get('/admin/villages/Kondapur', T.staff)).data;
    assert.ok(d.students.length === v.students.n);
    assert.equal((await get('/admin/villages/Atlantis', T.staff)).status, 404);
  });

  test('event attendance replaces the set of students', async () => {
    const ev = (await get('/admin/events', T.staff)).data.rows[0];
    const ids = [studentId('BANA-001'), studentId('BANA-004')];
    assert.equal((await put(`/admin/events/${ev.id}/attendees`, T.staff, { student_ids: ids })).data.count, 2);
    assert.equal((await get(`/admin/events/${ev.id}`, T.staff)).data.attendeeList.length, 2);
    assert.equal((await put(`/admin/events/${ev.id}/attendees`, T.staff, { student_ids: 'all' })).status, 400);
  });
});
