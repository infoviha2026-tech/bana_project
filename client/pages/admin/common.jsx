import { useEffect, useState } from 'react';
import { api, download, qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import Icon from '../../components/Icons.jsx';
import { Field, FormModal, Modal, Select, formObj, useDebounced, useFetch, useUI } from '../../components/ui.jsx';
import { inr, today } from '../../format.js';

/** Paginated + filtered list. Returns data, filters, setFilter, page controls, and the query string for exports. */
export function useList(base, initial = {}) {
  const [filters, setFilters] = useState({ q: '', ...initial });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  const query = { ...filters, q };
  const fetched = useFetch(`${base}${qs({ ...query, page, pageSize: 25 })}`);
  useEffect(() => setPage(1), [JSON.stringify(query)]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  return { ...fetched, filters, setFilter, setFilters, page, setPage, exportQuery: qs(query) };
}

export function ExportButton({ type, query = '' }) {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await download(`/admin/export/${type}${query}`); } catch (e) { toast(e.message, 'error'); }
      setBusy(false);
    }}>
      <Icon name="download" size={16} />{busy ? 'Exporting…' : 'Export to Excel'}
    </button>
  );
}

export const useMeta = () => useFetch('/admin/meta').data;

/* ---------------- Forms ---------------- */

export function StudentForm({ student, onClose, onSaved }) {
  const meta = useMeta();
  const s = student || {};
  const { toast } = useUI();
  return (
    <FormModal wide title={s.id ? `Edit ${s.name}` : 'Add student'} submitText={s.id ? 'Save changes' : 'Add student'} onClose={onClose}
      onSubmit={async (fd) => {
        const body = formObj(fd);
        const out = s.id ? await api.put(`/admin/students/${s.id}`, body) : await api.post('/admin/students', body);
        toast(s.id ? 'Student updated' : `Student added. They can sign in with ${body.student_code.toUpperCase()} and the default password.`);
        onSaved(out);
      }}>
      <div className="form-grid">
        <div className="form-section">Basic details</div>
        <Field label="Student ID" required hint="Used to sign in"><input className="input" name="student_code" defaultValue={s.student_code} required placeholder="BANA-017" /></Field>
        <Field label="Full name" required><input className="input" name="name" defaultValue={s.name} required /></Field>
        <Field label="Email"><input className="input" type="email" name="email" defaultValue={s.email || ''} /></Field>
        <Field label="Phone"><input className="input" name="phone" defaultValue={s.phone || ''} inputMode="tel" /></Field>
        <Field label="Gender"><Select name="gender" defaultValue={s.gender || ''} placeholder="—" options={['Female', 'Male', 'Other']} /></Field>
        <Field label="Date of birth"><input className="input" type="date" name="dob" defaultValue={s.dob || ''} /></Field>
        <div className="form-section">Family & address</div>
        <Field label="Guardian name"><input className="input" name="guardian_name" defaultValue={s.guardian_name || ''} /></Field>
        <Field label="Guardian phone"><input className="input" name="guardian_phone" defaultValue={s.guardian_phone || ''} inputMode="tel" /></Field>
        <Field label="Village"><input className="input" name="village" defaultValue={s.village || ''} /></Field>
        <Field label="Address"><input className="input" name="address" defaultValue={s.address || ''} /></Field>
        <div className="form-section">Education</div>
        <Field label="School / College"><input className="input" name="school" defaultValue={s.school || ''} /></Field>
        <Field label="Class / Year"><input className="input" name="class_year" defaultValue={s.class_year || ''} /></Field>
        <Field label="Programme">
          <input className="input" name="programme" list="programmes" defaultValue={s.programme || ''} />
          <datalist id="programmes">{meta?.programmes.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Joined on"><input className="input" type="date" name="joined_on" defaultValue={s.joined_on || ''} /></Field>
        <Field label="Status"><Select name="status" defaultValue={s.status || 'Active'} options={meta?.studentStatuses || ['Active', 'Alumni', 'Inactive']} /></Field>
        {!s.id && <Field label="Initial password" hint="Leave blank to use the default password"><input className="input" name="password" autoComplete="new-password" /></Field>}
      </div>
    </FormModal>
  );
}

export function DonorForm({ donor, onClose, onSaved }) {
  const meta = useMeta();
  const d = donor || {};
  const { toast } = useUI();
  return (
    <FormModal title={d.id ? `Edit ${d.name}` : 'Add donor'} submitText={d.id ? 'Save changes' : 'Add donor'} onClose={onClose}
      onSubmit={async (fd) => {
        const body = formObj(fd);
        const out = d.id ? await api.put(`/admin/donors/${d.id}`, body) : await api.post('/admin/donors', body);
        toast(d.id ? 'Donor updated' : 'Donor added. They can sign in with their email and the default password.');
        onSaved(out);
      }}>
      <div className="form-grid">
        <Field label="Full name / Organisation" required full><input className="input" name="name" defaultValue={d.name} required /></Field>
        <Field label="Email" required hint="Used to sign in"><input className="input" type="email" name="email" defaultValue={d.email || ''} required /></Field>
        <Field label="Phone"><input className="input" name="phone" defaultValue={d.phone || ''} inputMode="tel" /></Field>
        <Field label="PAN" hint="Printed on receipts"><input className="input" name="pan" defaultValue={d.pan || ''} maxLength={10} style={{ textTransform: 'uppercase' }} /></Field>
        <Field label="Donor type"><Select name="donor_type" defaultValue={d.donor_type || 'Individual'} options={meta?.donorTypes || ['Individual', 'Organisation', 'Trustee']} /></Field>
        <Field label="Address"><input className="input" name="address" defaultValue={d.address || ''} /></Field>
        <Field label="City"><input className="input" name="city" defaultValue={d.city || ''} /></Field>
        {!d.id && <Field label="Initial password" hint="Leave blank to use the default" full><input className="input" name="password" autoComplete="new-password" /></Field>}
      </div>
    </FormModal>
  );
}

export function DonationForm({ donation, donorId, onClose, onSaved }) {
  const meta = useMeta();
  const donors = useFetch(donorId ? null : '/admin/donors?pageSize=200').data;
  const d = donation || {};
  const { toast } = useUI();
  return (
    <FormModal title={d.id ? `Edit donation ${d.receipt_no}` : 'Record a donation'} submitText={d.id ? 'Save changes' : 'Record donation'} onClose={onClose}
      onSubmit={async (fd) => {
        const body = formObj(fd);
        if (donorId) body.donor_id = donorId;
        if (d.id) await api.put(`/admin/donations/${d.id}`, body);
        else await api.post('/admin/donations', body);
        toast(d.id ? 'Donation updated' : 'Donation recorded and receipt generated');
        onSaved();
      }}>
      <div className="form-grid">
        {!donorId && (
          <Field label="Donor" required full>
            <Select name="donor_id" defaultValue={d.donor_id || ''} required placeholder={donors ? 'Choose a donor…' : 'Loading…'}
              options={(donors?.rows || []).map((x) => ({ value: x.id, label: `${x.name} — ${x.email}` }))} />
          </Field>
        )}
        <Field label="Amount (₹)" required><input className="input" type="number" name="amount" min="1" step="0.01" defaultValue={d.amount || ''} required /></Field>
        <Field label="Date" required><input className="input" type="date" name="donated_on" defaultValue={d.donated_on || today()} max={today()} required /></Field>
        <Field label="Mode"><Select name="mode" defaultValue={d.mode || 'Bank Transfer'} options={meta?.donationModes || ['Bank Transfer']} /></Field>
        <Field label="Purpose / Fund">
          <input className="input" name="purpose" list="purposes" defaultValue={d.purpose || 'General Fund'} />
          <datalist id="purposes">{meta?.purposes.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Reference no." hint="UTR, cheque or transaction number — required for UPI, bank transfer and cheque" full><input className="input" name="reference_no" defaultValue={d.reference_no || ''} /></Field>
        <Field label="Project (optional)">
          <Select name="project_id" defaultValue={d.project_id || ''} placeholder="— None —" options={(meta?.projects || []).map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        {(donorId || d.donor_id) && <PledgeSelect donorId={donorId || d.donor_id} value={d.pledge_id} />}
        <Field label="Notes" full><input className="input" name="notes" defaultValue={d.notes || ''} /></Field>
      </div>
    </FormModal>
  );
}

function PledgeSelect({ donorId, value }) {
  const { data } = useFetch(`/admin/pledges?donor_id=${donorId}&pageSize=50`);
  if (!data?.rows.length) return null;
  return (
    <Field label="Counts towards pledge">
      <Select name="pledge_id" defaultValue={value || ''} placeholder="— None —" options={data.rows.map((p) => ({ value: p.id, label: `${inr(p.amount)} ${p.frequency.toLowerCase()}${p.purpose ? ` — ${p.purpose}` : ''}` }))} />
    </Field>
  );
}

export function AidForm({ aid, studentId, onClose, onSaved }) {
  const meta = useMeta();
  const students = useFetch(studentId ? null : '/admin/students?pageSize=200&status=Active').data;
  const a = aid || {};
  const { toast } = useUI();
  return (
    <FormModal title={a.id ? 'Edit support record' : 'Record support given'} submitText={a.id ? 'Save changes' : 'Save'} onClose={onClose}
      onSubmit={async (fd) => {
        const body = formObj(fd);
        if (studentId) body.student_id = studentId;
        if (a.id) await api.put(`/admin/aid/${a.id}`, body);
        else await api.post('/admin/aid', body);
        toast('Support record saved');
        onSaved();
      }}>
      <div className="form-grid">
        {!studentId && !a.id && (
          <Field label="Student" required full>
            <Select name="student_id" required defaultValue="" placeholder={students ? 'Choose a student…' : 'Loading…'}
              options={(students?.rows || []).map((s) => ({ value: s.id, label: `${s.name} (${s.student_code})` }))} />
          </Field>
        )}
        <Field label="Type"><Select name="type" defaultValue={a.type || 'Scholarship'} options={meta?.aidTypes || ['Scholarship']} /></Field>
        <Field label="Amount (₹)" required><input className="input" type="number" name="amount" min="1" step="0.01" defaultValue={a.amount || ''} required /></Field>
        <Field label="Date" required><input className="input" type="date" name="given_on" defaultValue={a.given_on || today()} required /></Field>
        <Field label="Notes"><input className="input" name="notes" defaultValue={a.notes || ''} placeholder="e.g. Term 1 fees" /></Field>
      </div>
    </FormModal>
  );
}

/** Reset password / activate / deactivate / delete for a user account */
export function AccountActions({ userId, name, active, onChanged, onDelete }) {
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const [reset, setReset] = useState(null);

  const toggle = async () => {
    const ok = await confirm({
      title: active ? `Deactivate ${name}?` : `Reactivate ${name}?`,
      message: active ? 'They will no longer be able to sign in. Their records are kept.' : 'They will be able to sign in again.',
      confirmText: active ? 'Deactivate' : 'Reactivate', danger: active,
    });
    if (!ok) return;
    try {
      await api.patch(`/admin/users/${userId}/active`, { active: !active });
      toast(active ? 'Account deactivated' : 'Account reactivated');
      onChanged();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <button className="btn" onClick={() => setReset('')}><Icon name="key" size={16} />Reset password</button>
      <button className="btn" onClick={toggle}><Icon name="power" size={16} />{active ? 'Deactivate' : 'Reactivate'}</button>
      {user.role === 'super_admin' && onDelete && <button className="btn btn-danger" onClick={onDelete}><Icon name="trash" size={16} />Delete</button>}
      {reset !== null && (
        typeof reset === 'string' && reset.startsWith('done:') ? (
          <Modal title="Password reset" onClose={() => setReset(null)} footer={<button className="btn btn-primary" onClick={() => setReset(null)}>Done</button>}>
            <p>Share this temporary password with <strong>{name}</strong>. They will be asked to change it when they sign in.</p>
            <div className="mono" style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 18, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{reset.slice(5)}</div>
          </Modal>
        ) : (
          <FormModal title={`Reset password for ${name}`} submitText="Reset password" onClose={() => setReset(null)}
            onSubmit={async (fd) => {
              const r = await api.post(`/admin/users/${userId}/reset-password`, { password: fd.get('password') });
              setReset(`done:${r.password}`);
            }}>
            <Field label="New temporary password" hint="Leave blank to use the default password from Settings. Resetting also unlocks the account and signs them out everywhere.">
              <input className="input" name="password" minLength={8} autoComplete="new-password" />
            </Field>
          </FormModal>
        )
      )}
    </>
  );
}
