import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, openFile } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useFetch, useUI } from '../../components/ui.jsx';
import { bytes, date, timeAgo } from '../../format.js';
import { useT } from '../../i18n.jsx';

export const CATEGORIES = ['Academic', 'Marksheet', 'Sports', 'Cultural', 'Skill/Training', 'Identity', 'Other'];
const MAX = 5 * 1024 * 1024;
const STATUS_TONE = { Verified: 'green', Pending: 'amber', Rejected: 'red', Missing: '' };

export function Dropzone({ file, onFile, accept, hint, camera }) {
  const t = useT();
  const input = useRef();
  const cam = useRef();
  const [over, setOver] = useState(false);
  return (
    <>
      <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]); }}
        role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current.click()}>
        <input ref={input} type="file" accept={accept} hidden onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
        <div className="dz-icon"><Icon name={file ? 'file' : 'upload'} size={22} /></div>
        {file ? <><strong>{file.name}</strong><div className="small muted">{bytes(file.size)} · {t('click to change')}</div></>
          : <><div><strong>{t('Click to choose')}</strong> {t('or drag a file here')}</div><div className="small muted" style={{ marginTop: 4 }}>{hint}</div></>}
      </div>
      {camera && (
        <>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
          <button type="button" className="btn" onClick={() => cam.current.click()} style={{ marginTop: 8, width: '100%' }}><Icon name="camera" size={16} />{t('Take a photo with your camera')}</button>
        </>
      )}
    </>
  );
}

function UploadModal({ onClose, onDone, requirements, preset }) {
  const { toast } = useUI();
  const t = useT();
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const req = requirements?.find((r) => String(r.id) === String(preset));

  const pick = (f) => {
    setError('');
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) return setError(t('Only PDF, JPG and PNG files are allowed'));
    if (f.size > MAX) return setError(t('File is larger than 5 MB. Please compress it or take a smaller photo'));
    setFile(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return setError(t('Please choose a file'));
    const fd = new FormData(e.currentTarget);
    fd.append('file', file);
    setBusy(true);
    try {
      await api.post('/student/certificates', fd);
      toast(t('Certificate uploaded — the team will review it soon'));
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={t('Upload a certificate')} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {error && <div className="alert error"><Icon name="alert" />{error}</div>}
        <Dropzone file={file} onFile={pick} camera accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hint={t('PDF, JPG or PNG · up to 5 MB')} />
        {requirements?.length > 0 && (
          <Field label={t('Is this one of the required documents?')}>
            <Select name="requirement_id" defaultValue={preset || ''} placeholder={t('No — another certificate')} options={requirements.map((r) => ({ value: r.id, label: t(r.name) }))} />
          </Field>
        )}
        <Field label={t('Certificate title')} required><input className="input" name="title" required maxLength={150} defaultValue={req ? t(req.name) : ''} placeholder={t('e.g. Class 10 Marksheet')} /></Field>
        <div className="form-grid">
          <Field label={t('Category')}><Select name="category" options={CATEGORIES.map((c) => ({ value: c, label: t(c) }))} defaultValue={req?.category || 'Academic'} /></Field>
          <Field label={t('Issue date')}><input className="input" type="date" name="issued_on" max={new Date().toISOString().slice(0, 10)} /></Field>
        </div>
        <div className="modal-foot" style={{ margin: '4px -22px -20px' }}>
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? t('Uploading…') : <><Icon name="upload" size={16} />{t('Upload')}</>}</button>
        </div>
      </form>
    </Modal>
  );
}

const TABS = ['All', 'Pending', 'Verified', 'Rejected'];

export default function StudentCertificates() {
  const { toast, confirm } = useUI();
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('All');
  const { data, loading, error, reload } = useFetch('/student/certificates');
  const checklist = useFetch('/student/checklist');
  const uploading = params.get('upload') === '1';
  const setUploading = (v, req) => setParams(v ? { upload: '1', ...(req ? { req } : {}) } : {}, { replace: true });

  const remove = async (c) => {
    if (!(await confirm({ title: t('Delete certificate?'), message: t('"{title}" will be removed. You can upload it again later.', { title: c.title }), confirmText: t('Delete'), danger: true }))) return;
    try {
      await api.del(`/student/certificates/${c.id}`);
      toast(t('Certificate deleted'));
      reload();
      checklist.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const view = (c) => openFile(`/certificates/${c.id}/file`).catch((e) => toast(e.message, 'error'));
  const rows = data?.filter((c) => tab === 'All' || c.status === tab) || [];
  const cl = checklist.data;

  return (
    <>
      <PageHead title={t('My Certificates')} subtitle={t('Upload your marksheets, awards, and other certificates. The trust team will verify each one.')}
        actions={<button className="btn btn-primary" onClick={() => setUploading(true)}><Icon name="upload" size={16} />{t('Upload certificate')}</button>} />

      {cl?.total > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2>{t('Required documents')}</h2>
            <span className="small muted">{t('{done} of {total} verified', { done: cl.done, total: cl.total })}</span>
          </div>
          <div className="card-body" style={{ paddingTop: 12 }}>
            <div className="progress" style={{ marginBottom: 14 }}><div style={{ width: `${(cl.done / cl.total) * 100}%` }} /></div>
            <div className="grid grid-2" style={{ gap: 8 }}>
              {cl.items.map((it) => (
                <div key={it.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 9 }}>
                  <div className="row" style={{ gap: 10, minWidth: 0 }}>
                    <Icon name={it.status === 'Verified' ? 'checkCircle' : it.status === 'Missing' ? 'file' : it.status === 'Rejected' ? 'xCircle' : 'clock'} size={18}
                      style={{ color: { Verified: 'var(--green-700)', Pending: 'var(--amber)', Rejected: 'var(--red)', Missing: 'var(--faint)' }[it.status], flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{t(it.name)}</div>{it.description && <div className="cell-sub">{t(it.description)}</div>}</div>
                  </div>
                  {it.status === 'Missing' || it.status === 'Rejected'
                    ? <button className="btn btn-sm" onClick={() => setUploading(true, it.id)}>{t('Upload')}</button>
                    : <Badge tone={STATUS_TONE[it.status]}>{t(it.status)}</Badge>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="tabs">
          {TABS.map((x) => (
            <button key={x} className={`tab ${tab === x ? 'active' : ''}`} onClick={() => setTab(x)}>
              {t(x)}<span className="count">{data ? (x === 'All' ? data.length : data.filter((c) => c.status === x).length) : 0}</span>
            </button>
          ))}
        </div>
        {loading ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !rows.length ? (
          <Empty icon="award" title={t('No certificates yet')}
            text={tab === 'All' ? t('Upload your first certificate to get started.') : null}
            action={tab === 'All' && <button className="btn btn-primary" onClick={() => setUploading(true)}>{t('Upload certificate')}</button>} />
        ) : rows.map((c) => (
          <div className="list-item" key={c.id} style={{ alignItems: 'flex-start' }}>
            <div className={`file-icon ${c.mime_type === 'application/pdf' ? 'pdf' : ''}`}><Icon name={c.mime_type === 'application/pdf' ? 'file' : 'image'} /></div>
            <div className="grow">
              <div className="row wrap" style={{ gap: 8 }}><span className="title">{c.title}</span><Badge tone={STATUS_TONE[c.status]}>{t(c.status)}</Badge>{c.requirement_name && <Badge plain>{t(c.requirement_name)}</Badge>}</div>
              <div className="cell-sub">{t(c.category)}{c.issued_on ? ` · ${date(c.issued_on)}` : ''} · {timeAgo(c.created_at)} · {bytes(c.size)}</div>
              {c.remarks && (
                <div className={`alert ${c.status === 'Rejected' ? 'error' : 'success'}`} style={{ marginTop: 8, padding: '8px 10px' }}>
                  <Icon name={c.status === 'Rejected' ? 'alert' : 'checkCircle'} size={16} /><span><strong>{t('Reviewer')}:</strong> {c.remarks}</span>
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 2 }}>
              <button className="icon-btn" onClick={() => view(c)} aria-label={t('View')} title={t('View')}><Icon name="eye" size={17} /></button>
              {c.status === 'Pending' && <button className="icon-btn danger" onClick={() => remove(c)} aria-label={t('Delete')} title={t('Delete')}><Icon name="trash" size={17} /></button>}
            </div>
          </div>
        ))}
      </div>
      {uploading && <UploadModal requirements={cl?.items} preset={params.get('req')} onClose={() => setUploading(false)}
        onDone={() => { setUploading(false); reload(); checklist.reload(); }} />}
    </>
  );
}
