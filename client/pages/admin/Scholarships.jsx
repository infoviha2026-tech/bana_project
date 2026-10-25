import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, openFile, qs } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import ResourcePage from '../../components/Resource.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, Select, useDebounced, useFetch, useUI } from '../../components/ui.jsx';
import { date, inr } from '../../format.js';
import { useMeta } from './common.jsx';

const TONE = { Submitted: 'blue', 'Under review': 'amber', Approved: 'green', Rejected: 'red', Open: 'green', Closed: '' };

function ReviewApplication({ app, onClose, onDone }) {
  const { toast } = useUI();
  const [remarks, setRemarks] = useState(app.remarks || '');
  const [amount, setAmount] = useState(app.amount_requested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const final = ['Approved', 'Rejected'].includes(app.status);
  const act = async (status) => {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/admin/scholarship-applications/${app.id}`, { status, remarks, amount_approved: amount });
      toast(status === 'Approved' ? 'Approved — an aid record was created and the student was notified' : status === 'Rejected' ? 'Application rejected' : 'Marked as under review');
      onDone();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal wide title={`${app.student_name} — ${app.call_title}`} onClose={onClose}
      footer={!final && <>
        {app.status === 'Submitted' && <button className="btn" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => act('Under review')}>Mark under review</button>}
        <button className="btn btn-danger" disabled={busy} onClick={() => act('Rejected')}><Icon name="x" size={16} />Reject</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => act('Approved')}><Icon name="check" size={16} />Approve {inr(amount)}</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error"><Icon name="alert" />{error}</div>}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="small muted"><Link to={`/students/${app.student_id}`}>{app.student_code}</Link> · {app.class_year} · {app.school} · applied {date(app.created_at)}</div>
          <Badge tone={TONE[app.status]}>{app.status}</Badge>
        </div>
        <div><div className="small muted">Requested</div><strong style={{ fontSize: 20 }}>{inr(app.amount_requested)}</strong> <span className="small muted">(maximum {inr(app.max_amount)})</span></div>
        <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}><p style={{ whiteSpace: 'pre-wrap' }}>{app.reason}</p></div>
        {app.certificates.length > 0 && (
          <div className="row wrap">
            {app.certificates.map((c) => (
              <button key={c.id} className="btn btn-sm" onClick={() => openFile(`/certificates/${c.id}/file`).catch((e) => toast(e.message, 'error'))}>
                <Icon name="file" size={14} />{c.title} <Badge tone={TONE[c.status] || (c.status === 'Verified' ? 'green' : 'amber')}>{c.status}</Badge>
              </button>
            ))}
          </div>
        )}
        {final ? (
          <div className={`alert ${app.status === 'Approved' ? 'success' : 'error'}`}><Icon name="info" />{app.status} {app.amount_approved ? inr(app.amount_approved) : ''} by {app.reviewer} on {date(app.reviewed_at)}{app.remarks ? ` — ${app.remarks}` : ''}</div>
        ) : (
          <div className="form-grid">
            <Field label="Amount to approve (₹)"><input className="input" type="number" min="1" max={app.max_amount} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Remarks for the student" hint="Required when rejecting" full><textarea className="input" rows={2} style={{ minHeight: 64 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Applications() {
  const meta = useMeta();
  const calls = useFetch('/admin/scholarship-calls?pageSize=200').data;
  const [status, setStatus] = useState('');
  const [callId, setCallId] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useFetch(`/admin/scholarship-applications${qs({ status, call_id: callId, q: dq })}`);
  const [open, setOpen] = useState(null);
  return (
    <div className="card">
      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder="Search student…" />
        <Select value={callId} onChange={(e) => setCallId(e.target.value)} placeholder="All scholarships" options={(calls?.rows || []).map((c) => ({ value: c.id, label: c.title }))} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={meta?.applicationStatuses || []} />
      </div>
      {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.length ? <Empty icon="sparkle" title="No applications" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Student</th><th>Scholarship</th><th>Applied</th><th className="num">Requested</th><th className="num">Approved</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setOpen(a)}>
                  <td><strong>{a.student_name}</strong><div className="cell-sub">{a.student_code} · {a.class_year}</div></td>
                  <td>{a.call_title}</td>
                  <td className="nowrap">{date(a.created_at)}</td>
                  <td className="num">{inr(a.amount_requested)}</td>
                  <td className="num">{a.amount_approved ? inr(a.amount_approved) : '—'}</td>
                  <td><Badge tone={TONE[a.status]}>{a.status}</Badge></td>
                  <td className="right"><button className={`btn btn-sm ${['Submitted', 'Under review'].includes(a.status) ? 'btn-primary' : ''}`}>{['Submitted', 'Under review'].includes(a.status) ? 'Review' : 'View'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <ReviewApplication app={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

export default function Scholarships() {
  const meta = useMeta();
  const [tab, setTab] = useState('apps');
  return (
    <>
      <PageHead title="Scholarships" subtitle="Open a scholarship, students apply online with their certificates, and approval creates the aid record automatically." />
      <div className="tabs" style={{ marginBottom: 16, padding: 0 }}>
        <button className={`tab ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')}>Applications</button>
        <button className={`tab ${tab === 'calls' ? 'active' : ''}`} onClick={() => setTab('calls')}>Scholarships</button>
      </div>
      {tab === 'apps' ? <Applications /> : (
        <ResourcePage noHead endpoint="/admin/scholarship-calls" itemLabel="scholarship" newLabel="New scholarship"
          filters={[{ key: 'status', placeholder: 'Open and closed', options: ['Open', 'Closed'] }]}
          columns={[
            { key: 'title', label: 'Scholarship', render: (r) => <><strong>{r.title}</strong><div className="cell-sub">{r.programme ? `Only ${r.programme}` : 'All students'}{r.academic_year ? ` · ${r.academic_year}` : ''}</div></> },
            { key: 'deadline', label: 'Deadline', render: (r) => date(r.deadline) },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> },
            { key: 'applications', label: 'Applications', num: true, render: (r) => <>{r.applications}{r.pending > 0 && <> <Badge tone="amber">{r.pending} to review</Badge></>}</> },
            { key: 'max_amount', label: 'Max per student', money: true },
            { key: 'approved_total', label: 'Approved total', money: true },
          ]}
          fields={[
            { name: 'title', label: 'Title', required: true, full: true, max: 150 },
            { name: 'max_amount', label: 'Maximum per student (₹)', type: 'amount', required: true },
            { name: 'deadline', label: 'Last date to apply', type: 'date', required: true },
            { name: 'academic_year', label: 'Academic year', hint: 'e.g. 2026-27' },
            { name: 'programme', label: 'Only for programme', type: 'select', options: meta?.programmes || [], hint: 'Leave empty for all students' },
            { name: 'status', label: 'Status', type: 'select', options: ['Open', 'Closed'], required: true },
            { name: 'description', label: 'Who can apply and what to attach', type: 'textarea', max: 3000 },
          ]} />
      )}
    </>
  );
}
