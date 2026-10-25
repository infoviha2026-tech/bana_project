import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import Icon from '../components/Icons.jsx';
import Logo from '../components/Logo.jsx';
import { LanguageSwitch } from '../components/Layout.jsx';
import { useT } from '../i18n.jsx';

const DEMO = [
  ['Super Admin', 'superadmin@bana.org', 'Admin@123'],
  ['Staff Admin', 'staff@bana.org', 'Staff@123'],
  ['Student', 'BANA-001', 'Student@123'],
  ['Donor', 'ravi.reddy@example.com', 'Donor@123'],
];

function PasswordInput({ value, onChange, id = 'password', autoComplete = 'current-password', label }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required style={{ paddingRight: 44 }} aria-label={label} />
      <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 3, top: 3 }}>
        <Icon name="eye" size={16} />
      </button>
    </div>
  );
}

export default function Login() {
  const { login, completeTwoFactor } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // login | 2fa | forgot | reset
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const submitLogin = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await login(identifier.trim(), password);
      if (r.challenge) { setChallenge(r.challenge); setCode(''); setMode('2fa'); return; }
      navigate('/', { replace: true });
    });
  };
  const submit2fa = (e) => {
    e.preventDefault();
    run(async () => { await completeTwoFactor(challenge, code); navigate('/', { replace: true }); });
  };
  const submitForgot = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/auth/forgot', { identifier: identifier.trim() });
      setInfo(r.message);
      setCode('');
      setPassword('');
      setMode('reset');
    });
  };
  const submitReset = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/auth/reset', { identifier: identifier.trim(), code, password });
      setInfo(t('Your password has been reset. Please sign in with your new password.'));
      setPassword('');
      setMode('login');
    });
  };

  const titles = {
    login: [t('Welcome back'), t('Sign in with your email, or your Student ID if you are a student.')],
    '2fa': [t('Two-step verification'), t('Enter the 6-digit code from your authenticator app, or one of your recovery codes.')],
    forgot: [t('Forgot your password?'), t('Enter your email or Student ID. We will send a one-time code to your registered email or phone.')],
    reset: [t('Set a new password'), t('Enter the 6-digit code we sent you and choose a new password.')],
  };

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="pattern" />
        <Logo size={46} />
        <div>
          <div className="hero" style={{ background: 'none', padding: 0, margin: 0, overflow: 'visible' }}>
            <div className="eyebrow">{t('Together, we make a difference')}</div>
          </div>
          <h1 style={{ marginTop: 14 }}>BANA Connect<em>{t('Portal')}</em></h1>
          <p className="lead">{t('One place for our students, donors, and team — supporting education, building better villages, and bringing opportunities closer to home.')}</p>
          <div className="auth-points">
            <div><Icon name="award" /><span><strong>{t('Students')}</strong> — {t('upload certificates, track your progress, and apply for scholarships.')}</span></div>
            <div><Icon name="heart" /><span><strong>{t('Donors')}</strong> — {t('donate online, download 80G statements, and follow your impact.')}</span></div>
            <div><Icon name="shield" /><span><strong>{t('Trust team')}</strong> — {t('manage records, verify documents, and import data from Excel.')}</span></div>
          </div>
        </div>
        <div className="row wrap small" style={{ color: '#8fae97', gap: 16 }}>
          <span>{t('Rooted in community. Driven by possibility.')}</span>
          <Link to="/impact" style={{ color: 'var(--yellow)' }}>{t('See our impact')} →</Link>
        </div>
      </section>

      <section className="auth-form">
        <div className="box">
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 18 }}><LanguageSwitch /></div>
          <h2>{titles[mode][0]}</h2>
          <p className="muted" style={{ marginTop: 6, marginBottom: 24 }}>{titles[mode][1]}</p>
          {error && <div className="alert error" style={{ marginBottom: 14 }}><Icon name="alert" />{error}</div>}
          {info && <div className="alert success" style={{ marginBottom: 14 }}><Icon name="checkCircle" />{info}</div>}

          {mode === 'login' && (
            <form onSubmit={submitLogin} className="stack">
              <div className="field">
                <label htmlFor="identifier">{t('Email or Student ID')}</label>
                <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus required placeholder="you@example.com or BANA-001" />
              </div>
              <div className="field">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <label htmlFor="password">{t('Password')}</label>
                  <button type="button" className="small" style={{ background: 'none', border: 0, color: 'var(--green-700)', cursor: 'pointer', padding: 0 }} onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}>{t('Forgot password?')}</button>
                </div>
                <PasswordInput value={password} onChange={setPassword} label={t('Password')} />
              </div>
              <button className="btn btn-primary" style={{ height: 44, marginTop: 4 }} disabled={busy}>
                {busy ? t('Signing in…') : <>{t('Sign in')} <Icon name="arrowRight" size={16} /></>}
              </button>
            </form>
          )}

          {mode === '2fa' && (
            <form onSubmit={submit2fa} className="stack">
              <div className="field">
                <label htmlFor="code">{t('Verification code')}</label>
                <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" autoFocus required maxLength={12}
                  style={{ fontSize: 22, letterSpacing: '0.3em', textAlign: 'center', height: 52 }} placeholder="123456" />
              </div>
              <button className="btn btn-primary" style={{ height: 44 }} disabled={busy}>{busy ? t('Checking…') : t('Verify and sign in')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setMode('login'); setError(''); }}>{t('Back')}</button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={submitForgot} className="stack">
              <div className="field">
                <label htmlFor="fid">{t('Email or Student ID')}</label>
                <input id="fid" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus required />
              </div>
              <button className="btn btn-primary" style={{ height: 44 }} disabled={busy}>{busy ? t('Sending…') : t('Send code')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setMode('login'); setError(''); setInfo(''); }}>{t('Back to sign in')}</button>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={submitReset} className="stack">
              <div className="field">
                <label htmlFor="otp">{t('6-digit code')}</label>
                <input id="otp" className="input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus required
                  style={{ fontSize: 22, letterSpacing: '0.3em', textAlign: 'center', height: 52 }} />
              </div>
              <div className="field">
                <label htmlFor="newpw">{t('New password')}</label>
                <PasswordInput id="newpw" value={password} onChange={setPassword} autoComplete="new-password" label={t('New password')} />
                <span className="hint">{t("At least 8 characters, with a letter and a number. Don't use your name.")}</span>
              </div>
              <button className="btn btn-primary" style={{ height: 44 }} disabled={busy}>{busy ? t('Saving…') : t('Reset password')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}>{t('Send a new code')}</button>
            </form>
          )}

          {import.meta.env.DEV && mode === 'login' && (
            <div className="demo">
              <div className="small muted" style={{ fontWeight: 700, marginBottom: 4 }}>Demo accounts (development only)</div>
              {DEMO.map(([label, id, pw]) => (
                <button key={id} type="button" onClick={() => { setIdentifier(id); setPassword(pw); }}>
                  <span>{label}</span><span>{id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
