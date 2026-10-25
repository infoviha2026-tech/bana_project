import { useRef, useState } from 'react';
import { api, download } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { StudentPhoto, bustImage } from '../../components/Media.jsx';
import { Badge, ErrorBox, Field, Loading, PageHead, formObj, useFetch, useUI } from '../../components/ui.jsx';
import { date } from '../../format.js';
import { useT } from '../../i18n.jsx';

export function PhotoEditor({ studentId, name, hasPhoto, uploadUrl, onChanged, size = 88 }) {
  const t = useT();
  const { toast } = useUI();
  const input = useRef();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return toast(t('Only JPG and PNG images are allowed'), 'error');
    if (file.size > 2 * 1024 * 1024) return toast(t('Photo must be smaller than 2 MB'), 'error');
    const fd = new FormData();
    fd.append('photo', file);
    setBusy(true);
    try {
      await api.post(uploadUrl, fd);
      bustImage(`/photos/students/${studentId}?v=${version}`);
      setVersion((v) => v + 1);
      toast(t('Photo updated'));
      onChanged?.();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <StudentPhoto studentId={studentId} name={name} hasPhoto={hasPhoto} size={size} version={version} />
      <input ref={input} type="file" accept="image/jpeg,image/png" capture="user" hidden onChange={(e) => upload(e.target.files[0])} />
      <button className="icon-btn" disabled={busy} onClick={() => input.current.click()} title={t('Change photo')} aria-label={t('Change photo')}
        style={{ position: 'absolute', right: -4, bottom: -4, background: 'var(--yellow)', color: 'var(--green-950)', borderRadius: '50%', width: 30, height: 30, border: '2px solid #fff' }}>
        <Icon name="camera" size={14} />
      </button>
    </div>
  );
}

export default function StudentProfile() {
  const t = useT();
  const { toast } = useUI();
  const { data: s, loading, error, reload } = useFetch('/student/profile');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/student/profile', formObj(new FormData(e.currentTarget)));
      toast(t('Profile updated'));
      setEditing(false);
      reload();
    } catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  };

  return (
    <>
      <PageHead title={t('My Profile')} subtitle={t('Your details as recorded by the trust.')}
        actions={<>
          {s.status === 'Active' && <button className="btn" onClick={() => download('/student/id-card').catch((e) => toast(e.message, 'error'))}><Icon name="idcard" size={16} />{t('Download ID card')}</button>}
          {!editing && <button className="btn btn-primary" onClick={() => setEditing(true)}><Icon name="edit" size={16} />{t('Edit contact details')}</button>}
        </>} />
      <div className="grid grid-main">
        <div className="stack">
          <div className="card card-pad">
            <div className="row" style={{ gap: 18 }}>
              <PhotoEditor studentId={s.id} name={s.name} hasPhoto={!!s.photo_path} uploadUrl="/student/photo" onChanged={reload} />
              <div>
                <h2 style={{ fontSize: 20 }}>{s.name}</h2>
                <div className="row wrap muted" style={{ marginTop: 4 }}><span>{s.student_code}</span><Badge tone={s.status === 'Active' ? 'green' : 'blue'}>{t(s.status)}</Badge></div>
                {!s.photo_path && <p className="small muted" style={{ marginTop: 6 }}>{t('Add a clear photo of your face — it is printed on your ID card.')}</p>}
              </div>
            </div>
          </div>

          {editing ? (
            <form className="card" onSubmit={save}>
              <div className="card-head"><h2>{t('Contact details')}</h2></div>
              <div className="card-body form-grid">
                <Field label={t('Phone')}><input className="input" name="phone" defaultValue={s.phone || ''} inputMode="tel" /></Field>
                <Field label={t('Guardian name')}><input className="input" name="guardian_name" defaultValue={s.guardian_name || ''} /></Field>
                <Field label={t('Guardian phone')}><input className="input" name="guardian_phone" defaultValue={s.guardian_phone || ''} inputMode="tel" /></Field>
                <Field label={t('Address')} full><textarea className="input" name="address" defaultValue={s.address || ''} rows={2} style={{ minHeight: 70 }} /></Field>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn" onClick={() => setEditing(false)}>{t('Cancel')}</button>
                <button className="btn btn-primary" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
              </div>
            </form>
          ) : (
            <div className="card">
              <div className="card-head"><h2>{t('Personal & contact')}</h2></div>
              <dl className="dl card-body">
                <dt>{t('Email')}</dt><dd>{s.email || '—'}</dd>
                <dt>{t('Phone')}</dt><dd>{s.phone || '—'}</dd>
                <dt>{t('Gender')}</dt><dd>{s.gender ? t(s.gender) : '—'}</dd>
                <dt>{t('Date of birth')}</dt><dd>{date(s.dob)}</dd>
                <dt>{t('Guardian')}</dt><dd>{s.guardian_name || '—'}{s.guardian_phone ? ` · ${s.guardian_phone}` : ''}</dd>
                <dt>{t('Address')}</dt><dd>{[s.address, s.village].filter(Boolean).join(', ') || '—'}</dd>
              </dl>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h2>{t('Education')}</h2></div>
          <dl className="dl card-body" style={{ gridTemplateColumns: '120px 1fr' }}>
            <dt>{t('School / College')}</dt><dd>{s.school || '—'}</dd>
            <dt>{t('Class / Year')}</dt><dd>{s.class_year || '—'}</dd>
            <dt>{t('Programme')}</dt><dd>{s.programme || '—'}</dd>
            <dt>{t('Village')}</dt><dd>{s.village || '—'}</dd>
            <dt>{t('Joined')}</dt><dd>{date(s.joined_on)}</dd>
          </dl>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="alert info small"><Icon name="info" size={16} />{t('To change school or programme details, please contact the trust office.')}</div>
          </div>
        </div>
      </div>
    </>
  );
}
