import { useEffect, useState } from 'react';
import { api, getToken, openFile } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager, SearchBox, Select, useUI } from '../../components/ui.jsx';
import { bytes, date, dateTime, timeAgo } from '../../format.js';
import { ExportButton, useList, useMeta } from './common.jsx';

function Preview({ cert }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let href;
    fetch(`/api/certificates/${cert.id}/file`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('Could not load file'))))
      .then((b) => { href = URL.createObjectURL(b); setUrl(href); })
      .catch((e) => setErr(e.message));
    return () => href && URL.revokeObjectURL(href);
  }, [cert.id]);
  if (err) return <div className="alert error"><Icon name="alert" />{err}</div>;
  if (!url) return <Loading />;
  const style = { width: '100%', height: 380, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' };
  return cert.mime_type === 'application/pdf'
    ? <iframe title={cert.title} src={url} style={style} />
    : <img src={url} alt={cert.title} style={{ ...style, height: 'auto', maxHeight: 420, objectFit: 'contain' }} />;
}

export function ReviewModal({ cert, onClose, onDone }) {
  const { toast } = useUI();
  const [remarks, setRemarks] = useState(cert.remarks || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (status) => {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/admin/certificates/${cert.id}/review`, { status, remarks });
      toast(status === 'Verified' ? 'Certificate verified' : status === 'Rejected' ? 'Certificate rejected — the student will see your remarks' : 'Moved back to pending');
      onDone();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal wide title="Review certificate" onClose={onClose}
      footer={<>
        {cert.status !== 'Pending' && <button className="btn" disabled={busy} onClick={() => act('Pending')} style={{ marginRight: 'auto' }}>Mark as pending</button>}
        <button className="btn btn-danger" disabled={busy} onClick={() => act('Rejected')}><Icon name="x" size={16} />Reject</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => act('Verified')}><Icon name="check" size={16} />Verify</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error"><Icon name="alert" />{error}</div>}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>{cert.title}</h3>
            <div className="small muted">{cert.student_name} ({cert.student_code}) · {cert.category}{cert.issued_on ? ` · issued ${date(cert.issued_on)}` : ''} · {bytes(cert.size)}</div>
          </div>
          <Badge>{cert.status}</Badge>
        </div>
        <Preview cert={cert} />
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => openFile(`/certificates/${cert.id}/file`).catch((e) => toast(e.message, 'error'))}>
          <Icon name="eye" size={14} />Open in new tab
        </button>
        <Field label="Remarks for the student" hint="Required when rejecting — explain what needs to be fixed">
          <textarea className="input" rows={2} style={{ minHeight: 64 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Verified against original" />
        </Field>
      </div>
    </Modal>
  );
}

const STATUS_TABS = ['Pending', 'Verified', 'Rejected', ''];

export default function CertificateReview() {
  const meta = useMeta();
  const list = useList('/admin/certificates', { status: 'Pending', category: '' });
  const { data, loading, error, reload, filters, setFilter } = list;
  const [review, setReview] = useState(null);

  return (
    <>
      <PageHead title="Certificates" subtitle="Review certificates uploaded by students. Verify them, or reject with a reason so the student can re-upload."
        actions={<ExportButton type="certificates" query={list.exportQuery} />} />
      <div className="card">
        <div className="tabs">
          {STATUS_TABS.map((s) => (
            <button key={s || 'all'} className={`tab ${filters.status === s ? 'active' : ''}`} onClick={() => setFilter('status', s)}>{s || 'All'}</button>
          ))}
        </div>
        <div className="filters">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search title, student, ID…" />
          <Select value={filters.category} onChange={(e) => setFilter('category', e.target.value)} placeholder="All categories" options={meta?.certCategories || []} />
        </div>
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.rows.length ? (
          <Empty icon="checkCircle" title={filters.status === 'Pending' ? 'Nothing waiting for review' : 'No certificates found'} text={filters.status === 'Pending' ? 'New uploads from students will appear here.' : null} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Certificate</th><th>Student</th><th>Category</th><th>Uploaded</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="person">
                        <div className={`file-icon ${c.mime_type === 'application/pdf' ? 'pdf' : ''}`} style={{ width: 32, height: 32 }}><Icon name={c.mime_type === 'application/pdf' ? 'file' : 'image'} size={16} /></div>
                        <div><div className="cell-main">{c.title}</div>{c.remarks && <div className="cell-sub">“{c.remarks}”</div>}</div>
                      </div>
                    </td>
                    <td>{c.student_name}<div className="cell-sub">{c.student_code}</div></td>
                    <td>{c.category}</td>
                    <td className="nowrap" title={dateTime(c.created_at)}>{timeAgo(c.created_at)}</td>
                    <td><Badge>{c.status}</Badge>{c.reviewer && <div className="cell-sub">by {c.reviewer}</div>}</td>
                    <td className="right"><button className={`btn btn-sm ${c.status === 'Pending' ? 'btn-primary' : ''}`} onClick={() => setReview(c)}>{c.status === 'Pending' ? 'Review' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={list.setPage} />}
      </div>
      {review && <ReviewModal cert={review} onClose={() => setReview(null)} onDone={() => { setReview(null); reload(); }} />}
    </>
  );
}
