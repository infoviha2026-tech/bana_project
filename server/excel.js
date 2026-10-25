import ExcelJS from 'exceljs';
import { db } from './db.js';
import { HttpError } from './auth.js';
import { saveStudent, saveDonor, createDonation, createAid, normEmail, clean, TERMS, EXPENSE_CATEGORIES, DONATION_MODES } from './services.js';
import * as F from './fields.js';

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* Column definitions per import type. `aliases` are extra accepted header spellings. */
export const IMPORT_TYPES = {
  students: {
    label: 'Students',
    columns: [
      { field: 'student_code', header: 'Student ID', required: true, aliases: ['studentcode', 'id', 'rollno', 'regno'], example: 'BANA-2026-001' },
      { field: 'name', header: 'Full Name', required: true, aliases: ['name', 'studentname'], example: 'Priya Sharma' },
      { field: 'email', header: 'Email', aliases: ['emailid', 'mail'], example: 'priya@example.com' },
      { field: 'phone', header: 'Phone', aliases: ['mobile', 'phoneno', 'contact'], example: '9876543210' },
      { field: 'gender', header: 'Gender', example: 'Female' },
      { field: 'dob', header: 'Date of Birth', aliases: ['dob', 'birthdate'], example: '2010-06-15' },
      { field: 'guardian_name', header: 'Guardian Name', aliases: ['parentname', 'fathername', 'guardian'], example: 'Ramesh Sharma' },
      { field: 'guardian_phone', header: 'Guardian Phone', aliases: ['parentphone', 'guardianmobile'], example: '9876500000' },
      { field: 'address', header: 'Address', example: 'Main Road' },
      { field: 'village', header: 'Village', aliases: ['town'], example: 'Rampur' },
      { field: 'school', header: 'School / College', aliases: ['school', 'college', 'institution'], example: 'ZP High School' },
      { field: 'class_year', header: 'Class / Year', aliases: ['class', 'year', 'grade', 'standard'], example: '9th' },
      { field: 'programme', header: 'Programme', aliases: ['program', 'scheme'], example: 'Education Support' },
      { field: 'joined_on', header: 'Joined On', aliases: ['joiningdate', 'joined', 'dateofjoining'], example: '2024-06-01' },
      { field: 'status', header: 'Status', example: 'Active' },
    ],
  },
  donors: {
    label: 'Donors',
    columns: [
      { field: 'name', header: 'Full Name', required: true, aliases: ['name', 'donorname'], example: 'Anil Kumar' },
      { field: 'email', header: 'Email', required: true, aliases: ['emailid', 'mail'], example: 'anil@example.com' },
      { field: 'phone', header: 'Phone', aliases: ['mobile', 'phoneno', 'contact'], example: '9800000001' },
      { field: 'pan', header: 'PAN', aliases: ['panno', 'pannumber'], example: 'ABCDE1234F' },
      { field: 'address', header: 'Address', example: '12 MG Road' },
      { field: 'city', header: 'City', example: 'Hyderabad' },
      { field: 'donor_type', header: 'Donor Type', aliases: ['type'], example: 'Individual' },
    ],
  },
  donations: {
    label: 'Donations',
    columns: [
      { field: 'donor_email', header: 'Donor Email', required: true, aliases: ['email', 'donor'], example: 'anil@example.com' },
      { field: 'amount', header: 'Amount', required: true, aliases: ['amountinr', 'amountrs', 'rupees'], example: 25000 },
      { field: 'donated_on', header: 'Date', required: true, aliases: ['donationdate', 'donatedon', 'dateofdonation'], example: '2026-04-10' },
      { field: 'mode', header: 'Mode', aliases: ['paymentmode', 'method'], example: 'UPI' },
      { field: 'purpose', header: 'Purpose', aliases: ['fund', 'towards'], example: 'Scholarships' },
      { field: 'reference_no', header: 'Reference No', aliases: ['reference', 'refno', 'transactionid', 'utr', 'chequeno'], example: 'UPI123456' },
      { field: 'notes', header: 'Notes', aliases: ['remarks'], example: '' },
    ],
  },
  aid: {
    label: 'Aid / Disbursements',
    columns: [
      { field: 'student_code', header: 'Student ID', required: true, aliases: ['studentcode', 'id', 'rollno'], example: 'BANA-2026-001' },
      { field: 'amount', header: 'Amount', required: true, example: 5000 },
      { field: 'given_on', header: 'Date', required: true, aliases: ['givenon', 'disbursedon'], example: '2026-07-01' },
      { field: 'type', header: 'Type', aliases: ['aidtype', 'category'], example: 'Scholarship' },
      { field: 'notes', header: 'Notes', aliases: ['remarks'], example: 'Term 1 fees' },
    ],
  },
  marks: {
    label: 'Marks',
    columns: [
      { field: 'student_code', header: 'Student ID', required: true, aliases: ['studentcode', 'id', 'rollno'], example: 'BANA-001' },
      { field: 'academic_year', header: 'Academic Year', required: true, aliases: ['year', 'ay'], example: '2025-26' },
      { field: 'term', header: 'Term', required: true, aliases: ['exam', 'examination'], example: 'Term 1' },
      { field: 'percentage', header: 'Percentage', required: true, aliases: ['percent', 'marks', 'score'], example: 78.5 },
      { field: 'grade', header: 'Grade', example: 'B+' },
      { field: 'remarks', header: 'Remarks', aliases: ['notes'], example: '' },
    ],
  },
  attendance: {
    label: 'Attendance',
    columns: [
      { field: 'student_code', header: 'Student ID', required: true, aliases: ['studentcode', 'id', 'rollno'], example: 'BANA-001' },
      { field: 'month', header: 'Month', required: true, aliases: ['period'], example: '2026-07' },
      { field: 'days_present', header: 'Days Present', required: true, aliases: ['present', 'attended'], example: 22 },
      { field: 'days_total', header: 'Working Days', required: true, aliases: ['totaldays', 'workingdays', 'total'], example: 24 },
    ],
  },
  expenses: {
    label: 'Expenses',
    columns: [
      { field: 'spent_on', header: 'Date', required: true, aliases: ['spenton', 'paidon', 'expensedate'], example: '2026-07-15' },
      { field: 'category', header: 'Category', required: true, aliases: ['head', 'expensehead'], example: 'Educational Supplies' },
      { field: 'amount', header: 'Amount', required: true, example: 12500 },
      { field: 'vendor', header: 'Paid To', aliases: ['vendor', 'payee', 'party'], example: 'Sri Lakshmi Book Depot' },
      { field: 'description', header: 'Description', aliases: ['details', 'narration', 'particulars'], example: 'Notebooks for 40 students' },
      { field: 'project', header: 'Project', aliases: ['projectname'], example: '' },
      { field: 'mode', header: 'Mode', aliases: ['paymentmode'], example: 'Bank Transfer' },
      { field: 'reference_no', header: 'Reference No', aliases: ['reference', 'refno', 'voucherno'], example: 'VCH-0012' },
    ],
  },
};

function studentByCode(v) {
  const code = clean(v, 30, 'Student ID')?.toUpperCase();
  const st = code && db.prepare('SELECT id FROM students WHERE student_code = ?').get(code);
  if (!st) throw new HttpError(400, `No student with ID "${v ?? ''}"`);
  return st.id;
}

/** Insert or update by a natural key; returns { id, created } */
function upsert(table, keyCols, data) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE ${keyCols.map((k) => `${k} = ?`).join(' AND ')}`).get(...keyCols.map((k) => data[k]));
  const cols = Object.keys(data);
  if (existing) {
    db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), existing.id);
    return { id: existing.id, created: false };
  }
  const out = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => data[c]));
  return { id: Number(out.lastInsertRowid), created: true };
}

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  if ('result' in v) return cellValue(v.result);
  if (v.richText) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return v.text;
  return String(v);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Returns an array of row arrays (first = header) from an xlsx/csv buffer */
async function readGrid(buffer, fileName) {
  if (/\.csv$/i.test(fileName)) return parseCsv(buffer.toString('utf8').replace(/^﻿/, ''));
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new HttpError(400, 'Could not read this file. Please upload a valid .xlsx or .csv file');
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new HttpError(400, 'The spreadsheet is empty');
  const grid = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(r.getCell(c).value));
    grid.push(vals);
  });
  return grid;
}

/** Parse a file into { columns matched, rows: [{ _row, ...fields }] } */
export async function parseImport(type, buffer, fileName) {
  const def = IMPORT_TYPES[type];
  if (!def) throw new HttpError(400, 'Unknown import type');
  const grid = await readGrid(buffer, fileName);
  // Find the header row: the first of the top 10 rows that matches a required column
  const lookup = new Map();
  for (const col of def.columns) for (const a of [col.header, col.field, ...(col.aliases || [])]) lookup.set(key(a), col.field);
  let headerIdx = grid.slice(0, 10).findIndex((r) => r.some((c) => lookup.get(key(c)) && def.columns.find((x) => x.field === lookup.get(key(c)))?.required));
  if (headerIdx < 0) throw new HttpError(400, `Could not find a header row. Expected columns like: ${def.columns.filter((c) => c.required).map((c) => c.header).join(', ')}`);
  const header = grid[headerIdx].map((c) => lookup.get(key(c)) || null);
  const missing = def.columns.filter((c) => c.required && !header.includes(c.field)).map((c) => c.header);
  if (missing.length) throw new HttpError(400, `Missing required column(s): ${missing.join(', ')}`);

  const rows = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r.some((c) => c instanceof Date || (c != null && String(c).trim() !== ''))) continue;
    const obj = { _row: i + 1 };
    header.forEach((f, ci) => {
      if (!f) return;
      const v = r[ci];
      obj[f] = v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : typeof v === 'number' ? v : String(v).trim().slice(0, 1000);
    });
    rows.push(obj);
  }
  if (rows.length > 5000) throw new HttpError(400, 'Please import at most 5,000 rows at a time');
  return { matched: def.columns.filter((c) => header.includes(c.field)).map((c) => c.header), rows };
}

function applyRow(type, row, userId) {
  switch (type) {
    case 'students': return saveStudent(row);
    case 'donors': return saveDonor(row);
    case 'donations': {
      const email = normEmail(row.donor_email);
      const donor = email && db.prepare('SELECT d.id FROM donors d JOIN users u ON u.id = d.user_id WHERE u.email = ?').get(email);
      if (!donor) throw new HttpError(400, `No donor with email "${row.donor_email}" — import donors first`);
      return { id: createDonation(donor.id, row, userId), created: true };
    }
    case 'aid': {
      const code = clean(row.student_code, 30, 'Student ID')?.toUpperCase();
      const st = code && db.prepare('SELECT id FROM students WHERE student_code = ?').get(code);
      if (!st) throw new HttpError(400, `No student with ID "${row.student_code}"`);
      return { id: createAid(st.id, row, userId), created: true };
    }
    case 'marks': {
      const data = {
        student_id: studentByCode(row.student_code),
        academic_year: F.academicYear()(row.academic_year),
        term: F.oneOf(TERMS, 'Term')(row.term),
        percentage: F.num('Percentage', 0, 100)(typeof row.percentage === 'string' ? row.percentage.replace('%', '') : row.percentage),
        grade: F.text('Grade', 5)(row.grade),
        remarks: F.text('Remarks', 300)(row.remarks),
      };
      return upsert('marks', ['student_id', 'academic_year', 'term'], data);
    }
    case 'attendance': {
      const m = String(row.month ?? '').trim();
      const data = {
        student_id: studentByCode(row.student_code),
        month: F.month()(/^\d{4}-\d{2}-\d{2}$/.test(m) ? m.slice(0, 7) : m),
        days_present: F.num('Days present', 0, 31, { integer: true })(row.days_present),
        days_total: F.num('Working days', 1, 31, { integer: true })(row.days_total),
      };
      if (data.days_present > data.days_total) throw new HttpError(400, 'Days present cannot be more than working days');
      return upsert('attendance', ['student_id', 'month'], data);
    }
    case 'expenses': {
      const projectName = clean(row.project, 150, 'Project');
      const project = projectName ? db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE').get(projectName) : null;
      if (projectName && !project) throw new HttpError(400, `No project named "${projectName}"`);
      const data = {
        spent_on: F.date('Date', { req: true })(row.spent_on),
        category: F.oneOf(EXPENSE_CATEGORIES, 'Category', 'Other')(row.category),
        amount: F.amount()(row.amount),
        vendor: F.text('Paid to', 150)(row.vendor),
        description: F.text('Description', 500)(row.description),
        project_id: project?.id ?? null,
        mode: F.oneOf(DONATION_MODES, 'Mode', 'Bank Transfer')(row.mode),
        reference_no: F.text('Reference no', 60)(row.reference_no),
        created_by: userId,
      };
      if (data.reference_no && db.prepare('SELECT 1 FROM expenses WHERE reference_no = ? COLLATE NOCASE').get(data.reference_no)) {
        throw new HttpError(409, `An expense with reference ${data.reference_no} is already recorded`);
      }
      const cols = Object.keys(data);
      const out = db.prepare(`INSERT INTO expenses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => data[c]));
      return { id: Number(out.lastInsertRowid), created: true };
    }
  }
}

/**
 * Validate (dryRun) or commit rows. Each row runs in its own savepoint so a bad row
 * never affects the others; on dry run the whole transaction is rolled back.
 */
export function runImport(type, rows, userId, { dryRun }) {
  if (!IMPORT_TYPES[type]) throw new HttpError(400, 'Unknown import type');
  const results = [];
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      db.exec('SAVEPOINT r');
      try {
        const { created } = applyRow(type, row, userId);
        db.exec('RELEASE r');
        results.push({ row: row._row, status: created ? 'create' : 'update' });
      } catch (e) {
        db.exec('ROLLBACK TO r');
        db.exec('RELEASE r');
        results.push({ row: row._row, status: 'error', error: e.status ? e.message : `Unexpected error: ${e.message}` });
      }
    }
    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  return { results, created: count('create'), updated: count('update'), skipped: count('error') };
}

export async function templateWorkbook(type) {
  const def = IMPORT_TYPES[type];
  if (!def) throw new HttpError(404, 'Unknown template');
  return buildWorkbook(def.label, def.columns.map((c) => ({ header: c.header + (c.required ? ' *' : ''), key: c.field, width: Math.max(14, c.header.length + 4) })), [
    Object.fromEntries(def.columns.map((c) => [c.field, c.example])),
  ]);
}

/** columns: [{ header, key, width?, numFmt? }] */
export async function buildWorkbook(sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BANA Connect';
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 18, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  ws.addRows(rows);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4D2B' } };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return wb.xlsx.writeBuffer();
}

export async function sendWorkbook(res, fileName, sheetName, columns, rows) {
  const buf = await buildWorkbook(sheetName, columns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(Buffer.from(buf));
}

