import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icons.jsx';
import { ChangePasswordModal } from '../components/Layout.jsx';
import { Badge, Field, Modal, PageHead, useUI } from '../components/ui.jsx';
import { useT } from '../i18n.jsx';

function TwoFactorSetup({ onClose, onDone }) {
  const t = useT();
  const [step, setStep] = useState('start'); // start | scan | codes
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setBusy(true);
    try { setSetup(await api.post('/auth/2fa/setup')); setStep('scan'); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const enable = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { const r = await api.post('/auth/2fa/enable', { code }); setCodes(r.recoveryCodes); setStep('codes'); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <Modal title={t('Turn on two-step verification')} onClose={step === 'codes' ? onDone : onClose}>
      {error && <div className="alert error" style={{ marginBottom: 14 }}><Icon name="alert" />{error}</div>}
      {step === 'start' && (
        <div className="stack">
          <p>{t('Each time you sign in you will also enter a 6-digit code from an authenticator app on your phone, so a stolen password alone is not enough.')}</p>
          <p className="muted small">{t('Install Google Authenticator, Microsoft Authenticator, or Authy on your phone first.')}</p>
          <button className="btn btn-primary" onClick={begin} disabled={busy}>{t('Continue')}</button>
        </div>
      )}
      {step === 'scan' && setup && (
        <form onSubmit={enable} className="stack">
          <p>{t('1. Scan this QR code with your authenticator app.')}</p>
          <img src={setup.qr} alt="QR code" width={200} height={200} style={{ alignSelf: 'center', border: '1px solid var(--border)', borderRadius: 8 }} />
          <p className="small muted">{t("Can't scan? Enter this key manually:")} <code style={{ wordBreak: 'break-all', fontWeight: 700 }}>{setup.secret}</code></p>
          <Field label={t('2. Enter the 6-digit code shown in the app')} required>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required
              style={{ fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' }} />
          </Field>
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>{t('Turn on')}</button>
        </form>
      )}
      {step === 'codes' && (
        <div className="stack">
          <div className="alert success"><Icon name="checkCircle" />{t('Two-step verification is on.')}</div>
          <p><strong>{t('Save these recovery codes now.')}</strong> {t('Each can be used once if you lose your phone. They will not be shown again.')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontFamily: 'ui-monospace, monospace', fontWeight: 700, background: 'var(--surface-2)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
            {codes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div className="row">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}><Icon name="file" size={16} />{t('Copy')}</button>
            <button className="btn btn-primary" onClick={onDone}>{t('I have saved them')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TwoFactorDisable({ onClose, onDone }) {
  const t = useT();
  const [error, setError] = useState('');
  return (
    <Modal title={t('Turn off two-step verification')} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try { await api.post('/auth/2fa/disable', { password: fd.get('password'), code: fd.get('code') }); onDone(); } catch (err) { setError(err.message); }
      }}>
        {error && <div className="alert error"><Icon name="alert" />{error}</div>}
        <Field label={t('Password')} required><input className="input" type="password" name="password" required autoComplete="current-password" /></Field>
        <Field label={t('Code from your app')} required><input className="input" name="code" inputMode="numeric" required maxLength={6} /></Field>
        <button className="btn btn-danger">{t('Turn off')}</button>
      </form>
    </Modal>
  );
}

export default function Security() {
  const { user, refresh, logout } = useAuth();
  const { toast, confirm } = useUI();
  const t = useT();
  const [modal, setModal] = useState(null);
  const admin = user.role === 'admin' || user.role === 'super_admin';

  return (
    <>
      <PageHead title={t('Security & sign-in')} subtitle={t('Keep your account safe.')} />
      <div className="stack" style={{ maxWidth: 760 }}>
        <div className="card card-pad row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 14 }}>
            <div className="stat" style={{ padding: 0 }}><div className="icon-wrap"><Icon name="key" size={20} /></div></div>
            <div><h3>{t('Password')}</h3><p className="small muted">{t('Use a password you do not use anywhere else.')}</p></div>
          </div>
          <button className="btn" onClick={() => setModal('password')}>{t('Change password')}</button>
        </div>

        <div className="card card-pad row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 14 }}>
            <div className="stat" style={{ padding: 0 }}><div className={`icon-wrap ${user.totp_enabled ? '' : 'yellow'}`}><Icon name="phone2" size={20} /></div></div>
            <div>
              <h3>{t('Two-step verification')} {user.totp_enabled ? <Badge tone="green">{t('On')}</Badge> : <Badge tone="amber">{t('Off')}</Badge>}</h3>
              <p className="small muted">{t('A code from your phone is needed each time you sign in.')}{admin && !user.totp_enabled ? ` ${t('Strongly recommended for staff accounts.')}` : ''}</p>
            </div>
          </div>
          {user.totp_enabled
            ? <button className="btn" onClick={() => setModal('disable')}>{t('Turn off')}</button>
            : <button className="btn btn-primary" onClick={() => setModal('enable')}>{t('Turn on')}</button>}
        </div>

        <div className="card card-pad row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 14 }}>
            <div className="stat" style={{ padding: 0 }}><div className="icon-wrap red"><Icon name="power" size={20} /></div></div>
            <div><h3>{t('Sign out everywhere')}</h3><p className="small muted">{t('Use this if you signed in on a shared or lost device.')}</p></div>
          </div>
          <button className="btn" onClick={async () => {
            if (!(await confirm({ title: t('Sign out everywhere?'), message: t('You will be signed out on every device, including this one.'), confirmText: t('Sign out'), danger: true }))) return;
            await api.post('/auth/logout-all').catch(() => {});
            logout();
          }}>{t('Sign out everywhere')}</button>
        </div>
      </div>
      {modal === 'password' && <ChangePasswordModal onClose={() => setModal(null)} />}
      {modal === 'enable' && <TwoFactorSetup onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); toast(t('Two-step verification is on.')); }} />}
      {modal === 'disable' && <TwoFactorDisable onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); toast(t('Two-step verification is off.')); }} />}
    </>
  );
}
