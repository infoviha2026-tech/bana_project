import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icons.jsx';
import Logo from './Logo.jsx';
import { Avatar, FormModal, Field, useUI, useFetch } from './ui.jsx';
import { useAuth } from '../auth.jsx';
import { api, setToken } from '../api.js';
import { ROLE_LABEL, timeAgo } from '../format.js';
import { LANGUAGES, useLang, useT } from '../i18n.jsx';

const NAV = {
  student: [
    { items: [
      { to: '/', label: 'Dashboard', icon: 'home', end: true },
      { to: '/certificates', label: 'My Certificates', icon: 'award' },
      { to: '/progress', label: 'My Progress', icon: 'trending' },
      { to: '/scholarships', label: 'Scholarships', icon: 'graduation' },
      { to: '/support', label: 'My Support', icon: 'heart' },
      { to: '/events', label: 'Events', icon: 'calendar' },
      { to: '/profile', label: 'My Profile', icon: 'user' },
      { to: '/announcements', label: 'Announcements', icon: 'megaphone' },
    ] },
  ],
  donor: [
    { items: [
      { to: '/', label: 'Dashboard', icon: 'home', end: true },
      { to: '/donate', label: 'Donate', icon: 'heart' },
      { to: '/donations', label: 'My Donations', icon: 'rupee' },
      { to: '/pledges', label: 'My Pledges', icon: 'calendar' },
      { to: '/sponsorships', label: 'Sponsored Students', icon: 'graduation' },
      { to: '/projects', label: 'Projects', icon: 'village' },
      { to: '/stories', label: 'Impact Stories', icon: 'image' },
      { to: '/profile', label: 'My Profile', icon: 'user' },
      { to: '/announcements', label: 'Announcements', icon: 'megaphone' },
    ] },
  ],
  admin: [
    { items: [{ to: '/', label: 'Overview', icon: 'home', end: true }] },
    { section: 'Students', items: [
      { to: '/students', label: 'Students', icon: 'graduation' },
      { to: '/certificates', label: 'Certificates', icon: 'award', badge: 'pending' },
      { to: '/academics', label: 'Marks & Attendance', icon: 'trending' },
      { to: '/scholarships', label: 'Scholarships', icon: 'sparkle' },
      { to: '/aid', label: 'Aid Given', icon: 'heart' },
      { to: '/events', label: 'Events', icon: 'calendar' },
    ] },
    { section: 'Donors & Funds', items: [
      { to: '/donors', label: 'Donors', icon: 'users' },
      { to: '/donations', label: 'Donations', icon: 'rupee' },
      { to: '/pledges', label: 'Pledges', icon: 'clock' },
      { to: '/sponsorships', label: 'Sponsorships', icon: 'hand' },
      { to: '/projects', label: 'Projects', icon: 'village' },
      { to: '/expenses', label: 'Expenses', icon: 'file' },
      { to: '/payments', label: 'Online Payments', icon: 'trending' },
    ] },
    { section: 'Community', items: [
      { to: '/villages', label: 'Villages', icon: 'mapPin' },
      { to: '/volunteers', label: 'Volunteers', icon: 'users' },
      { to: '/stories', label: 'Impact Stories', icon: 'image' },
      { to: '/announcements', label: 'Announcements', icon: 'megaphone' },
    ] },
    { section: 'Data', items: [
      { to: '/reports', label: 'Reports', icon: 'sheet' },
      { to: '/import', label: 'Import from Excel', icon: 'upload' },
      { to: '/documents', label: 'Document Checklist', icon: 'checkCircle' },
    ] },
  ],
};
NAV.super_admin = [
  ...NAV.admin,
  { section: 'Super Admin', items: [
    { to: '/users', label: 'Users & Roles', icon: 'shield' },
    { to: '/messages', label: 'Email & SMS', icon: 'mail' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
    { to: '/audit', label: 'Audit Log', icon: 'history' },
  ] },
];

export function ChangePasswordModal({ onClose, forced }) {
  const { toast } = useUI();
  const { refresh, logout } = useAuth();
  const t = useT();
  return (
    <FormModal title={forced ? t('Set a new password') : t('Change password')} submitText={t('Update password')} onClose={forced ? logout : onClose}
      cancelText={forced ? t('Sign out') : t('Cancel')}
      onSubmit={async (fd) => {
        if (fd.get('next') !== fd.get('confirm')) throw new Error(t('New passwords do not match'));
        // Changing the password signs out other devices; keep this session with the fresh token
        const r = await api.post('/auth/change-password', { current: fd.get('current'), next: fd.get('next') });
        setToken(r.token);
        await refresh();
        toast(t('Password updated'));
        onClose();
      }}>
      <div className="stack">
        {forced && <div className="alert info"><Icon name="info" />{t('For your security, please replace the temporary password you were given.')}</div>}
        <Field label={t('Current password')} required><input className="input" type="password" name="current" required autoComplete="current-password" /></Field>
        <Field label={t('New password')} required hint={t("At least 8 characters, with a letter and a number. Don't use your name.")}><input className="input" type="password" name="next" required minLength={8} autoComplete="new-password" /></Field>
        <Field label={t('Confirm new password')} required><input className="input" type="password" name="confirm" required minLength={8} autoComplete="new-password" /></Field>
      </div>
    </FormModal>
  );
}

function useClickAway(ref, close) {
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && close();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, close]);
}

export function LanguageSwitch({ compact }) {
  const { lang, setLang } = useLang();
  const { user } = useAuth();
  return (
    <select className="input" value={lang} aria-label="Language" style={{ width: 'auto', height: 34, paddingRight: 8, fontSize: 13 }}
      onChange={(e) => {
        setLang(e.target.value);
        if (user) api.put('/auth/language', { language: e.target.value }).catch(() => {});
      }}>
      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{compact ? l.native : `${l.native}${l.code !== 'en' ? ` (${l.label})` : ''}`}</option>)}
    </select>
  );
}

function Bell() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const { data, reload } = useFetch('/notifications');
  useClickAway(ref, () => setOpen(false));
  useEffect(() => {
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (n) => {
    setOpen(false);
    if (!n.read_at) await api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
    reload();
    if (n.link) navigate(n.link);
  };
  const unread = data?.unread || 0;
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={t('Notifications')} style={{ position: 'relative' }}>
        <Icon name="bell" size={19} />
        {unread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="menu" style={{ width: 340, maxWidth: 'calc(100vw - 24px)', padding: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <strong>{t('Notifications')}</strong>
            {unread > 0 && <button className="btn btn-sm btn-ghost" style={{ width: 'auto' }} onClick={async () => { await api.post('/notifications/read', { all: true }); reload(); }}>{t('Mark all read')}</button>}
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {!data?.rows.length ? <p className="muted small" style={{ padding: 16 }}>{t('You have no notifications yet.')}</p> : data.rows.slice(0, 15).map((n) => (
              <button key={n.id} onClick={() => go(n)} style={{ display: 'block', borderBottom: '1px solid var(--border)', borderRadius: 0, padding: '10px 14px', background: n.read_at ? 'transparent' : 'var(--green-50)' }}>
                <div style={{ fontWeight: n.read_at ? 500 : 700, fontSize: 13.5 }}>{n.title}</div>
                {n.body && <div className="small muted" style={{ marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.body}</div>}
                <div className="small faint" style={{ marginTop: 3 }}>{timeAgo(n.created_at)}</div>
              </button>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} style={{ display: 'block', textAlign: 'center', padding: 10, fontSize: 13, borderTop: '1px solid var(--border)' }}>{t('See all')}</Link>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef();
  const navigate = useNavigate();
  useClickAway(ref, () => setOpen(false));
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="user-chip" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={user.name} />
        <div className="who"><strong>{user.name}</strong><span>{t(ROLE_LABEL[user.role])}</span></div>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {(user.role === 'student' || user.role === 'donor') && (
            <button onClick={() => { setOpen(false); navigate('/profile'); }}><Icon name="user" size={16} />{t('My profile')}</button>
          )}
          <button onClick={() => { setOpen(false); navigate('/security'); }}><Icon name="shield" size={16} />{t('Security & sign-in')}</button>
          <button onClick={() => { setOpen(false); setPw(true); }}><Icon name="key" size={16} />{t('Change password')}</button>
          <button onClick={logout}><Icon name="logout" size={16} />{t('Sign out')}</button>
        </div>
      )}
      {pw && <ChangePasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const t = useT();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const admin = user.role === 'admin' || user.role === 'super_admin';
  const { data: counts, reload } = useFetch(admin ? '/admin/certificates?status=Pending&pageSize=1' : null);
  useEffect(() => { setOpen(false); if (admin) reload(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = NAV[user.role];
  const current = groups.flatMap((g) => g.items).find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));
  // Students and donors see the translated interface; staff pages stay in English
  const tr = admin ? (s) => s : t;

  return (
    <div className={`shell ${open ? 'open' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand"><Logo /></div>
        <nav>
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.section && <div className="nav-section">{g.section}</div>}
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className="nav-link">
                  <Icon name={i.icon} size={18} />
                  {tr(i.label)}
                  {i.badge === 'pending' && counts?.total > 0 && <span className="count">{counts.total}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">BANA Connect · {tr('Together, we make a difference')}</div>
      </aside>
      <div className="backdrop" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="topbar-title">{current ? tr(current.label) : ''}</div>
          <div className="spacer" />
          {!admin && <LanguageSwitch compact />}
          <Bell />
          <UserMenu />
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
