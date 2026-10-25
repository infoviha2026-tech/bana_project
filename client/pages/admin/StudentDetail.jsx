import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, download, openFile } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, useFetch, useUI } from '../../components/ui.jsx';
import { ResourceForm } from '../../components/Resource.jsx';
import { PhotoEditor } from '../student/Profile.jsx';
import { ProgressView } from '../student/Progress.jsx';
import { sponsorshipFields } from './Sponsorships.jsx';
import { date, dateTime, inr, timeAgo } from '../../format.js';
import { AccountActions, AidForm, StudentForm } from './common.jsx';
import { ReviewModal } from './Certificates.jsx';

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, confirm } = useUI();
  const { data: s, loading, error, reload } = useFetch(`/admin/students/${id}`);
  const [tab, setTab] = useState('certificates');
  const progress = useFetch(`/admin/students/${id}/progress`);
  const sponsors = useFetch(`/admin/sponsorships?student_id=${id}`);
  const [sponsoring, setSponsoring] = useState(false);
  const [editing, setEditing] = useState(false);
  const [aid, setAid] = useState(null);
  const [review, setReview] = useState(null);
  if (loading && !s) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const aidTotal = s.aid.reduce((t, a) => t + a.amount, 0);

  const removeStudent = async () => {
    if (!(await confirm({ title: `Permanently delete ${s.name}?`, message: 'This deletes the student, their login, all certificates and support records. This cannot be undone. Consider deactivating instead.', confirmText: 'Delete permanently', danger: true }))) return;
    try {
      await api.del(`/admin/students/${s.id}`);
      toast('Student deleted');
      navigate('/students');
    } catch (e) { toast(e.message, 'error'); }
  };

  const removeAid = async (a) => {
    if (!(await confirm({ title: 'Delete this record?', message: `${a.type} of ${inr(a.amount)} on ${date(a.given_on)} will be removed.`, confirmText: 'Delete', danger: true }))) return;
    try { await api.del(`/admin/aid/${a.id}`); toast('Record deleted'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead back={{ to: '/students', label: 'All students' }} title={s.name}
        actions={<>
          <button className="btn btn-primary" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Edit</button>
          {s.status === 'Active' && <button className="btn" onClick={() => download(`/admin/students/${s.id}/id-card`).catch((e) => toast(e.message, 'error'))}><Icon name="idcard" size={16} />ID card</button>}
          <AccountActions userId={s.user_id} name={s.name} active={!!s.is_active} onChanged={reload} onDelete={removeStudent} />
        </>} />

      <div className="grid grid-main">
        <div className="card">
          <div className="tabs">
            <button className={`tab ${tab === 'certificates' ? 'active' : ''}`} onClick={() => setTab('certificates')}>Certificates<span className="count">{s.certificates.length}</span></button>
            <button className={`tab ${tab === 'aid' ? 'active' : ''}`} onClick={() => setTab('aid')}>Support given<span className="count">{s.aid.length}</span></button>
            <button className={`tab ${tab === 'progress' ? 'active' : ''}`} onClick={() => setTab('progress')}>Marks & attendance</button>
            <button className={`tab ${tab === 'sponsors' ? 'active' : ''}`} onClick={() => setTab('sponsors')}>Sponsors<span className="count">{sponsors.data?.total ?? 0}</span></button>
          </div>
          {tab === 'progress' ? (
            <div className="card-body">{progress.data ? <ProgressView data={progress.data} /> : <Loading />}</div>
          ) : tab === 'sponsors' ? (
            <>
              <div className="filters" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary btn-sm" onClick={() => setSponsoring(true)}><Icon name="plus" size={14} />Add sponsor</button></div>
              {!sponsors.data?.rows.length ? <Empty icon="hand" title="No sponsors yet" /> : sponsors.data.rows.map((sp) => (
                <div className="list-item" key={sp.id}>
                  <div className="grow"><Link to={`/donors/${sp.donor_id}`} className="title">{sp.donor_name}</Link><div className="cell-sub">since {date(sp.start_date)}{sp.annual_amount ? ` · ${inr(sp.annual_amount)} / year` : ''}</div></div>
                  {sp.active ? <Badge tone="green">Active</Badge> : <Badge>Ended</Badge>}
                </div>
              ))}
            </>
          ) : tab === 'certificates' ? (
            s.certificates.length ? s.certificates.map((c) => (
              <div className="list-item" key={c.id}>
                <div className={`file-icon ${c.mime_type === 'application/pdf' ? 'pdf' : ''}`}><Icon name={c.mime_type === 'application/pdf' ? 'file' : 'image'} /></div>
                <div className="grow">
                  <div className="row wrap" style={{ gap: 8 }}><span className="title">{c.title}</span><Badge>{c.status}</Badge></div>
                  <div className="cell-sub">{c.category} · uploaded {timeAgo(c.created_at)}{c.remarks ? ` · “${c.remarks}”` : ''}</div>
                </div>
                <button className="icon-btn" title="View" onClick={() => openFile(`/certificates/${c.id}/file`).catch((e) => toast(e.message, 'error'))}><Icon name="eye" size={17} /></button>
                <button className="btn btn-sm" onClick={() => setReview({ ...c, student_name: s.name, student_code: s.student_code })}>Review</button>
              </div>
            )) : <Empty icon="award" title="No certificates uploaded yet" />
          ) : (
            <>
              <div className="filters" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Total: <strong style={{ color: 'var(--text)' }}>{inr(aidTotal)}</strong></span>
                <button className="btn btn-primary btn-sm" onClick={() => setAid({})}><Icon name="plus" size={14} />Record support</button>
              </div>
              {s.aid.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Date</th><th>Type</th><th>Notes</th><th className="num">Amount</th><th /></tr></thead>
                    <tbody>
                      {s.aid.map((a) => (
                        <tr key={a.id}>
                          <td className="nowrap">{date(a.given_on)}</td><td>{a.type}</td><td className="muted">{a.notes || '—'}</td>
                          <td className="num">{inr(a.amount)}</td>
                          <td className="right nowrap">
                            <button className="icon-btn" onClick={() => setAid(a)} aria-label="Edit"><Icon name="edit" size={16} /></button>
                            <button className="icon-btn danger" onClick={() => removeAid(a)} aria-label="Delete"><Icon name="trash" size={16} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty icon="heart" title="No support recorded yet" />}
            </>
          )}
        </div>

        <div className="stack">
          <div className="card card-pad">
            <div className="row" style={{ gap: 14 }}>
              <PhotoEditor studentId={s.id} name={s.name} hasPhoto={!!s.photo_path} uploadUrl={`/admin/students/${s.id}/photo`} onChanged={reload} size={72} />
              <div>
                <div className="mono muted">{s.student_code}</div>
                <div className="row wrap" style={{ marginTop: 4 }}><Badge>{s.status}</Badge>{!s.is_active && <Badge tone="red">Login disabled</Badge>}</div>
              </div>
            </div>
            <dl className="dl mt" style={{ gridTemplateColumns: '110px 1fr', fontSize: 13.5 }}>
              <dt>Email</dt><dd>{s.email || '—'}</dd>
              <dt>Phone</dt><dd>{s.phone || '—'}</dd>
              <dt>Gender</dt><dd>{s.gender || '—'}</dd>
              <dt>Born</dt><dd>{date(s.dob)}</dd>
              <dt>Guardian</dt><dd>{s.guardian_name || '—'}{s.guardian_phone && <div className="cell-sub">{s.guardian_phone}</div>}</dd>
              <dt>Address</dt><dd>{[s.address, s.village].filter(Boolean).join(', ') || '—'}</dd>
              <dt>School</dt><dd>{s.school || '—'}{s.class_year && <div className="cell-sub">{s.class_year}</div>}</dd>
              <dt>Programme</dt><dd>{s.programme || '—'}</dd>
              <dt>Joined</dt><dd>{date(s.joined_on)}</dd>
              <dt>Last sign-in</dt><dd>{s.last_login_at ? dateTime(s.last_login_at) : 'Never'}</dd>
              {progress.data?.checklist.total > 0 && <><dt>Documents</dt><dd>{progress.data.checklist.done} / {progress.data.checklist.total} verified{progress.data.checklist.items.filter((i) => i.status === 'Missing').length > 0 && <div className="cell-sub">Missing: {progress.data.checklist.items.filter((i) => i.status === 'Missing').map((i) => i.name).join(', ')}</div>}</dd></>}
            </dl>
          </div>
        </div>
      </div>

      {editing && <StudentForm student={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {sponsoring && <ResourceForm title={`Add a sponsor for ${s.name}`} endpoint="/admin/sponsorships" fields={sponsorshipFields} row={{ student_id: s.id, active: 1 }}
        onClose={() => setSponsoring(false)} onSaved={() => { setSponsoring(false); sponsors.reload(); }} />}
      {aid && <AidForm aid={aid.id ? aid : null} studentId={s.id} onClose={() => setAid(null)} onSaved={() => { setAid(null); reload(); }} />}
      {review && <ReviewModal cert={review} onClose={() => setReview(null)} onDone={() => { setReview(null); reload(); }} />}
    </>
  );
}
