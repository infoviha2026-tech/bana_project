import crypto from 'node:crypto';
import { db, audit, tx } from './db.js';
import { HttpError } from './auth.js';
import { createDonation } from './services.js';
import { notifyUser } from './notify.js';

/*
 * Razorpay integration (https://razorpay.com/docs/payments/server-integration/nodejs/).
 * Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET (optional, for /api/payments/webhook).
 * Flow: server creates an order → browser opens Razorpay Checkout → browser posts back
 * {order_id, payment_id, signature} → server verifies the HMAC signature → donation + receipt are created.
 * The webhook does the same independently, so a closed browser tab can't lose a payment. Both paths are idempotent.
 */

export const paymentsConfigured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
export const MIN_ONLINE = 10;
export const MAX_ONLINE = 1_000_000; // ₹10 lakh per online payment

const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export async function createOrder({ amount, receipt, notes }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt, notes }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Payment gateway error: ${data?.error?.description || res.status}`);
  return data;
}

export function verifyCheckoutSignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Mark an order paid and create its donation exactly once. Returns the donation id. */
export function finalizePayment(orderId, paymentId, source) {
  return tx(() => {
    const p = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId);
    if (!p) throw new HttpError(404, 'Unknown payment order');
    if (p.status === 'paid') return p.donation_id;
    const donationId = createDonation(p.donor_id, {
      amount: p.amount, donated_on: new Date().toISOString().slice(0, 10), mode: 'Online',
      purpose: p.purpose, reference_no: paymentId, project_id: p.project_id, pledge_id: p.pledge_id,
      notes: `Paid online (Razorpay order ${orderId})`,
    }, null);
    db.prepare("UPDATE payments SET status = 'paid', payment_id = ?, donation_id = ?, paid_at = datetime('now'), error = NULL WHERE id = ?").run(paymentId, donationId, p.id);
    const d = db.prepare('SELECT dn.receipt_no, dn.amount, u.id user_id FROM donations dn JOIN donors x ON x.id = dn.donor_id JOIN users u ON u.id = x.user_id WHERE dn.id = ?').get(donationId);
    audit(d.user_id, 'online_payment', 'donation', donationId, { order: orderId, payment: paymentId, via: source });
    notifyUser(d.user_id, {
      title: 'Thank you for your donation',
      body: `We received your online donation of Rs. ${d.amount.toLocaleString('en-IN')}. Your receipt number is ${d.receipt_no}.`,
      link: `/receipt/${donationId}`, email: true,
    });
    return donationId;
  });
}
