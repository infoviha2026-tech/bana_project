import { db } from './db.js';
import { HttpError } from './auth.js';
import { clean, normAmount, normDate, normEmail, normId, normName, normPhone, pick } from './services.js';

/* Field rule builders for crud() definitions. Each returns (value) => normalised value, throwing HttpError(400) on bad input. */

const required = (v, label) => {
  if (v == null || v === '') throw new HttpError(400, `${label} is required`);
  return v;
};

export const text = (label, max = 200, { req = false } = {}) => (v) => {
  const s = clean(v, max, label);
  return req ? required(s, label) : s;
};

export const name = (label = 'Name') => (v) => normName(v, label);
export const email = () => (v) => normEmail(v);
export const phone = (label = 'Phone') => (v) => normPhone(v, label);

export const amount = (label = 'Amount', { req = true } = {}) => (v) => {
  if (!req && (v == null || v === '')) return null;
  try {
    return normAmount(v);
  } catch (e) {
    throw new HttpError(400, e.message.replace(/^Amount/, label));
  }
};

export const date = (label, { req = false, allowFuture = false, min = '2000-01-01' } = {}) => (v) => {
  const d = normDate(v, label, { allowFuture, min });
  return req ? required(d, label) : d;
};

export const oneOf = (list, label, fallback = list[0]) => (v) => pick(v, list, fallback, label);

export const bool = () => (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);

export const num = (label, min, max, { req = true, integer = false } = {}) => (v) => {
  if (v == null || v === '') {
    if (req) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new HttpError(400, `${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}`);
  }
  return n;
};

/** Foreign key: positive integer that exists in `table` */
export const ref = (table, label, { req = false } = {}) => (v) => {
  if (v == null || v === '') {
    if (req) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const id = normId(v, label);
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw new HttpError(400, `${label} not found`);
  return id;
};

/** "YYYY-MM" month */
export const month = (label = 'Month') => (v) => {
  const s = clean(v, 7, label);
  if (!s || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new HttpError(400, `${label} must look like 2026-04`);
  if (s > new Date().toISOString().slice(0, 7)) throw new HttpError(400, `${label} cannot be in the future`);
  return s;
};

/** Academic year like "2025-26" */
export const academicYear = (label = 'Academic year', { req = true } = {}) => (v) => {
  const s = clean(v, 7, label);
  if (!s) {
    if (req) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) throw new HttpError(400, `${label} must look like 2025-26`);
  return s;
};

export const currentAcademicYear = () => {
  const d = new Date();
  const y = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1; // academic year starts in June
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
