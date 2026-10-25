import { useState } from 'react';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHead, useFetch, useUI } from '../../components/ui.jsx';
import { date, inr } from '../../format.js';
import { useT } from '../../i18n.jsx';

const TONE = { Submitted: 'blue', 'Under review': 'amber', Approved: 'green', Rejected: 'red' };

function ApplyModal({ call, onClose, onDone }) {
  const t = useT();
  const { toast } = useUI();
  const certs = useFetch('/student/certificates').data;
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api.post(`/student/scholarships/${call.id}/apply`, { amount_requested: fd.get('amount'), reason: fd.get('reason'), certificate_ids: picked });
      toast(t('Application submitted'));
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal wide title={`${t('Apply')}: ${call.title}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {error && <div className="alert error"><Icon name="alert" />{error}</div>}
        <Field label={t('Amount needed (₹)')} required hint={t('Up to {max}', { max: inr(call.max_amount) })}>
          <input className="input" type="number" name="amount" min="1" max={call.max_amount} defaultValue={call.max_amount} required />
        </Field>
        <Field label={t('Why do you need this scholarship?')} required hint={t('Tell us about your studies, your family situation, and how you will use the money.')}>
          <textarea className="input" name="reason" rows={5} required minLength={20} maxLength={2000} />
        </Field>
        <Field label={t('Attach certificates (optional)')}>
          {!certs ? <Loading /> : !certs.length ? <p className="small muted">{t('Upload your marksheet first under My Certificates.')}</p> : (
            <div className="stack" style={{ gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {certs.map((c) => (
                <label key={c.id} className="checkbox" style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                  <span style={{ flex: 1 }}>{c.title}</span><Badge tone={{ Verified: 'green', Pending: 'amber', Rejected: 'red' }[c.status]}>{t(c.status)}</Badge>
                </label>
              ))}
            </div>
          )}
        </Field>
        <div className="modal-foot" style={{ margin: '4px -22px -20px' }}>
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? t('Submitting…') : t('Submit application')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function StudentScholarships() {
  const t = useT();
  const { toast, confirm } = useUI();
  const { data, loading, error, reload } = useFetch('/student/scholarships');
  const [applying, setApplying] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const withdraw = async (a) => {
    if (!(await confirm({ title: t('Withdraw application?'), message: a.call_title, confirmText: t('Withdraw'), danger: true }))) return;
    try { await api.del(`/student/applications/${a.id}`); toast(t('Application withdrawn')); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title={t('Scholarships')} subtitle={t('Apply for scholarships from the trust and follow your applications.')} />
      <h2 style={{ marginBottom: 12 }}>{t('Open now')}</h2>
      {!data.open.length ? <div className="card"><Empty icon="sparkle" title={t('No scholarships are open right now')} text={t('We will notify you when a new one opens.')} /></div> : (
        <div className="grid grid-2">
          {data.open.map((c) => (
            <div className="card card-pad" key={c.id}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3>{c.title}</h3>
                <Badge tone="green" plain>{t('Up to {max}', { max: inr(c.max_amount) })}</Badge>
              </div>
              {c.description && <p className="small muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{c.description}</p>}
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
                <span className="small"><Icon name="clock" size={14} style={{ verticalAlign: -2 }} /> {t('Apply before {date}', { date: date(c.deadline) })}</span>
                {c.applied_id ? <Badge tone="blue">{t('Applied')}</Badge> : <button className="btn btn-primary btn-sm" onClick={() => setApplying(c)}>{t('Apply')}</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ margin: '28px 0 12px' }}>{t('My applications')}</h2>
      <div className="card">
        {!data.mine.length ? <Empty icon="file" title={t('You have not applied yet')} /> : data.mine.map((a) => (
          <div className="list-item" key={a.id} style={{ alignItems: 'flex-start' }}>
            <div className="file-icon"><Icon name="sparkle" /></div>
            <div className="grow">
              <div className="row wrap" style={{ gap: 8 }}><span className="title">{a.call_title}</span><Badge tone={TONE[a.status]}>{t(a.status)}</Badge></div>
              <div className="cell-sub">{t('Requested')} {inr(a.amount_requested)} · {date(a.created_at)}{a.amount_approved ? ` · ${t('Approved')} ${inr(a.amount_approved)}` : ''}</div>
              {a.remarks && <div className={`alert ${a.status === 'Rejected' ? 'error' : 'success'}`} style={{ marginTop: 8, padding: '8px 10px' }}><Icon name="info" size={16} />{a.remarks}</div>}
            </div>
            {a.status === 'Submitted' && <button className="btn btn-sm" onClick={() => withdraw(a)}>{t('Withdraw')}</button>}
          </div>
        ))}
      </div>
      {applying && <ApplyModal call={applying} onClose={() => setApplying(null)} onDone={() => { setApplying(null); reload(); }} />}
    </>
  );
}
