import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, UPLOAD_DIR } from './db.js';

/* Built-in PDF fonts can't draw "₹", so amounts are written as "Rs." in PDFs */
export const rs = (n, exact = true) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 })}`;
const fmtDate = (s) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const GREEN = '#1F4D2B', YELLOW = '#F5C542', MUTED = '#5D6A60', LINE = '#E5E3DA';

export function amountInWords(n) {
  n = Math.round(Number(n) || 0);
  if (!n) return 'Zero Rupees Only';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`);
  const three = (x) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x));
  const parts = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(`${three(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(' ')} Rupees Only`;
}

/**
 * Render a PDF fully in memory, then send it. Building first means a drawing error becomes a
 * normal error response instead of a half-sent download.
 */
export async function pdfResponse(res, fileName, opts, draw) {
  const doc = new PDFDocument({ info: { Title: fileName, Author: getSettings().trust_name }, ...opts });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  await draw(doc);
  doc.end();
  await done;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`);
  res.send(Buffer.concat(chunks));
}

/** Small version of the BANA raised-hands mark */
function logo(doc, x, y, s = 1) {
  [['#B5532D', 0, 22], ['#3F8F4F', 9, 28], ['#2F8FA3', 18, 21]].forEach(([c, dx, hgt]) => {
    doc.save().fillColor(c).roundedRect(x + dx * s, y + (30 - hgt) * s, 7 * s, hgt * s, 2 * s).fill().restore();
  });
  doc.save().fillColor(YELLOW).circle(x + 12.5 * s, y - 1 * s, 1.8 * s).fill().restore();
}

function header(doc, t, title, subtitle) {
  logo(doc, 40, 42, 1.1);
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(16).text(t.trust_name, 82, 44);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5);
  const lines = [t.trust_address, [t.registration_no && `Reg. No. ${t.registration_no}`, t.pan_80g_no && `80G No. ${t.pan_80g_no}`].filter(Boolean).join('  |  '), [t.contact_phone, t.contact_email].filter(Boolean).join('  |  ')].filter(Boolean);
  doc.text(lines.join('\n'), 82, 63, { width: 320 });
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text(title.toUpperCase(), 360, 46, { width: 195, align: 'right', characterSpacing: 1 });
  if (subtitle) doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(subtitle, 360, 62, { width: 195, align: 'right' });
  doc.moveTo(40, 104).lineTo(555, 104).lineWidth(2).strokeColor(YELLOW).stroke();
  doc.y = 118;
}

function table(doc, cols, rows, { totalRow } = {}) {
  const x0 = 40;
  const drawRow = (cells, { bold, fill } = {}) => {
    const y = doc.y;
    const hgt = 18;
    if (y + hgt > 780) { doc.addPage(); doc.y = 50; return drawRow(cells, { bold, fill }); }
    if (fill) doc.save().fillColor(fill).rect(x0, y, 515, hgt).fill().restore();
    let x = x0;
    cols.forEach((c, i) => {
      doc.fillColor(bold ? '#17261B' : '#2D3A30').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(String(cells[i] ?? ''), x + 5, y + 5, { width: c.width - 10, align: c.align || 'left', lineBreak: false, ellipsis: true });
      x += c.width;
    });
    doc.moveTo(x0, y + hgt).lineTo(x0 + 515, y + hgt).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + hgt;
  };
  drawRow(cols.map((c) => c.label), { bold: true, fill: '#EFF6F0' });
  rows.forEach((r) => drawRow(r));
  if (totalRow) drawRow(totalRow, { bold: true, fill: '#FAF9F5' });
  doc.moveDown(0.8);
}

function sectionTitle(doc, text) {
  if (doc.y > 720) { doc.addPage(); doc.y = 50; }
  doc.moveDown(0.4).fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text(text, 40);
  doc.moveDown(0.3);
}

/* ---------------- 80G yearly statement ---------------- */

export function donorStatement(res, { donor, donations, fy }) {
  const t = getSettings();
  const total = donations.reduce((s, d) => s + d.amount, 0);
  return pdfResponse(res, `80G-statement-FY${fy}-${donor.name}.pdf`, { size: 'A4', margin: 40 }, (doc) => {
    header(doc, t, 'Statement of Donations', `Financial Year ${fy} (1 Apr ${fy.slice(0, 4)} – 31 Mar ${Number(fy.slice(0, 4)) + 1})`);
    doc.fillColor('#17261B').font('Helvetica-Bold').fontSize(10).text('Donor', 40, doc.y);
    doc.font('Helvetica').fontSize(9.5).fillColor('#2D3A30')
      .text([donor.name, [donor.address, donor.city].filter(Boolean).join(', '), donor.pan ? `PAN: ${donor.pan}` : 'PAN: not on record', donor.email].filter(Boolean).join('\n'));
    doc.moveDown(0.8);
    table(doc, [
      { label: 'Date', width: 75 }, { label: 'Receipt No', width: 115 }, { label: 'Mode', width: 80 },
      { label: 'Reference', width: 105 }, { label: 'Amount', width: 140, align: 'right' },
    ], donations.map((d) => [fmtDate(d.donated_on), d.receipt_no, d.mode, d.reference_no || '-', rs(d.amount)]),
    { totalRow: ['Total', '', '', `${donations.length} donation${donations.length === 1 ? '' : 's'}`, rs(total)] });
    doc.fillColor('#17261B').font('Helvetica-Bold').fontSize(9.5).text(`Amount in words: ${amountInWords(total)}`, 40);
    const cash = donations.filter((d) => d.mode === 'Cash' && d.amount > 2000);
    doc.moveDown(1).font('Helvetica').fontSize(8.5).fillColor(MUTED);
    if (t.pan_80g_no) doc.text(`Donations to ${t.trust_name} are eligible for deduction under Section 80G of the Income Tax Act, 1961 (80G No. ${t.pan_80g_no}).`, { width: 515 });
    doc.text('Under Section 80G(5D), cash donations above Rs. 2,000 are not eligible for deduction.' + (cash.length ? ` ${cash.length} donation(s) above are cash over Rs. 2,000.` : ''), { width: 515 });
    if (!donor.pan) doc.text('PAN is required for the donation to be reported in Form 10BD. Please share your PAN with the trust office.', { width: 515 });
    doc.moveDown(3).fillColor('#17261B').fontSize(9).text('Authorised Signatory', 400, doc.y, { width: 155, align: 'center' });
    doc.text(t.trust_name, 400, doc.y, { width: 155, align: 'center' });
    doc.fontSize(7.5).fillColor(MUTED).text(`Generated on ${fmtDate(new Date().toISOString())} by BANA Connect. This is a computer-generated statement.`, 40, 790, { width: 515, align: 'center' });
  });
}

/* ---------------- Student ID card (CR80 size, front and back) ---------------- */

export async function studentIdCard(res, { student, verifyUrl, validTill }) {
  const t = getSettings();
  const QR = (await import('qrcode')).default;
  const qr = await QR.toBuffer(verifyUrl, { margin: 0, width: 200, errorCorrectionLevel: 'M' });
  const W = 243, H = 153; // 85.6 × 54 mm in points
  return pdfResponse(res, `ID-card-${student.student_code}.pdf`, { size: [W, H], margin: 0 }, (doc) => {
    // Front
    doc.rect(0, 0, W, H).fill('#FFFFFF');
    doc.rect(0, 0, W, 34).fill(GREEN);
    logo(doc, 8, 3, 0.85);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text('BANA', 38, 7);
    doc.font('Helvetica').fontSize(5.5).fillColor('#CFE0D3').text('DEVELOPMENT FOUNDATION', 38, 19);
    doc.fillColor(YELLOW).font('Helvetica-Bold').fontSize(6.5).text('STUDENT ID', 150, 13, { width: 85, align: 'right', characterSpacing: 1 });
    const photo = student.photo_path && path.join(UPLOAD_DIR, 'photos', path.basename(student.photo_path));
    let photoDrawn = false;
    if (photo && fs.existsSync(photo)) {
      try {
        const img = doc.openImage(photo); // throws on a corrupt image before anything is drawn
        doc.save().roundedRect(10, 42, 54, 66, 4).clip().image(img, 10, 42, { cover: [54, 66], align: 'center', valign: 'center' }).restore();
        photoDrawn = true;
      } catch {
        // unreadable photo: fall back to initials
      }
    }
    if (!photoDrawn) {
      doc.roundedRect(10, 42, 54, 66, 4).fill('#EFF6F0');
      const ini = student.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(18).text(ini, 10, 66, { width: 54, align: 'center' });
    }
    doc.roundedRect(10, 42, 54, 66, 4).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.fillColor('#17261B').font('Helvetica-Bold').fontSize(9).text(student.name, 72, 42, { width: 112, lineBreak: false, ellipsis: true });
    const field = (label, value, y) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(5.5).text(label.toUpperCase(), 72, y);
      doc.fillColor('#17261B').font('Helvetica-Bold').fontSize(7).text(value || '-', 72, y + 6.5, { width: 112, lineBreak: false, ellipsis: true });
    };
    field('Student ID', student.student_code, 56);
    field('Programme', student.programme, 71);
    field('School / Class', [student.school, student.class_year].filter(Boolean).join(' · '), 86);
    field('Village', student.village, 101);
    doc.image(qr, 190, 44, { width: 44 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(4.5).text('Scan to verify', 190, 90, { width: 44, align: 'center' });
    doc.rect(0, H - 22, W, 22).fill('#EFF6F0');
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(6).text(`Valid till ${fmtDate(validTill)}`, 10, H - 14);
    doc.font('Helvetica').fillColor(MUTED).text('Together, we make a difference', 110, H - 14, { width: 125, align: 'right' });

    // Back
    doc.addPage({ size: [W, H], margin: 0 });
    doc.rect(0, 0, W, H).fill('#FFFFFF');
    doc.rect(0, 0, W, 6).fill(YELLOW);
    doc.fillColor('#17261B').font('Helvetica-Bold').fontSize(7.5).text('If found, please return to:', 14, 18);
    doc.font('Helvetica').fontSize(7).fillColor('#2D3A30').text([t.trust_name, t.trust_address, t.contact_phone, t.contact_email].filter(Boolean).join('\n'), 14, 30, { width: 215 });
    doc.fillColor(MUTED).fontSize(6).text(`Guardian: ${student.guardian_name || '-'}${student.guardian_phone ? `  ·  ${student.guardian_phone}` : ''}`, 14, 96, { width: 215 });
    doc.moveTo(140, 128).lineTo(228, 128).lineWidth(0.5).strokeColor('#17261B').stroke();
    doc.fontSize(5.5).fillColor(MUTED).text('Authorised Signatory', 140, 131, { width: 88, align: 'center' });
    doc.fontSize(5).text('This card is the property of the trust and is not transferable.', 14, 140, { width: 120 });
  });
}

/* ---------------- Trustees' annual summary ---------------- */

export function annualSummary(res, s) {
  const t = getSettings();
  return pdfResponse(res, `annual-summary-FY${s.fy}.pdf`, { size: 'A4', margin: 40 }, (doc) => {
    header(doc, t, 'Annual Summary', `Financial Year ${s.fy}`);
    // Key figures
    const tiles = [
      ['Donations received', rs(s.income, false)], ['Aid to students', rs(s.aid, false)],
      ['Other expenses', rs(s.expenses, false)], ['Surplus / (deficit)', rs(s.income - s.aid - s.expenses, false)],
    ];
    const y0 = doc.y;
    tiles.forEach(([label, value], i) => {
      const x = 40 + i * 130;
      doc.save().roundedRect(x, y0, 122, 46, 6).fill('#EFF6F0').restore();
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(label, x + 8, y0 + 8, { width: 106 });
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text(value, x + 8, y0 + 22, { width: 106 });
    });
    doc.x = 40;
    doc.y = y0 + 58;

    const kpis = [
      ['Donors who gave', s.donors], ['New donors', s.newDonors], ['Active students', s.activeStudents], ['New students', s.newStudents],
      ['Certificates verified', s.certificatesVerified], ['Scholarships approved', s.scholarshipsApproved], ['Events held', s.events], ['Volunteer hours', s.volunteerHours],
    ];
    sectionTitle(doc, 'At a glance');
    table(doc, [{ label: 'Measure', width: 200 }, { label: 'Value', width: 57, align: 'right' }, { label: 'Measure', width: 200 }, { label: 'Value', width: 58, align: 'right' }],
      [0, 2, 4, 6].map((i) => [kpis[i][0], kpis[i][1], kpis[i + 1][0], kpis[i + 1][1]]));

    sectionTitle(doc, 'Donations by purpose');
    table(doc, [{ label: 'Purpose', width: 300 }, { label: 'Donations', width: 80, align: 'right' }, { label: 'Amount', width: 135, align: 'right' }],
      s.byPurpose.map((r) => [r.purpose, r.n, rs(r.total)]), { totalRow: ['Total', s.byPurpose.reduce((a, r) => a + r.n, 0), rs(s.income)] });

    sectionTitle(doc, 'Donations by mode');
    table(doc, [{ label: 'Mode', width: 300 }, { label: 'Donations', width: 80, align: 'right' }, { label: 'Amount', width: 135, align: 'right' }],
      s.byMode.map((r) => [r.mode, r.n, rs(r.total)]));

    sectionTitle(doc, 'Spending');
    table(doc, [{ label: 'Category', width: 380 }, { label: 'Amount', width: 135, align: 'right' }],
      [...s.aidByType.map((r) => [`Student aid — ${r.type}`, rs(r.total)]), ...s.expensesByCategory.map((r) => [r.category, rs(r.total)])],
      { totalRow: ['Total spending', rs(s.aid + s.expenses)] });

    if (s.projects.length) {
      sectionTitle(doc, 'Projects');
      table(doc, [{ label: 'Project', width: 200 }, { label: 'Status', width: 70 }, { label: 'Goal', width: 85, align: 'right' }, { label: 'Raised (all time)', width: 90, align: 'right' }, { label: 'Funded', width: 70, align: 'right' }],
        s.projects.map((p) => [p.name, p.status, rs(p.goal_amount, false), rs(p.raised, false), `${Math.round((p.raised / p.goal_amount) * 100)}%`]));
    }
    doc.fontSize(7.5).fillColor(MUTED).text(`Generated on ${fmtDate(new Date().toISOString())} by BANA Connect.`, 40, 790, { width: 515, align: 'center' });
  });
}
