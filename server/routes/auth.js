import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, audit } from '../db.js';
import { h, HttpError, requireAuth, signToken, signChallenge, verifyChallenge, revokeSessions, hmac } from '../auth.js';
import { checkPassword, clean, hashPassword } from '../services.js';
import { rateLimit } from '../security.js';
import { queueMessage } from '../notify.js';
import { generateSecret, verifyTotp, otpauthUrl, recoveryCodes } from '../totp.js';

const r = Router();

const MAX_FAILED = 5; // per account, then locked
const LOCK_MINUTES = 15;
const OTP_MINUTES = 10;
// Used when the account doesn't exist so the response takes the same time either way
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const LANGS = ['en', 'te', 'hi'];

// Per-IP limits
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.LOGIN_RATE_LIMIT) || 10, skipSuccessful: true, message: 'Too many failed attempts. Please wait 15 minutes and try again' });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.OTP_RATE_LIMIT) || 5, message: 'Too many reset requests. Please wait 15 minutes and try again' });

const findUser = (id) => db.prepare('SELECT * FROM users WHERE email = ? OR student_code = ?').get(id, id);
const isLocked = (u) => u?.locked_until && u.locked_until > new Date().toISOString();

function recordFailure(user) {
  const failed = user.failed_logins + 1;
  const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
  db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
  audit(user.id, lock ? 'account_locked' : 'login_failed', 'user', user.id);
}

function lockedError(user) {
  const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
  audit(user.id, 'login_blocked', 'user', user.id, 'account locked');
  return new HttpError(423, `This account is locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or use "Forgot password"`);
}

function completeLogin(user, res, method = 'password') {
  db.prepare("UPDATE users SET last_login_at = datetime('now'), failed_logins = 0, locked_until = NULL WHERE id = ?").run(user.id);
  audit(user.id, 'login', 'user', user.id, method === 'password' ? null : method);
  res.json({ token: signToken(user), user: publicUser(user) });
}

r.post('/login', loginLimiter, h((req, res) => {
  const id = clean(req.body?.identifier, 254, 'Email or Student ID');
  const pw = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!id || !pw) throw new HttpError(400, 'Enter your email or Student ID and password');
  if (pw.length > 128) throw new HttpError(401, 'Incorrect email/Student ID or password');

  const user = findUser(id);
  if (isLocked(user)) throw lockedError(user);
  const valid = bcrypt.compareSync(pw, user?.password_hash || DUMMY_HASH);
  if (!user || !valid) {
    if (user) recordFailure(user);
    throw new HttpError(401, 'Incorrect email/Student ID or password');
  }
  if (!user.is_active) throw new HttpError(403, 'This account has been deactivated. Please contact the trust office');

  if (user.totp_enabled) {
    audit(user.id, 'login_password_ok', 'user', user.id, 'awaiting 2-step code');
    return res.json({ twoFactorRequired: true, challenge: signChallenge(user) });
  }
  completeLogin(user, res);
}));

/** Second step: authenticator code or a single-use recovery code */
r.post('/login/2fa', loginLimiter, h((req, res) => {
  const p = verifyChallenge(req.body?.challenge);
  if (!p) throw new HttpError(401, 'This sign-in has expired. Please start again');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
  if (!user || !user.is_active || !user.totp_enabled || p.tv !== user.token_version) throw new HttpError(401, 'Please sign in again');
  if (isLocked(user)) throw lockedError(user);

  const code = clean(req.body?.code, 20, 'Code')?.toUpperCase() ?? '';
  if (verifyTotp(user.totp_secret, code)) return completeLogin(user, res, '2fa');

  const codes = JSON.parse(user.recovery_codes || '[]');
  const idx = codes.indexOf(hmac(code.replace(/[^A-Z0-9]/g, '')));
  if (idx >= 0) {
    codes.splice(idx, 1);
    db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes), user.id);
    audit(user.id, 'recovery_code_used', 'user', user.id, { remaining: codes.length });
    return completeLogin(user, res, 'recovery code');
  }
  recordFailure(user);
  throw new HttpError(401, 'That code is not correct. Check the time on your phone and try again');
}));

r.get('/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(u) });
});

r.post('/change-password', requireAuth, h((req, res) => {
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = req.body?.next;
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, row.password_hash)) throw new HttpError(400, 'Current password is incorrect');
  checkPassword(next, { email: req.user.email, name: req.user.name, studentCode: req.user.student_code });
  if (bcrypt.compareSync(next, row.password_hash)) throw new HttpError(400, 'New password must be different from the current one');
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now'), token_version = token_version + 1 WHERE id = ?")
    .run(hashPassword(next), req.user.id);
  audit(req.user.id, 'change_password', 'user', req.user.id);
  // Other sessions are now revoked; hand this one a fresh token
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, token: signToken(fresh), user: publicUser(fresh) });
}));

/** Sign out of every device */
r.post('/logout-all', requireAuth, h((req, res) => {
  revokeSessions(req.user.id);
  audit(req.user.id, 'logout_all', 'user', req.user.id);
  res.json({ ok: true });
}));

r.put('/language', requireAuth, h((req, res) => {
  if (!LANGS.includes(req.body?.language)) throw new HttpError(400, 'Unsupported language');
  db.prepare('UPDATE users SET language = ? WHERE id = ?').run(req.body.language, req.user.id);
  res.json({ ok: true });
}));

/* ---------------- Forgot password (one-time code by email or SMS) ---------------- */

const GENERIC = 'If an account matches, a 6-digit code has been sent to its registered email or phone. It expires in 10 minutes.';

r.post('/forgot', otpLimiter, h((req, res) => {
  const id = clean(req.body?.identifier, 254, 'Email or Student ID');
  if (!id) throw new HttpError(400, 'Enter your email or Student ID');
  const user = findUser(id);
  if (user?.is_active && (user.email || user.phone)) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(user.id);
    db.prepare('INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, ?)')
      .run(user.id, hmac(`${user.id}:${code}`), new Date(Date.now() + OTP_MINUTES * 60000).toISOString());
    const text = `Your BANA Connect password reset code is ${code}. It expires in ${OTP_MINUTES} minutes. If you did not ask for this, ignore this message.`;
    if (user.email) queueMessage('email', user.email, 'Your password reset code', text, user.id);
    else queueMessage('sms', user.phone, null, text, user.id);
    audit(user.id, 'password_reset_requested', 'user', user.id, user.email ? 'email' : 'sms');
  }
  res.json({ ok: true, message: GENERIC });
}));

r.post('/reset', otpLimiter, h((req, res) => {
  const id = clean(req.body?.identifier, 254, 'Email or Student ID');
  const code = String(req.body?.code ?? '').replace(/\s/g, '');
  const invalid = new HttpError(400, 'That code is not valid or has expired. Please request a new one');
  if (!id || !/^\d{6}$/.test(code)) throw invalid;
  const user = findUser(id);
  if (!user || !user.is_active) throw invalid;
  const reset = db.prepare('SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1').get(user.id);
  if (!reset || reset.expires_at < new Date().toISOString() || reset.attempts >= 5) throw invalid;
  const ok = crypto.timingSafeEqual(Buffer.from(reset.code_hash), Buffer.from(hmac(`${user.id}:${code}`)));
  if (!ok) {
    db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(reset.id);
    throw invalid;
  }
  checkPassword(req.body?.password, { email: user.email, name: user.name, studentCode: user.student_code });
  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(reset.id);
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = NULL,
              password_changed_at = datetime('now'), token_version = token_version + 1 WHERE id = ?`).run(hashPassword(req.body.password), user.id);
  audit(user.id, 'password_reset', 'user', user.id, 'via one-time code');
  res.json({ ok: true });
}));

/* ---------------- Two-step verification setup ---------------- */

r.post('/2fa/setup', requireAuth, h(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (u.totp_enabled) throw new HttpError(400, 'Two-step verification is already on');
  const secret = generateSecret();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, u.id);
  const url = otpauthUrl(secret, u.email || u.student_code);
  const QR = (await import('qrcode')).default;
  res.json({ secret, otpauth: url, qr: await QR.toDataURL(url, { margin: 1, width: 220 }) });
}));

r.post('/2fa/enable', requireAuth, h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (u.totp_enabled) throw new HttpError(400, 'Two-step verification is already on');
  if (!u.totp_secret || !verifyTotp(u.totp_secret, req.body?.code)) throw new HttpError(400, 'That code is not correct. Enter the 6-digit code shown in your app');
  const codes = recoveryCodes();
  db.prepare('UPDATE users SET totp_enabled = 1, recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.map((c) => hmac(c.replace('-', '')))), u.id);
  audit(u.id, '2fa_enabled', 'user', u.id);
  res.json({ ok: true, recoveryCodes: codes });
}));

r.post('/2fa/disable', requireAuth, h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u.totp_enabled) throw new HttpError(400, 'Two-step verification is not on');
  if (!bcrypt.compareSync(String(req.body?.password ?? ''), u.password_hash)) throw new HttpError(400, 'Password is incorrect');
  if (!verifyTotp(u.totp_secret, req.body?.code)) throw new HttpError(400, 'That code is not correct');
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes = NULL WHERE id = ?').run(u.id);
  audit(u.id, '2fa_disabled', 'user', u.id);
  res.json({ ok: true });
}));

export function publicUser(u) {
  return {
    id: u.id, role: u.role, name: u.name, email: u.email, student_code: u.student_code, phone: u.phone,
    must_change_password: !!u.must_change_password, totp_enabled: !!u.totp_enabled, language: u.language || null,
  };
}

export default r;
