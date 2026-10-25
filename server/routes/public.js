import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { db, audit, getSettings } from '../db.js';
import { h, HttpError, hmac } from '../auth.js';
import { privateName } from '../academics.js';
import { sendUpload } from '../uploads.js';
import { rateLimit } from '../security.js';
import { verifyWebhookSignature, finalizePayment } from '../payments.js';

const r = Router();

/* Public, read-only endpoints. Safe to embed on the foundation's website (CORS open, no personal data). */

const publicLimiter = rateLimit({ windowMs: 60_000, max: 120 });
r.use('/public', publicLimiter, (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET') return next(new HttpError(405, 'Method not allowed'));
  next();
});

let cache = { at: 0, data: null };

r.get('/public/impact', h((_req, res) => {
  if (getSettings().public_impact !== '1') throw new HttpError(404, 'The public impact page is turned off');
  if (Date.now() - cache.at > 5 * 60_000) {
    const n = (sql) => db.prepare(sql).get().n;
    cache = {
      at: Date.now(),
      data: {
        trust: getSettings().trust_name,
        students: n("SELECT COUNT(*) n FROM students WHERE status = 'Active'"),
        studentsEver: n('SELECT COUNT(*) n FROM students'),
        villages: n("SELECT COUNT(DISTINCT village) n FROM students WHERE village IS NOT NULL AND village != ''"),
        aidDisbursed: n('SELECT COALESCE(SUM(amount),0) n FROM aid'),
        scholarships: n("SELECT COUNT(*) n FROM aid WHERE type = 'Scholarship'"),
        certificatesVerified: n("SELECT COUNT(*) n FROM certificates WHERE status = 'Verified'"),
        donors: n('SELECT COUNT(DISTINCT donor_id) n FROM donations'),
        volunteerHours: n('SELECT COALESCE(SUM(hours),0) n FROM volunteer_hours'),
        events: n("SELECT COUNT(*) n FROM events WHERE status = 'Completed'"),
        projects: db.prepare(`SELECT p.id, p.name, p.description, p.village, p.goal_amount, p.status,
            (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.project_id = p.id) raised
          FROM projects p WHERE p.status IN ('Active','Completed') ORDER BY p.status = 'Active' DESC, p.created_at DESC LIMIT 6`).all(),
        stories: db.prepare(`SELECT id, title, substr(body, 1, 220) excerpt, village, created_at, image_path IS NOT NULL has_image
          FROM stories WHERE published = 1 ORDER BY created_at DESC LIMIT 6`).all(),
        updatedAt: new Date().toISOString(),
      },
    };
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(cache.data);
}));

r.get('/public/stories/:id/image', h((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Invalid ID');
  const s = db.prepare('SELECT image_path, published FROM stories WHERE id = ?').get(id);
  if (!s?.published || getSettings().public_impact !== '1') throw new HttpError(404, 'Image not found');
  sendUpload(res, 'stories', s.image_path);
  res.setHeader('Cache-Control', 'public, max-age=86400');
}));

/** ID card QR check: confirms the card is genuine and the student is currently active (minimal personal data) */
r.get('/public/verify/:code', h((req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 30);
  const sig = String(req.query.s || '');
  const expected = hmac(`id:${code}`).slice(0, 16);
  const genuine = sig.length === 16 && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!genuine) return res.json({ valid: false, reason: 'This QR code was not issued by the trust' });
  const s = db.prepare('SELECT s.student_code, s.status, s.programme, s.class_year, u.name FROM students s JOIN users u ON u.id = s.user_id WHERE s.student_code = ?').get(code);
  if (!s) return res.json({ valid: false, reason: 'No student with this ID' });
  res.json({ valid: s.status === 'Active', status: s.status, name: privateName(s.name), student_code: s.student_code, programme: s.programme, class_year: s.class_year, trust: getSettings().trust_name, reason: s.status === 'Active' ? null : `This student is no longer active (${s.status})` });
}));

/**
 * Razorpay webhook (payment.captured / order.paid). Configure in the Razorpay dashboard with
 * URL https://<your-domain>/api/payments/webhook and the RAZORPAY_WEBHOOK_SECRET.
 */
r.post('/payments/webhook', express.raw({ type: 'application/json', limit: '100kb' }), h((req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!verifyWebhookSignature(raw, req.headers['x-razorpay-signature'])) throw new HttpError(400, 'Invalid signature');
  const event = JSON.parse(raw.toString('utf8'));
  const payment = event?.payload?.payment?.entity;
  if (['payment.captured', 'order.paid'].includes(event.event) && payment?.order_id) {
    const known = db.prepare('SELECT 1 FROM payments WHERE order_id = ?').get(payment.order_id);
    if (known) finalizePayment(payment.order_id, payment.id, 'webhook');
  } else if (event.event === 'payment.failed' && payment?.order_id) {
    db.prepare("UPDATE payments SET status = 'failed', error = ? WHERE order_id = ? AND status = 'created'").run(String(payment.error_description || 'failed').slice(0, 300), payment.order_id);
  }
  audit(null, 'payment_webhook', 'payment', null, { event: event.event, order: payment?.order_id });
  res.json({ ok: true });
}));

export default r;
