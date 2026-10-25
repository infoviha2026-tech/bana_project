import { db, getSettings } from './db.js';

/*
 * Notifications:
 *  - in-app: rows in `notifications`, shown in the bell menu
 *  - email / SMS: queued in `outbox` and delivered by processOutbox().
 *    Email uses SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE).
 *    SMS uses Twilio (TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM).
 *    When a channel isn't configured, messages are marked 'logged' (visible to the Super Admin) instead of sent.
 */

export const emailConfigured = () => !!process.env.SMTP_HOST;
export const smsConfigured = () => !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM);

let transporter;
async function mailer() {
  if (!transporter) {
    const nodemailer = (await import('nodemailer')).default;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function emailHtml(subject, body, link) {
  const t = getSettings();
  const base = process.env.PUBLIC_URL || '';
  const button = link && base ? `<p style="margin:24px 0"><a href="${esc(base + link)}" style="background:#1f4d2b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open BANA Connect</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f6f5f0;font-family:Segoe UI,Arial,sans-serif;color:#17261b">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e3da">
    <div style="background:#1f4d2b;color:#fff;padding:18px 24px;font-weight:800;font-size:18px">${esc(t.trust_name)}</div>
    <div style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${esc(subject)}</h2>
      <div style="white-space:pre-wrap;line-height:1.6;color:#3d4a40">${esc(body)}</div>${button}</div>
    <div style="padding:14px 24px;background:#faf9f5;color:#8b958d;font-size:12px">Together, we make a difference.</div>
  </div></body></html>`;
}

const queueStmt = db.prepare('INSERT INTO outbox (channel, recipient, subject, body, user_id, status) VALUES (?, ?, ?, ?, ?, ?)');

/** Queue an email or SMS. Returns the outbox id. */
export function queueMessage(channel, recipient, subject, body, userId = null) {
  if (!recipient) return null;
  const out = queueStmt.run(channel, recipient, subject ?? null, body, userId, 'pending');
  setImmediate(() => processOutbox().catch((e) => console.error('outbox:', e.message)));
  return Number(out.lastInsertRowid);
}

async function deliver(msg) {
  if (msg.channel === 'email') {
    if (!emailConfigured()) return 'logged';
    const t = await mailer();
    const link = msg.body.match(/\[link:(.*?)\]/)?.[1];
    const text = msg.body.replace(/\s*\[link:.*?\]/, '');
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: msg.recipient, subject: msg.subject, text, html: emailHtml(msg.subject, text, link) });
    return 'sent';
  }
  if (!smsConfigured()) return 'logged';
  const to = /^\d{10}$/.test(msg.recipient) ? `+91${msg.recipient}` : msg.recipient;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: msg.body.slice(0, 1000) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`SMS provider returned ${res.status}`);
  return 'sent';
}

let running = false;
/** Deliver pending messages; failures are retried up to 5 times */
export async function processOutbox() {
  if (running) return;
  running = true;
  try {
    const pending = db.prepare("SELECT * FROM outbox WHERE status = 'pending' AND attempts < 5 ORDER BY id LIMIT 50").all();
    for (const msg of pending) {
      try {
        const status = await deliver(msg);
        db.prepare("UPDATE outbox SET status = ?, attempts = attempts + 1, sent_at = datetime('now'), error = NULL WHERE id = ?").run(status, msg.id);
        if (status === 'logged' && process.env.NODE_ENV !== 'test') {
          console.log(`[${msg.channel} not configured — logged] to ${msg.recipient}: ${msg.subject ?? ''} ${msg.body.replace(/\s+/g, ' ').slice(0, 200)}`);
        }
      } catch (e) {
        const attempts = msg.attempts + 1;
        db.prepare('UPDATE outbox SET attempts = ?, error = ?, status = ? WHERE id = ?').run(attempts, e.message.slice(0, 500), attempts >= 5 ? 'failed' : 'pending', msg.id);
      }
    }
  } finally {
    running = false;
  }
}

const notifStmt = db.prepare('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)');

/**
 * Notify a user in-app, and optionally by email/SMS.
 * opts: { title, body, link, email: bool, sms: bool | string (custom SMS text) }
 */
export function notifyUser(userId, { title, body = '', link = null, email = false, sms = false }) {
  const u = db.prepare('SELECT id, email, phone, is_active FROM users WHERE id = ?').get(userId);
  if (!u || !u.is_active) return;
  notifStmt.run(u.id, title.slice(0, 200), body.slice(0, 2000), link);
  if (email && u.email) queueMessage('email', u.email, title, `${body}${link ? ` [link:${link}]` : ''}`, u.id);
  if (sms && u.phone) queueMessage('sms', u.phone, null, typeof sms === 'string' ? sms : `${title}. ${body}`.slice(0, 300), u.id);
}

/** In-app notification for every active admin and super admin */
export function notifyAdmins({ title, body = '', link = null }) {
  for (const a of db.prepare("SELECT id FROM users WHERE role IN ('admin','super_admin') AND is_active = 1").all()) notifStmt.run(a.id, title, body, link);
}
