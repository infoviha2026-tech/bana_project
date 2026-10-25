# BANA Connect — Product Requirements Document

**Product:** BANA Connect — internal portal for BANA Development Foundation
**Version:** 1.0 (MVP)
**Date:** 17 Oct 2026
**Status:** Approved for build

---

## 1. Background

BANA Development Foundation is a trust that supports students through education, scholarships, and community programmes in villages. Its public website ("Together, we make a difference") tells the story. Behind the website, the trust needs an **internal portal** that brings together three groups that currently work through paper, WhatsApp, and spreadsheets:

| Group | Today | Problem |
|---|---|---|
| **Students** supported by the trust | Send certificate photos over WhatsApp, ask staff for their records | Documents get lost; no single record per student; students can't see their own status |
| **Donors / owners** who give money | Get updates informally | No self-service view of how much they've given, receipts, or impact |
| **Trust administrators** | Keep data in several Excel sheets | Data is duplicated and out of date; no audit trail; hard to report totals |

## 2. Goals

1. One secure place where every student, donor, and administrator signs in with their own role.
2. Students manage their own profile and upload certificates; staff verify them.
3. Donors see every amount they've given, download receipts, and see the impact of their giving.
4. The Super Admin has **complete control** over all data, users, and settings.
5. Existing Excel data can be **imported** into the portal database, and any list can be **exported** back to Excel.

### Non-goals (v1)

- Online payment collection (donations are recorded by admins; a payment gateway is in Phase 2).
- Native mobile apps (the web portal is mobile-responsive).
- SMS/WhatsApp notifications (Phase 2).

## 3. Users and roles

| Role | Who | Access |
|---|---|---|
| **Super Admin** | Trust owner / chief administrator | Everything: all modules, user and admin management, settings, audit log, delete actions |
| **Admin (Staff)** | Trust office staff | Students, certificates, donors, donations, announcements, import/export. Cannot manage admin accounts, change settings, or view the audit log |
| **Student** | A student supported by the trust | Own profile, own certificates, own aid history, announcements |
| **Donor** | Trust owner, family member, or external donor | Own donations, receipts, impact summary, announcements |

Rules:
- Every account has exactly one role.
- Users only ever see their own records unless they are an Admin or Super Admin.
- A deactivated account cannot sign in.
- There must always be at least one active Super Admin.

## 4. Functional requirements

### 4.1 Authentication and accounts

| ID | Requirement |
|---|---|
| AUTH-1 | Sign in with email (or Student ID for students) and password. |
| AUTH-2 | Passwords are stored hashed (bcrypt). Sessions use signed tokens that expire after 7 days. |
| AUTH-3 | Users can change their own password. |
| AUTH-4 | Admins can reset any student's or donor's password; the Super Admin can reset anyone's. |
| AUTH-5 | Accounts created by an admin or by Excel import get a default password and are flagged **must change password** on first sign-in. |
| AUTH-6 | Sign-in is rate-limited (10 failed attempts per 15 min per IP). |

### 4.2 Student portal

| ID | Requirement |
|---|---|
| STU-1 | **Dashboard:** greeting, profile completion, certificate counts by status (pending / verified / rejected), total aid received, latest announcements. |
| STU-2 | **My Profile:** view all details. Students can edit contact fields (phone, address, guardian name/phone). Academic fields (school, class, programme) are edited by admins only. |
| STU-3 | **Upload certificates:** title, category (Academic, Marksheet, Sports, Cultural, Skill/Training, Identity, Other), issue date, file (PDF, JPG, PNG, up to 5 MB). |
| STU-4 | **My Certificates:** list with status badge, reviewer's remarks, view/download file. A student can delete a certificate only while it is pending. |
| STU-5 | **My Support:** list of scholarships, fees, books, and other aid the trust has given the student, with total. |
| STU-6 | **Announcements:** read notices addressed to students or to everyone. |

### 4.3 Donor portal

| ID | Requirement |
|---|---|
| DON-1 | **Dashboard:** total donated (lifetime), this financial year (Apr–Mar), number of donations, last donation, a chart of giving by year, and impact numbers (students supported by the trust, certificates verified). |
| DON-2 | **My Donations:** full history — date, amount, mode (Cash, Bank transfer, UPI, Cheque), purpose/fund, reference number, receipt number. Filter by year. |
| DON-3 | **Receipts:** printable receipt for each donation with the trust's details and the 80G note. |
| DON-4 | **My Profile:** view details, edit phone and address, change password. |
| DON-5 | **Announcements:** notices addressed to donors or to everyone. |

### 4.4 Admin and Super Admin portal

| ID | Requirement |
|---|---|
| ADM-1 | **Overview dashboard:** total students (active), total donors, total donations received (lifetime and this FY), aid disbursed, pending certificates, donations by month (last 12 months), recent activity. |
| ADM-2 | **Students:** searchable, filterable list (status, programme, class); create, edit, deactivate; view a student's full record (profile, certificates, aid). Creating a student creates their login. |
| ADM-3 | **Certificates review queue:** all certificates filterable by status; preview file; verify or reject with remarks. |
| ADM-4 | **Aid / disbursements:** record scholarships and other support given to a student (date, type, amount, notes). |
| ADM-5 | **Donors:** list, create, edit, deactivate; view a donor's full history and lifetime total. Creating a donor creates their login. |
| ADM-6 | **Donations:** record, edit, delete donations; auto-generate receipt numbers (`BANA/YYYY-YY/0001`); filter by donor, date range, mode, purpose; totals shown for the filtered set. |
| ADM-7 | **Announcements:** create, edit, delete; audience = everyone, students, or donors; pin important ones. |
| ADM-8 | **Excel import:** see §4.5. |
| ADM-9 | **Excel export:** every list (students, donors, donations, aid, certificates) can be exported to `.xlsx`, respecting the current filters. |
| SA-1 | **User management (Super Admin only):** list all accounts across roles; create admins and super admins; change role; activate/deactivate; reset passwords. |
| SA-2 | **Settings (Super Admin only):** trust name, address, registration number, 80G number, contact email/phone (used on receipts); default password for new accounts. |
| SA-3 | **Audit log (Super Admin only):** every create, update, delete, import, sign-in, and status change, with who, what, and when. |
| SA-4 | **Delete permanently:** only the Super Admin can permanently delete students, donors, and users. Admins can deactivate only. |

### 4.5 Excel data import

The trust's existing spreadsheets must flow into the portal database.

| ID | Requirement |
|---|---|
| XL-1 | Import types: **Students**, **Donors**, **Donations**, **Aid disbursements**. |
| XL-2 | Accept `.xlsx` and `.csv` (up to 10 MB). |
| XL-3 | Download a **template** for each type with the correct column headers and an example row. |
| XL-4 | **Preview before saving:** after upload, show each row with its validation result (valid / error with a reason, e.g. "invalid email", "amount must be a number", "donor not found"). |
| XL-5 | Column headers are matched case-insensitively and ignoring spaces/underscores (`Full Name`, `full_name`, `FULLNAME` all work). |
| XL-6 | **Upsert:** students are matched on Student ID, donors on email. Existing records are updated, new ones are created (with a login). |
| XL-7 | Donations link to a donor by donor email; aid links to a student by Student ID. |
| XL-8 | Only valid rows are committed, in a single transaction. The result screen shows created / updated / skipped counts. |
| XL-9 | Every import is recorded in an **import history** (file name, type, who, when, counts). |

Template columns:

- **Students:** Student ID*, Full Name*, Email, Phone, Gender, Date of Birth, Guardian Name, Guardian Phone, Address, Village, School / College, Class / Year, Programme, Joined On, Status
- **Donors:** Full Name*, Email*, Phone, PAN, Address, City, Donor Type (Individual / Organisation / Trustee)
- **Donations:** Donor Email*, Amount*, Date*, Mode, Purpose, Reference No, Notes
- **Aid:** Student ID*, Amount*, Date*, Type (Scholarship / Fees / Books / Uniform / Other), Notes

(* = required)

## 5. Data model

```
users          id, role, email, student_code, password_hash, name, phone, is_active,
               must_change_password, created_at, last_login_at
students       id, user_id→users, student_code, gender, dob, guardian_name, guardian_phone,
               address, village, school, class_year, programme, joined_on, status
donors         id, user_id→users, pan, address, city, donor_type
donations      id, donor_id→donors, amount, donated_on, mode, purpose, reference_no,
               receipt_no, notes, created_by→users, created_at
aid            id, student_id→students, amount, given_on, type, notes, created_by, created_at
certificates   id, student_id→students, title, category, issued_on, file_path, file_name,
               mime_type, size, status, remarks, reviewed_by→users, reviewed_at, created_at
announcements  id, title, body, audience, pinned, created_by, created_at
imports        id, type, file_name, created, updated, skipped, created_by, created_at
audit_log      id, user_id, action, entity, entity_id, details, created_at
settings       key, value
```

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Role checks on every API endpoint (not just in the UI). Uploaded files served only to their owner or to admins. File type and size validated on the server. Parameterised SQL only. |
| Privacy | Students never see other students' data; donors never see other donors' data. |
| Performance | Lists paginate; pages load in under 2 s on a 4G connection. |
| Usability | Mobile-responsive; works on Chrome, Edge, Safari, Firefox (last 2 versions). Indian number formatting (₹1,00,000). |
| Branding | Matches the public site: deep green (#1F4D2B) and warm yellow (#F5C542), the BANA hands logo, friendly rounded type. |
| Reliability | Single SQLite database file, easy to back up by copying one file. |
| Deployment | One Node.js process serves the API and the web app. |

### 6.1 Backend security and verification (implemented)

| ID | Requirement |
|---|---|
| SEC-1 | **Password policy:** 8–128 characters, at least one letter and one number. Common passwords and passwords containing the user's name, email or Student ID are rejected. Passwords are hashed with bcrypt (cost 12). |
| SEC-2 | **Account lockout:** 5 wrong passwords lock the account for 15 minutes. An admin password reset, or a Super Admin unlock, clears the lock. Sign-in is also limited to 10 failed attempts per IP address per 15 minutes. |
| SEC-3 | **Session revocation:** changing or resetting a password, deactivating an account, changing a role, or using "Sign out everywhere" ends that user's sessions on every device immediately. |
| SEC-4 | **Forced password change:** accounts with a temporary password can only change it; every other API call returns 403 until they do. |
| SEC-5 | **Signed tokens:** HS256 only, with issuer and audience checks. The secret is at least 32 characters. Unsigned (`alg: none`) and forged tokens are rejected. |
| SEC-6 | **Upload verification:** an uploaded file's type is read from its first bytes (PDF, PNG or JPEG signature), never from the browser's claim. Disguised files are rejected, file names are cleaned (no paths or control characters), files are stored under random names, and the server limits each student to 100 certificates. |
| SEC-7 | **Input validation on every field:** required fields, maximum lengths, Indian phone numbers (normalised to 10 digits), PAN format, email format, real calendar dates (31/02 is rejected), no future dates, date order (a student can't join before they were born), amounts above 0 and up to ₹10 crore, and allowed values for every dropdown. Objects or arrays sent where text is expected are rejected. |
| SEC-8 | **Duplicate protection:** Student IDs, emails and PANs must be unique. The same UPI, bank or cheque reference can't be recorded twice, including twice within one Excel file. UPI, bank transfer and cheque donations need a reference number. |
| SEC-9 | **Request hardening:** IDs in URLs must be numbers and list filters are checked; all SQL uses parameters. JSON bodies are limited to 200 KB (15 MB for import commits). Only JSON or multipart bodies are accepted. There is a general limit of 600 API requests per minute per IP. |
| SEC-10 | **HTTP headers:** a Content Security Policy (in production), X-Frame-Options DENY, nosniff, Referrer-Policy and Permissions-Policy. API responses are marked no-store. Certificate files are served sandboxed. |
| SEC-11 | **Audit:** every sign-in, failed sign-in, lockout, change, import, export, backup and delete is recorded with who did it, when, their IP address and the request ID. |
| SEC-12 | **Operations:** a `/api/health` check; versioned database migrations; a one-click database backup for the Super Admin; one JSON log line per request; error responses include a request ID and never leak internal details. |
| SEC-13 | **Automated tests:** `npm test` runs 52 backend tests against a throwaway database. |

## 7. Tech stack

- **Backend:** Node.js 22+, Express, built-in `node:sqlite`, bcryptjs, JSON Web Tokens, multer (uploads), ExcelJS (import/export).
- **Frontend:** React 18 + Vite, React Router, hand-built components and SVG charts (no UI framework).
- **Storage:** `data/bana.db` (SQLite) and `data/uploads/` (certificate files).

## 8. Milestones

| Phase | Scope |
|---|---|
| **1 — MVP (this build)** | Everything in §4 |
| 2 | Online donations (Razorpay/UPI), email/SMS notifications, password reset by email |
| 3 | Attendance and marks tracking, volunteer module, programme/village project tracking, public impact page fed from the portal |

## 9. Success metrics

- 100% of active students have a portal login within 1 month of launch.
- All existing Excel records imported in the first week.
- Certificate review turnaround under 3 working days.
- Donors can find any past receipt without contacting the office.

## 10. Acceptance criteria (MVP)

1. A student can sign in, upload a certificate, and see it as **Pending**; an admin verifies it and the student sees **Verified** with remarks.
2. A donor can sign in and see the exact total of all donations recorded against them, filter by year, and print a receipt.
3. An admin imports a donors sheet and a donations sheet; invalid rows are reported and skipped; totals on the donor dashboard update immediately.
4. An admin cannot open user management, settings, or the audit log; the Super Admin can.
5. Every list exports to `.xlsx`.
6. Calling an admin API with a student token returns **403**.
