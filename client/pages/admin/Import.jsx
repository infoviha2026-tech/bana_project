import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Badge, ErrorBox, Loading, PageHead, Stat, useFetch, useUI } from '../../components/ui.jsx';
import { dateTime } from '../../format.js';
import { Dropzone } from '../student/Certificates.jsx';
import { useMeta } from './common.jsx';

const TYPE_INFO = {
  students: { icon: 'graduation', text: 'Student profiles. Matched by Student ID — existing students are updated.', link: '/students' },
  donors: { icon: 'users', text: 'Donor profiles. Matched by email — existing donors are updated.', link: '/donors' },
  donations: { icon: 'rupee', text: 'Donations, linked to donors by email. Import donors first.', link: '/donations' },
  aid: { icon: 'heart', text: 'Scholarships and support, linked to students by Student ID.', link: '/aid' },
  marks: { icon: 'trending', text: 'Exam results per student and term. Re-importing the same exam updates it.', link: '/academics' },
  attendance: { icon: 'calendar', text: 'Monthly days present / working days per student.', link: '/academics' },
  expenses: { icon: 'file', text: 'Spending by date and category, optionally linked to a project by name.', link: '/expenses' },
};

const STATUS = { create: ['New', 'green'], update: ['Update', 'blue'], error: ['Error', 'red'] };

function Steps({ step }) {
  const labels = ['Choose data type', 'Upload file', 'Check & import'];
  return (
    <div className="steps">
      {labels.map((l, i) => (
        <div key={l} className="row" style={{ gap: 8 }}>
          {i > 0 && <div className="step-sep" />}
          <div className={`step ${step === i ? 'active' : step > i ? 'done' : ''}`}><span className="n">{step > i ? '✓' : i + 1}</span>{l}</div>
        </div>
      ))}
    </div>
  );
}

export default function Import() {
  const meta = useMeta();
  const { toast } = useUI();
  const history = useFetch('/admin/imports');
  const [type, setType] = useState('students');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  const step = result ? 3 : preview ? 2 : file ? 1 : 0;
  const def = meta?.importTypes.find((t) => t.key === type);

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(''); setShowErrorsOnly(false); };

  const check = async () => {
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('file', file);
      setPreview(await api.post('/admin/imports/preview', fd));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const commit = async () => {
    setBusy(true);
    setError('');
    try {
      const valid = preview.rows.filter((r) => preview.results.find((x) => x.row === r._row)?.status !== 'error');
      const out = await api.post('/admin/imports/commit', { type, fileName: preview.fileName, rows: valid });
      setResult(out);
      toast(`Import complete: ${out.created} added, ${out.updated} updated`);
      history.reload();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const cols = def ? def.columns.slice(0, 6) : [];

  return (
    <>
      <PageHead title="Import from Excel" subtitle="Bring your existing spreadsheets into the portal. Every row is checked before anything is saved." />

      <div className="card card-pad">
        <Steps step={step} />

        {step < 2 && (
          <>
            <h3 style={{ marginBottom: 10 }}>1. What are you importing?</h3>
            <div className="type-cards">
              {(meta?.importTypes || []).map((t) => (
                <button key={t.key} className={`type-card ${type === t.key ? 'active' : ''}`} onClick={() => { setType(t.key); setError(''); }}>
                  <Icon name={TYPE_INFO[t.key].icon} size={22} style={{ color: 'var(--green-700)' }} />
                  <strong>{t.label}</strong>
                  <span>{TYPE_INFO[t.key].text}</span>
                </button>
              ))}
            </div>

            {def && (
              <div className="alert info mt">
                <Icon name="info" />
                <div style={{ flex: 1 }}>
                  <strong>Columns:</strong> {def.columns.map((c, i) => <span key={c.header}>{i > 0 && ', '}{c.header}{c.required && <strong style={{ color: 'var(--red)' }}>*</strong>}</span>)}
                  <div className="small" style={{ marginTop: 4 }}>Column names don't have to match exactly — “Full Name”, “full_name” and “FULLNAME” all work. Dates can be 2026-04-10 or 10/04/2026.</div>
                </div>
                <button className="btn btn-sm" onClick={() => download(`/admin/imports/template/${type}`).catch((e) => toast(e.message, 'error'))}>
                  <Icon name="download" size={14} />Template
                </button>
              </div>
            )}

            <h3 style={{ margin: '22px 0 10px' }}>2. Upload your file</h3>
            <Dropzone file={file} onFile={(f) => { setFile(f); setError(''); }} accept=".xlsx,.csv" hint="Excel (.xlsx) or CSV · up to 10 MB · max 5,000 rows" />
            {error && <div className="mt"><ErrorBox error={error} /></div>}
            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              {file && <button className="btn" onClick={reset}>Clear</button>}
              <button className="btn btn-primary" disabled={!file || busy} onClick={check}>{busy ? 'Checking…' : <>Check file <Icon name="arrowRight" size={16} /></>}</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid grid-3">
              <Stat icon="plus" label="New records" value={preview.created} />
              <Stat icon="refresh" tone="blue" label="Will be updated" value={preview.updated} />
              <Stat icon="alert" tone="red" label="Rows with errors (skipped)" value={preview.skipped} />
            </div>
            <p className="small muted mt">
              <strong>{preview.fileName}</strong> · {preview.rows.length} rows · matched columns: {preview.matched.join(', ')}
            </p>
            {error && <div className="mt"><ErrorBox error={error} /></div>}
            <div className="card mt" style={{ boxShadow: 'none' }}>
              <div className="filters">
                <label className="checkbox"><input type="checkbox" checked={showErrorsOnly} onChange={(e) => setShowErrorsOnly(e.target.checked)} />Show only rows with errors</label>
              </div>
              <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Row</th><th>Result</th>{cols.map((c) => <th key={c.header}>{c.header}</th>)}</tr></thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const res = preview.results.find((x) => x.row === r._row);
                      if (showErrorsOnly && res.status !== 'error') return null;
                      return (
                        <tr key={r._row}>
                          <td className="muted">{r._row}</td>
                          <td style={{ minWidth: 140 }}><Badge tone={STATUS[res.status][1]}>{STATUS[res.status][0]}</Badge>{res.error && <div className="small" style={{ color: 'var(--red)', marginTop: 3 }}>{res.error}</div>}</td>
                          {cols.map((c) => <td key={c.header} className="small">{String(r[c.field] ?? '')}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={reset} disabled={busy}>Start over</button>
              <button className="btn btn-primary" onClick={commit} disabled={busy || preview.created + preview.updated === 0}>
                {busy ? 'Importing…' : <><Icon name="check" size={16} />Import {preview.created + preview.updated} valid rows</>}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <div className="empty">
            <div className="empty-icon"><Icon name="checkCircle" size={26} /></div>
            <h3>Import complete</h3>
            <p><strong>{result.created}</strong> added · <strong>{result.updated}</strong> updated · <strong>{preview.skipped + result.skipped}</strong> skipped</p>
            {(type === 'students' || type === 'donors') && result.created > 0 && <p className="small" style={{ marginTop: 6 }}>New accounts can sign in with the default password from Settings and will be asked to change it.</p>}
            <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button className="btn" onClick={reset}>Import another file</button>
              <Link className="btn btn-primary" to={TYPE_INFO[type].link}>View {def?.label.toLowerCase()}</Link>
            </div>
          </div>
        )}
      </div>

      <div className="card mt">
        <div className="card-head"><h2>Import history</h2></div>
        {history.loading ? <Loading /> : !history.data?.length ? <p className="card-body muted">No imports yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Type</th><th>File</th><th>By</th><th className="num">Added</th><th className="num">Updated</th><th className="num">Skipped</th></tr></thead>
              <tbody>
                {history.data.map((h) => (
                  <tr key={h.id}>
                    <td className="nowrap">{dateTime(h.created_at)}</td>
                    <td>{meta?.importTypes.find((t) => t.key === h.type)?.label || h.type}</td>
                    <td className="small">{h.file_name}</td>
                    <td>{h.by_name || '—'}</td>
                    <td className="num">{h.created}</td><td className="num">{h.updated}</td><td className="num">{h.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
