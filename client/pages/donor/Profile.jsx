import { useState } from 'react';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Avatar, Badge, ErrorBox, Field, Loading, PageHead, formObj, useFetch, useUI } from '../../components/ui.jsx';

export default function DonorProfile() {
  const { toast } = useUI();
  const { data: d, loading, error, reload } = useFetch('/donor/profile');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/donor/profile', formObj(new FormData(e.currentTarget)));
      toast('Profile updated');
      setEditing(false);
      reload();
    } catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  };

  return (
    <>
      <PageHead title="My Profile" actions={!editing && <button className="btn btn-primary" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Edit details</button>} />
      <div className="card card-pad" style={{ maxWidth: 760 }}>
        <div className="row" style={{ gap: 16, marginBottom: 20 }}>
          <Avatar name={d.name} size="lg" />
          <div><h2 style={{ fontSize: 20 }}>{d.name}</h2><Badge tone="green" plain>{d.donor_type}</Badge></div>
        </div>
        {editing ? (
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Phone"><input className="input" name="phone" defaultValue={d.phone || ''} inputMode="tel" /></Field>
              <Field label="City"><input className="input" name="city" defaultValue={d.city || ''} /></Field>
              <Field label="Address" full><textarea className="input" name="address" defaultValue={d.address || ''} rows={2} style={{ minHeight: 70 }} /></Field>
            </div>
            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        ) : (
          <dl className="dl">
            <dt>Email</dt><dd>{d.email}</dd>
            <dt>Phone</dt><dd>{d.phone || '—'}</dd>
            <dt>PAN</dt><dd>{d.pan || '—'}</dd>
            <dt>Address</dt><dd>{[d.address, d.city].filter(Boolean).join(', ') || '—'}</dd>
          </dl>
        )}
        <div className="alert info small mt"><Icon name="info" size={16} />Your PAN and email appear on tax receipts. To change them, please contact the trust office.</div>
      </div>
    </>
  );
}
