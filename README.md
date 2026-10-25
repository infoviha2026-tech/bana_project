# BANA Connect

Internal portal for **BANA Development Foundation**, with separate access for students, donors, staff, and the Super Admin. The full requirements are in [docs/PRD.md](docs/PRD.md).

## Quick start

Requires **Node.js 22.13 or later** (uses the built-in `node:sqlite`).

```bash
npm install
npm run seed      # optional: load demo students, donors, and donations
npm run dev       # http://localhost:5173 (hot reload)
```

For production:

```bash
npm run build
npm start         # serves the API and the built app on PORT (default 5173)
```

On first start, if no Super Admin exists, one is created: `superadmin@bana.org` / `Admin@123`. You can override this with the `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` environment variables. Change the password after the first sign-in.

### Demo accounts (after `npm run seed`)

| Role | Sign in with | Password |
|---|---|---|
| Super Admin | superadmin@bana.org | Admin@123 |
| Admin (staff) | staff@bana.org | Staff@123 |
| Student | BANA-001 (Student ID) | Student@123 |
| Donor | ravi.reddy@example.com | Donor@123 |

## What each role can do

- **Student:** dashboard, upload certificates (PDF/JPG/PNG, 5 MB), see verification status and remarks, see scholarships and aid received, edit contact details, read announcements.
- **Donor:** dashboard with lifetime and this-financial-year totals, giving chart, impact numbers, full donation history filtered by FY, printable receipts with an 80G note.
- **Admin:** manage students, donors, donations, aid, and announcements. Review certificates. Import from Excel and export any list to Excel.
- **Super Admin:** everything Admins can do, plus users and roles, trust settings (shown on receipts), the audit log, and permanent deletes.

## Excel import

Go to **Import from Excel**, choose a type (Students, Donors, Donations, Aid), and download its template. Then upload a `.xlsx` or `.csv` file.

- Every row is validated in a dry run first. You see which rows are new, which will update an existing record, and which have errors (with the reason).
- Only valid rows are saved, all in one transaction.
- Students are matched by Student ID and donors by email. Matching records are updated; new ones get a login with the default password from Settings.
- Header names are matched loosely (`Full Name`, `full_name`, and `FULLNAME` all work). Dates can be `2026-04-10` or `10/04/2026`. Amounts can include `₹` and commas.

## Project layout

```
server/            Express API
  db.js            SQLite schema, settings, audit log, receipt numbering
  auth.js          JWT auth and role guards
  services.js      validation and create/update logic shared by the API and the importer
  excel.js         Excel/CSV parsing, dry-run import, templates, exports
  routes/          auth, self (student/donor), admin, super
  seed.js          first Super Admin and demo data
client/            React app (Vite)
  pages/student, pages/donor, pages/admin
docs/PRD.md        product requirements
data/              created at runtime: bana.db and uploads/  (back up this folder)
```

## Backend security

The backend checks every request on the server, whatever the browser sends. The full list is in [PRD §6.1](docs/PRD.md); the highlights are:

- **Passwords and accounts:** password policy, account lockout after 5 failed sign-ins, and sessions ended on every device when a password, role or account status changes.
- **Uploads and input:** uploaded files are checked by their actual bytes, every field is validated, and the same donation reference can't be recorded twice.
- **Requests:** rate limits and security headers on every request, and every action is audited with the IP address and request ID.
- **Operations:** health check at `GET /api/health` and a database backup download in **Settings**.

### Tests

```bash
npm test          # 52 backend tests on a throwaway database
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 5173 | HTTP port |
| `DATA_DIR` | `./data` | Database and uploaded files |
| `JWT_SECRET` | auto-generated in `data/.jwt-secret` | Token signing key |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | see above | First Super Admin account |
| `TRUST_PROXY` | unset | Set (e.g. `1`) when behind a reverse proxy so client IPs are logged and rate-limited correctly |
| `API_RATE_LIMIT` | 3000 | API requests per minute per IP |
| `LOGIN_RATE_LIMIT` | 10 | Failed sign-ins per 15 minutes per IP |
