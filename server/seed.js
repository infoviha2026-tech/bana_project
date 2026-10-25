import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, tx, UPLOAD_DIR } from './db.js';
import { hashPassword, saveStudent, saveDonor, createDonation, createAid } from './services.js';

/** On first start, create the initial Super Admin so someone can sign in. */
export function ensureSuperAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'super_admin'").get()) return;
  const email = process.env.SUPER_ADMIN_EMAIL || 'superadmin@bana.org';
  const pw = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123';
  db.prepare("INSERT INTO users (role, email, password_hash, name, must_change_password) VALUES ('super_admin', ?, ?, 'Super Admin', 0)").run(email, hashPassword(pw));
  console.log(`Created Super Admin: ${email} / ${pw}  — change this password after signing in.`);
}

const STUDENTS = [
  ['Priya Sharma', 'Female', 'Rampur', 'ZP High School', '9th', 'Education Support'],
  ['Arjun Reddy', 'Male', 'Rampur', 'ZP High School', '10th', 'Education Support'],
  ['Lakshmi Devi', 'Female', 'Kondapur', 'Govt Girls High School', '8th', 'Girl Child Education'],
  ['Ravi Teja', 'Male', 'Kondapur', 'Govt Junior College', 'Inter 1st Year', 'Higher Education Scholarship'],
  ['Sneha Patil', 'Female', 'Venkatapur', 'ZP High School', '7th', 'Education Support'],
  ['Mohammed Irfan', 'Male', 'Venkatapur', 'Govt Polytechnic', 'Diploma 2nd Year', 'Skill Development'],
  ['Kavya Naidu', 'Female', 'Rampur', 'Govt Degree College', 'B.Sc 1st Year', 'Higher Education Scholarship'],
  ['Suresh Kumar', 'Male', 'Chintalapalli', 'ZP High School', '9th', 'Education Support'],
  ['Anjali Rao', 'Female', 'Chintalapalli', 'Govt Girls High School', '10th', 'Girl Child Education'],
  ['Vikram Singh', 'Male', 'Kondapur', 'ZP High School', '6th', 'Education Support'],
  ['Divya Bharathi', 'Female', 'Venkatapur', 'Govt Junior College', 'Inter 2nd Year', 'Higher Education Scholarship'],
  ['Naveen Goud', 'Male', 'Rampur', 'ITI Centre', 'Electrician Trade', 'Skill Development'],
  ['Pooja Yadav', 'Female', 'Chintalapalli', 'ZP High School', '8th', 'Girl Child Education'],
  ['Karthik M', 'Male', 'Kondapur', 'Govt Degree College', 'B.Com 2nd Year', 'Higher Education Scholarship'],
  ['Meena Kumari', 'Female', 'Rampur', 'ZP High School', '7th', 'Education Support'],
  ['Harish Babu', 'Male', 'Venkatapur', 'ZP High School', '10th', 'Education Support'],
];

const DONORS = [
  ['Ravi Reddy', 'ravi.reddy@example.com', 'Hyderabad', 'Trustee'],
  ['Sunitha Rao', 'sunitha.rao@example.com', 'Bengaluru', 'Trustee'],
  ['Anil Kumar', 'anil.kumar@example.com', 'Hyderabad', 'Individual'],
  ['Green Valley Infra Pvt Ltd', 'csr@greenvalley.example.com', 'Hyderabad', 'Organisation'],
  ['Padma Srinivas', 'padma.s@example.com', 'Chennai', 'Individual'],
  ['Rajesh Gupta', 'rajesh.gupta@example.com', 'Pune', 'Individual'],
  ['Lakshmi Narayana', 'ln@example.com', 'Vijayawada', 'Trustee'],
];

const PURPOSES = ['General Fund', 'Scholarships', 'School Infrastructure', 'Books & Uniforms', 'Village Development'];
const MODES = ['Bank Transfer', 'UPI', 'Cheque', 'Cash'];

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function samplePdf(text) {
  const stream = `BT /F1 20 Tf 60 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

export function seedDemo() {
  if (db.prepare('SELECT COUNT(*) n FROM students').get().n) {
    console.log('Database already has students — skipping demo data.');
    return;
  }
  ensureSuperAdmin();
  const R = rand(42);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const superId = db.prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").get().id;

  tx(() => {
    db.prepare("INSERT OR IGNORE INTO users (role, email, password_hash, name, phone) VALUES ('admin', 'staff@bana.org', ?, 'Office Staff', '9000000001')").run(hashPassword('Staff@123'));

    const studentIds = STUDENTS.map(([name, gender, village, school, cls, programme], i) => {
      const code = `BANA-${String(i + 1).padStart(3, '0')}`;
      const { id } = saveStudent({
        student_code: code, name, gender, village, school, class_year: cls, programme,
        email: i < 10 ? `${name.split(' ')[0].toLowerCase()}.${i + 1}@student.example.com` : null,
        phone: `98${String(48000000 + i * 7919).slice(0, 8)}`,
        guardian_name: `${pick(['Ramesh', 'Srinivas', 'Venkat', 'Saraswathi', 'Narsimha', 'Yadamma'])} ${name.split(' ').slice(-1)[0]}`,
        guardian_phone: `97${String(10000000 + i * 4111).slice(0, 8)}`,
        address: `H.No ${1 + i * 3}-${10 + i}, Main Street`,
        dob: `${2006 + Math.floor(R() * 8)}-${String(1 + Math.floor(R() * 12)).padStart(2, '0')}-${String(1 + Math.floor(R() * 27)).padStart(2, '0')}`,
        joined_on: `${2023 + Math.floor(R() * 3)}-06-${String(1 + Math.floor(R() * 20)).padStart(2, '0')}`,
        status: i === 15 ? 'Alumni' : 'Active',
        password: 'Student@123',
      });
      db.prepare('UPDATE users SET must_change_password = 0 WHERE id = (SELECT user_id FROM students WHERE id = ?)').run(id);
      return id;
    });

    for (const sid of studentIds) {
      const n = 1 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) {
        const y = 2025 + Math.floor(R() * 2);
        createAid(sid, { amount: pick([2500, 3000, 5000, 7500, 10000, 12000]), given_on: `${y}-${String(1 + Math.floor(R() * 9)).padStart(2, '0')}-10`, type: pick(['Scholarship', 'Scholarship', 'Fees', 'Books', 'Uniform']), notes: pick(['Term fees', 'Annual scholarship', 'Text books', 'School uniform', '']) }, superId);
      }
    }

    const certTitles = [['Class 9 Marksheet', 'Marksheet'], ['District Science Fair – 1st Prize', 'Academic'], ['Inter-school Kabaddi', 'Sports'], ['Computer Basics Course', 'Skill/Training'], ['Aadhaar Card', 'Identity'], ['Dance Competition', 'Cultural']];
    const ins = db.prepare('INSERT INTO certificates (student_id, title, category, issued_on, file_path, file_name, mime_type, size, status, remarks, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    studentIds.slice(0, 12).forEach((sid, i) => {
      for (let k = 0; k < 1 + (i % 3); k++) {
        const [title, cat] = certTitles[(i + k) % certTitles.length];
        const buf = samplePdf(`${STUDENTS[i][0]} - ${title}`);
        const file = crypto.randomUUID() + '.pdf';
        fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
        const status = k === 0 && i % 4 !== 3 ? 'Verified' : i % 5 === 2 && k === 1 ? 'Rejected' : 'Pending';
        const created = `2026-${String(4 + ((i + k) % 6)).padStart(2, '0')}-${String(3 + i).padStart(2, '0')} 10:30:00`;
        ins.run(sid, title, cat, created.slice(0, 10), file, `${title}.pdf`, 'application/pdf', buf.length, status,
          status === 'Rejected' ? 'Image is unclear — please upload a clearer scan' : status === 'Verified' ? 'Verified against original' : null,
          status === 'Pending' ? null : superId, status === 'Pending' ? null : created, created);
      }
    });

    DONORS.forEach(([name, email, city, type], i) => {
      const { id } = saveDonor({ name, email, city, donor_type: type, phone: `99${String(50000000 + i * 13331).slice(0, 8)}`, pan: `ABCDE${1000 + i}F`, address: `${10 + i} Main Road`, password: 'Donor@123' });
      db.prepare('UPDATE users SET must_change_password = 0 WHERE id = (SELECT user_id FROM donors WHERE id = ?)').run(id);
      const n = type === 'Organisation' ? 3 : 3 + Math.floor(R() * 6);
      const gifts = [];
      for (let k = 0; k < n; k++) {
        const date = new Date(Date.UTC(2024, 6, 1) + Math.floor(R() * 830) * 86400000).toISOString().slice(0, 10);
        gifts.push(date);
      }
      gifts.sort().forEach((date) => {
        const amount = type === 'Organisation' ? pick([200000, 250000, 500000]) : type === 'Trustee' ? pick([25000, 50000, 100000]) : pick([2000, 5000, 10000, 15000]);
        createDonation(id, { amount, donated_on: date, mode: pick(MODES), purpose: pick(PURPOSES), reference_no: `TXN${Math.floor(R() * 9e8 + 1e8)}` }, superId);
      });
    });

    const ann = db.prepare('INSERT INTO announcements (title, body, audience, pinned, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    ann.run('Scholarship applications open for 2026-27', 'Students moving to Inter, Degree, or Diploma courses can apply for the Higher Education Scholarship. Upload your latest marksheet under My Certificates before 30 November.', 'students', 1, superId, '2026-10-01 09:00:00');
    ann.run('Thank you for supporting our new library', 'With your contributions, the Rampur ZP High School library now has 1,200 new books and a reading corner. Photos are on our website.', 'donors', 1, superId, '2026-09-20 09:00:00');
    ann.run('Diwali celebration at the Rampur centre', 'All students, families, and donors are invited on 18 October at 5 pm. Sweets and a cultural programme by our students.', 'all', 0, superId, '2026-10-10 09:00:00');
    ann.run('Free health check-up camp', 'A free health check-up camp will be held at the Kondapur centre on 2 November. Bring your Aadhaar card.', 'students', 0, superId, '2026-10-05 09:00:00');
  });
  console.log('Demo data created.');
  console.log('  Super Admin: superadmin@bana.org / Admin@123');
  console.log('  Staff admin: staff@bana.org / Staff@123');
  console.log('  Student:     BANA-001 / Student@123');
  console.log('  Donor:       ravi.reddy@example.com / Donor@123');
}

/** Demo data for projects, pledges, sponsorships, scholarships, academics, documents, stories, expenses, events, volunteers */
export function seedExtras() {
  if (db.prepare('SELECT COUNT(*) n FROM projects').get().n) {
    console.log('Feature demo data already present — skipping.');
    return;
  }
  if (!db.prepare('SELECT COUNT(*) n FROM students').get().n) return;
  const R = rand(7);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const superId = db.prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").get().id;
  const sid = (code) => db.prepare('SELECT id FROM students WHERE student_code = ?').get(code)?.id;
  const did = (email) => db.prepare('SELECT d.id FROM donors d JOIN users u ON u.id = d.user_id WHERE u.email = ?').get(email)?.id;
  let ref = 1000;
  const nextRef = () => `NEFT${2026}${ref++}`;

  tx(() => {
    // Document checklist
    const reqIns = db.prepare('INSERT INTO doc_requirements (name, category, programme, description, sort) VALUES (?, ?, ?, ?, ?)');
    const reqAadhaar = Number(reqIns.run('Aadhaar Card', 'Identity', null, 'Front side, clearly readable', 1).lastInsertRowid);
    const reqMarks = Number(reqIns.run('Latest Marksheet', 'Marksheet', null, 'Most recent exam results', 2).lastInsertRowid);
    reqIns.run('Income Certificate', 'Other', null, 'Family income certificate from the Tahsildar office', 3);
    reqIns.run('Bonafide Certificate', 'Academic', null, 'From your school or college, this academic year', 4);
    reqIns.run('College Fee Receipt', 'Other', 'Higher Education Scholarship', 'Fee receipt for the current year', 5);
    db.prepare("UPDATE certificates SET requirement_id = ? WHERE title = 'Aadhaar Card'").run(reqAadhaar);
    db.prepare("UPDATE certificates SET requirement_id = ? WHERE title LIKE '%Marksheet%'").run(reqMarks);

    // Projects
    const projIns = db.prepare('INSERT INTO projects (name, description, village, goal_amount, start_date, end_date, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const pLibrary = Number(projIns.run('Rampur School Library', 'A reading room with 1,200 books, shelves, and a reading corner for ZP High School, Rampur.', 'Rampur', 500000, '2024-08-01', '2025-12-31', 'Completed', superId).lastInsertRowid);
    const pWater = Number(projIns.run('Clean Drinking Water — Kondapur', 'An RO water plant at the Kondapur school so 400 children and their families get safe drinking water.', 'Kondapur', 800000, '2025-06-01', '2026-12-31', 'Active', superId).lastInsertRowid);
    const pDigital = Number(projIns.run('Digital Classroom — Venkatapur', 'Projector, 10 tablets, and internet for the Venkatapur ZP High School.', 'Venkatapur', 600000, '2026-01-15', '2027-03-31', 'Active', superId).lastInsertRowid);
    const pCycles = Number(projIns.run('Bicycles for Girls', 'Bicycles so girls from Chintalapalli can reach the high school 6 km away.', 'Chintalapalli', 300000, '2026-04-01', '2026-12-31', 'Active', superId).lastInsertRowid);
    db.prepare("UPDATE donations SET project_id = ? WHERE purpose = 'School Infrastructure' AND donated_on < '2025-10-01'").run(pLibrary);
    db.prepare("UPDATE donations SET project_id = ? WHERE purpose = 'School Infrastructure' AND donated_on >= '2025-10-01'").run(pDigital);
    db.prepare("UPDATE donations SET project_id = ? WHERE purpose = 'Village Development'").run(pWater);

    // Pledges with linked donations
    const plIns = db.prepare('INSERT INTO pledges (donor_id, amount, frequency, start_date, purpose, project_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const ravi = did('ravi.reddy@example.com'), sunitha = did('sunitha.rao@example.com'), padma = did('padma.s@example.com'), green = did('csr@greenvalley.example.com');
    const plRavi = Number(plIns.run(ravi, 5000, 'Monthly', '2026-01-05', 'Clean Drinking Water', pWater, 'Active', superId).lastInsertRowid);
    for (let m = 1; m <= 8; m++) createDonation(ravi, { amount: 5000, donated_on: `2026-${String(m).padStart(2, '0')}-07`, mode: 'Bank Transfer', reference_no: nextRef(), purpose: 'Village Development', project_id: pWater, pledge_id: plRavi }, superId);
    const plSunitha = Number(plIns.run(sunitha, 50000, 'Yearly', '2025-04-10', 'Scholarships', null, 'Active', superId).lastInsertRowid);
    for (const d of ['2025-04-12', '2026-04-15']) createDonation(sunitha, { amount: 50000, donated_on: d, mode: 'Bank Transfer', reference_no: nextRef(), purpose: 'Scholarships', pledge_id: plSunitha }, superId);
    const plPadma = Number(plIns.run(padma, 7500, 'Quarterly', '2026-01-01', 'Bicycles for Girls', pCycles, 'Active', superId).lastInsertRowid);
    for (const d of ['2026-01-03', '2026-04-04']) createDonation(padma, { amount: 7500, donated_on: d, mode: 'UPI', reference_no: nextRef(), purpose: 'Books & Uniforms', project_id: pCycles, pledge_id: plPadma }, superId);
    createDonation(green, { amount: 150000, donated_on: '2026-06-20', mode: 'Bank Transfer', reference_no: nextRef(), purpose: 'School Infrastructure', project_id: pDigital }, superId);

    // Sponsorships
    const spIns = db.prepare('INSERT INTO sponsorships (donor_id, student_id, start_date, annual_amount, notes) VALUES (?, ?, ?, ?, ?)');
    spIns.run(ravi, sid('BANA-001'), '2025-06-01', 12000, 'Full-year education support');
    spIns.run(ravi, sid('BANA-003'), '2025-06-01', 12000, null);
    spIns.run(sunitha, sid('BANA-007'), '2025-07-01', 25000, 'Degree college fees');
    spIns.run(green, sid('BANA-004'), '2024-06-01', 30000, 'CSR sponsorship');
    spIns.run(green, sid('BANA-011'), '2024-06-01', 30000, 'CSR sponsorship');

    // Scholarships
    const callIns = db.prepare('INSERT INTO scholarship_calls (title, description, academic_year, programme, max_amount, deadline, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const callOpen = Number(callIns.run('Higher Education Scholarship 2026-27', 'For students joining or continuing Intermediate, Diploma, or Degree courses. Attach your latest marksheet and fee receipt.', '2026-27', null, 25000, '2026-11-30', 'Open', superId, '2026-10-01 09:00:00').lastInsertRowid);
    const callClosed = Number(callIns.run('Merit Award 2025-26', 'For students scoring above 85% in the annual exams.', '2025-26', null, 10000, '2026-05-31', 'Closed', superId, '2026-04-20 09:00:00').lastInsertRowid);
    const appIns = db.prepare('INSERT INTO scholarship_applications (call_id, student_id, amount_requested, reason, certificate_ids, status, amount_approved, remarks, aid_id, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    appIns.run(callOpen, sid('BANA-004'), 20000, 'I have joined Inter 2nd year and need help with college fees and books. My father is a daily wage labourer.', '[]', 'Submitted', null, null, null, null, null, '2026-10-08 11:20:00');
    appIns.run(callOpen, sid('BANA-007'), 25000, 'I am in B.Sc 1st year and want to continue my studies. My family cannot afford the semester fees this year.', '[]', 'Under review', null, null, null, superId, '2026-10-12 10:00:00', '2026-10-05 16:45:00');
    const meritAid = Number(db.prepare("INSERT INTO aid (student_id, amount, given_on, type, notes, created_by) VALUES (?, 10000, '2026-06-10', 'Scholarship', 'Merit Award 2025-26', ?)").run(sid('BANA-011'), superId).lastInsertRowid);
    appIns.run(callClosed, sid('BANA-011'), 10000, 'I scored 91% in my 10th class annual exams and want to continue to Intermediate.', '[]', 'Approved', 10000, 'Excellent results — well done!', meritAid, superId, '2026-06-08 12:00:00', '2026-05-02 09:30:00');

    // Marks and attendance
    const active = db.prepare("SELECT id, student_code FROM students WHERE status = 'Active'").all();
    const markIns = db.prepare('INSERT INTO marks (student_id, academic_year, term, percentage, grade) VALUES (?, ?, ?, ?, ?)');
    const grade = (p) => (p >= 90 ? 'A+' : p >= 80 ? 'A' : p >= 70 ? 'B+' : p >= 60 ? 'B' : p >= 50 ? 'C' : p >= 35 ? 'D' : 'E');
    const attIns = db.prepare('INSERT INTO attendance (student_id, month, days_present, days_total) VALUES (?, ?, ?, ?)');
    for (const s of active) {
      let base = 55 + Math.floor(R() * 35);
      const terms = [['2024-25', 'Annual'], ['2025-26', 'Term 1'], ['2025-26', 'Term 2'], ['2025-26', 'Annual'], ['2026-27', 'Term 1']];
      terms.forEach(([y, t], i) => {
        let p = Math.min(98, Math.max(30, base + Math.round((R() - 0.4) * 8)));
        if (s.student_code === 'BANA-008' && i === terms.length - 1) p = 36;
        if (s.student_code === 'BANA-013' && i === terms.length - 1) p = Math.max(30, base - 22);
        markIns.run(s.id, y, t, p, grade(p));
        base = p;
      });
      for (const m of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
        if (m === '2026-05') continue; // summer holidays
        const total = 22 + Math.floor(R() * 4);
        const rate = s.student_code === 'BANA-010' ? 0.62 + R() * 0.06 : 0.82 + R() * 0.17;
        attIns.run(s.id, m, Math.min(total, Math.round(total * rate)), total);
      }
    }

    // Stories
    const stIns = db.prepare('INSERT INTO stories (title, body, project_id, village, published, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
    stIns.run('The Rampur library is open!', 'After a year of work, the ZP High School in Rampur now has a bright reading room with 1,200 books in Telugu and English. Students stay after class to read, and teachers say borrowing has tripled in the first month.\n\nThank you to every donor who made this possible.', pLibrary, 'Rampur', superId, '2026-01-20 10:00:00');
    stIns.run('Water plant foundation laid in Kondapur', 'Construction of the RO water plant at the Kondapur school started this month. When complete, 400 children and their families will have safe drinking water every day. We are 70% of the way to our goal.', pWater, 'Kondapur', superId, '2026-08-12 10:00:00');
    stIns.run('First tablets arrive in Venkatapur', 'Ten tablets and a projector arrived at Venkatapur ZP High School. Class 8 students had their first science lesson with videos — "I saw how a volcano works!" said one student.', pDigital, 'Venkatapur', superId, '2026-09-25 10:00:00');

    // Expenses
    const exIns = db.prepare('INSERT INTO expenses (spent_on, category, amount, vendor, description, project_id, mode, reference_no, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const ex = [
      ['2025-05-10', 'Infrastructure', 185000, 'Sri Sai Furniture Works', 'Library shelves and tables', pLibrary],
      ['2025-07-02', 'Educational Supplies', 142000, 'Vishalandhra Book House', '1,200 library books', pLibrary],
      ['2025-09-15', 'Salaries', 36000, 'Field coordinator', 'Salary Jul–Sep', null],
      ['2025-12-15', 'Salaries', 36000, 'Field coordinator', 'Salary Oct–Dec', null],
      ['2026-01-28', 'Events', 18500, 'Lakshmi Caterers', 'Republic Day celebration and prizes', null],
      ['2026-03-15', 'Salaries', 36000, 'Field coordinator', 'Salary Jan–Mar', null],
      ['2026-03-20', 'Administration', 8400, 'Office rent', 'Office rent Jan–Mar', null],
      ['2026-05-18', 'Infrastructure', 240000, 'AquaPure Systems', 'RO plant equipment (advance)', pWater],
      ['2026-06-18', 'Educational Supplies', 64000, 'Sri Lakshmi Book Depot', 'Notebooks, bags, and geometry boxes for all students', null],
      ['2026-06-30', 'Salaries', 39000, 'Field coordinator', 'Salary Apr–Jun', null],
      ['2026-07-22', 'Infrastructure', 210000, 'TechEd Solutions', 'Projector, 10 tablets, Wi-Fi router', pDigital],
      ['2026-08-16', 'Events', 12000, 'Lakshmi Caterers', 'Independence Day programme', null],
      ['2026-09-05', 'Travel', 6800, 'Auto and bus fares', 'Field visits to villages', null],
      ['2026-09-30', 'Salaries', 39000, 'Field coordinator', 'Salary Jul–Sep', null],
      ['2026-09-30', 'Utilities', 4200, 'TSSPDCL', 'Electricity — learning centre', null],
    ];
    ex.forEach(([d, c, a, v, desc, proj], i) => exIns.run(d, c, a, v, desc, proj, i % 4 === 0 ? 'Cheque' : 'Bank Transfer', `VCH-${String(i + 1).padStart(4, '0')}`, superId));

    // Events, attendance, volunteers
    const evIns = db.prepare('INSERT INTO events (title, event_date, location, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)');
    const evIndep = Number(evIns.run('Independence Day celebration', '2026-08-15', 'Rampur learning centre', 'Flag hoisting, patriotic songs, and a quiz for students.', 'Completed', superId).lastInsertRowid);
    const evScience = Number(evIns.run('Science fair', '2026-09-12', 'ZP High School, Kondapur', 'Students present working models. Best three models get prizes.', 'Completed', superId).lastInsertRowid);
    evIns.run('Diwali celebration', '2026-10-18', 'Rampur learning centre', 'Sweets, rangoli competition, and a cultural programme by our students. Families and donors are welcome.', 'Upcoming', superId);
    evIns.run('Free health check-up camp', '2026-11-02', 'Kondapur centre', 'Doctors from the district hospital will check eyes, teeth, and general health. Bring your Aadhaar card.', 'Upcoming', superId);
    const attEv = db.prepare('INSERT INTO event_attendees (event_id, student_id) VALUES (?, ?)');
    active.forEach((s, i) => { attEv.run(evIndep, s.id); if (i % 2 === 0) attEv.run(evScience, s.id); });
    const volIns = db.prepare('INSERT INTO volunteers (name, phone, email, skills, village, joined_on) VALUES (?, ?, ?, ?, ?, ?)');
    const vols = [
      ['Srinivas Rao', '9849012345', 'srinivas.v@example.com', 'Maths tutoring', 'Rampur', '2024-07-01'],
      ['Anitha Kumari', '9849023456', null, 'English, spoken English classes', 'Kondapur', '2025-01-10'],
      ['Prakash Goud', '9849034567', null, 'Event logistics, photography', 'Venkatapur', '2025-06-15'],
      ['Dr. Meera Iyer', '9849045678', 'meera.iyer@example.com', 'Health camps', 'Hyderabad', '2025-11-01'],
      ['Rahul Varma', '9849056789', 'rahul.v@example.com', 'Computer classes', 'Rampur', '2026-02-01'],
    ].map((v) => Number(volIns.run(...v).lastInsertRowid));
    const hIns = db.prepare('INSERT INTO volunteer_hours (volunteer_id, event_id, worked_on, hours, activity) VALUES (?, ?, ?, ?, ?)');
    hIns.run(vols[2], evIndep, '2026-08-15', 6, 'Event setup and photography');
    hIns.run(vols[0], evScience, '2026-09-12', 5, 'Judging science models');
    hIns.run(vols[4], evScience, '2026-09-12', 4, 'Helping students with demos');
    for (let w = 0; w < 10; w++) {
      hIns.run(vols[0], null, `2026-0${7 + Math.floor(w / 4)}-${String(3 + (w % 4) * 7).padStart(2, '0')}`, 2, 'Weekend maths class');
      hIns.run(vols[1], null, `2026-0${7 + Math.floor(w / 4)}-${String(4 + (w % 4) * 7).padStart(2, '0')}`, 1.5, 'Spoken English class');
    }

    // A few notifications so the bell isn't empty
    const n = db.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)');
    const u = (code) => db.prepare('SELECT user_id FROM students WHERE student_code = ?').get(code).user_id;
    n.run(u('BANA-001'), 'Scholarship open: Higher Education Scholarship 2026-27', 'Apply before 2026-11-30.', '/scholarships', '2026-10-01 09:00:00');
    n.run(u('BANA-001'), 'Certificate verified: Class 9 Marksheet', 'Verified against original', '/certificates', '2026-04-05 12:00:00');
    n.run(db.prepare('SELECT user_id FROM donors WHERE id = ?').get(ravi).user_id, 'Pledge reminder', 'Your monthly pledge towards Clean Drinking Water has 2 instalments pending. You can donate online from the portal.', '/donate', '2026-10-10 09:00:00');
    void pick;
  });
  console.log('Feature demo data created (projects, pledges, sponsorships, scholarships, marks, attendance, stories, expenses, events, volunteers).');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedDemo();
  seedExtras();
}
