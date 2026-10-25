import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Badge, ErrorBox, Field, Loading, PageHead, formObj, useFetch, useUI } from '../../components/ui.jsx';
import { bytes, dateTime } from '../../format.js';

function Backups() {
  const { toast } = useUI();
  const { data, reload } = useFetch('/super/backups');
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Backups</h2>
        <div className="row">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await api.post('/super/backups'); toast('Backup created'); reload(); } catch (e) { toast(e.message, 'error'); }
            setBusy(false);
          }}><Icon name="database" size={14} />{busy ? 'Backing up…' : 'Back up now'}</button>
        </div>
      </div>
      <div className="card-body" style={{ paddingBottom: 8 }}>
        <p className="small muted">The database is backed up automatically every night (after 2 am) into <code>data/backups</code>, and new certificate, photo, and story files are copied to <code>data/backups/uploads</code>. Copy that folder to another drive or cloud storage regularly.</p>
      </div>
      {!data ? <Loading /> : !data.length ? <p className="card-body muted">No backups yet.</p> : (
        <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>When</th><th>Type</th><th className="num">Size</th><th /></tr></thead>
            <tbody>{data.map((b) => (
              <tr key={b.id}>
                <td className="small">{dateTime(b.created_at)}</td>
                <td><Badge tone={b.kind === 'auto' ? 'blue' : 'green'} plain>{b.kind === 'auto' ? 'Automatic' : 'Manual'}</Badge></td>
                <td className="num">{bytes(b.bytes)}</td>
                <td className="right"><button type="button" className="btn btn-sm" onClick={() => download(`/super/backups/${b.id}/download`).catch((e) => toast(e.message, 'error'))}><Icon name="download" size={14} />Download</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { toast } = useUI();
  const { data, loading, error, reload } = useFetch('/super/settings');
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = formObj(new FormData(e.currentTarget));
      body.public_impact = e.currentTarget.public_impact.checked;
      await api.put('/super/settings', body);
      toast('Settings saved');
      reload();
    } catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  };

  return (
    <>
      <PageHead title="Settings" subtitle="Trust details for receipts, bank details for donors, alert levels, and backups." />
      <div className="stack" style={{ maxWidth: 860 }}>
        <form onSubmit={save} className="stack">
          <div className="card">
            <div className="card-head"><h2>Trust details</h2><span className="small muted">Shown on receipts, statements, and ID cards</span></div>
            <div className="card-body form-grid">
              <Field label="Trust name" required full><input className="input" name="trust_name" defaultValue={data.trust_name} required /></Field>
              <Field label="Address" full><textarea className="input" name="trust_address" defaultValue={data.trust_address} rows={2} style={{ minHeight: 64 }} /></Field>
              <Field label="Registration number"><input className="input" name="registration_no" defaultValue={data.registration_no} /></Field>
              <Field label="80G registration number" hint="If set, receipts include the 80G tax-exemption note"><input className="input" name="pan_80g_no" defaultValue={data.pan_80g_no} /></Field>
              <Field label="Contact email"><input className="input" type="email" name="contact_email" defaultValue={data.contact_email} /></Field>
              <Field label="Contact phone"><input className="input" name="contact_phone" defaultValue={data.contact_phone} /></Field>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Bank details for donors</h2><span className="small muted">Shown on the Donate page when online payment is off</span></div>
            <div className="card-body form-grid">
              <Field label="Bank name"><input className="input" name="bank_name" defaultValue={data.bank_name} /></Field>
              <Field label="Account number"><input className="input" name="bank_account" defaultValue={data.bank_account} inputMode="numeric" /></Field>
              <Field label="IFSC"><input className="input" name="bank_ifsc" defaultValue={data.bank_ifsc} style={{ textTransform: 'uppercase' }} /></Field>
              <Field label="UPI ID"><input className="input" name="upi_id" defaultValue={data.upi_id} placeholder="bana@sbi" /></Field>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Students & accounts</h2></div>
            <div className="card-body form-grid">
              <Field label="Alert when marks are below (%)" hint="Shown under Marks & Attendance → Needs attention"><input className="input" type="number" min="0" max="100" name="marks_threshold" defaultValue={data.marks_threshold} /></Field>
              <Field label="Alert when attendance is below (%)"><input className="input" type="number" min="0" max="100" name="attendance_threshold" defaultValue={data.attendance_threshold} /></Field>
              <Field label="Default password for new accounts" required hint="At least 8 characters with a letter and a number. Users must change it on first sign-in.">
                <input className="input" name="default_password" defaultValue={data.default_password} required minLength={8} />
              </Field>
              <Field label="Backups to keep" hint="Older automatic and manual backups are deleted"><input className="input" type="number" min="3" max="365" name="backup_retention" defaultValue={data.backup_retention} /></Field>
              <div className="full">
                <label className="checkbox"><input type="checkbox" name="public_impact" defaultChecked={data.public_impact === '1'} />Show the public impact page (totals, projects, and published stories — no personal data)</label>
                <p className="small muted" style={{ marginTop: 6 }}>
                  Page: <Link to="/impact" target="_blank">/impact</Link> · Embed on the foundation website: <code>{`<iframe src="${location.origin}/impact?embed=1" width="100%" height="900" style="border:0"></iframe>`}</code> · JSON for developers: <code>/api/public/impact</code>
                </p>
              </div>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
          </div>
        </form>
        <Backups />
        <div className="card card-pad row wrap" style={{ justifyContent: 'space-between' }}>
          <div><h3>Email, SMS & online payments</h3><p className="small muted">See which services are connected and every message the portal has sent.</p></div>
          <Link to="/messages" className="btn">Open Email & SMS</Link>
        </div>
      </div>
    </>
  );
}
