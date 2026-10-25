import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icons.jsx';
import Logo, { LogoMark } from '../components/Logo.jsx';
import { Loading, Modal } from '../components/ui.jsx';
import { StoryImage } from '../components/Media.jsx';
import { StoryCard } from './Stories.jsx';
import { date, inrShort, num } from '../format.js';

function usePublic(url) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    fetch(`/api${url}`).then(async (r) => {
      const j = await r.json();
      setState(r.ok ? { data: j, error: null } : { data: null, error: j.error || 'Not available' });
    }).catch(() => setState({ data: null, error: 'Could not load' }));
  }, [url]);
  return state;
}

/** Public impact page — also embeddable on the foundation's website with ?embed=1 */
export function Impact() {
  const [params] = useSearchParams();
  const embed = params.get('embed') === '1';
  const { data, error } = usePublic('/public/impact');
  const [open, setOpen] = useState(null);
  if (error) return <div className="content"><div className="alert info"><Icon name="info" />{error}</div></div>;
  if (!data) return <Loading />;
  const tiles = [
    ['graduation', num(data.students), 'students supported now'],
    ['village', num(data.villages), 'villages reached'],
    ['heart', inrShort(data.aidDisbursed), 'given directly to students'],
    ['award', num(data.certificatesVerified), 'achievements verified'],
    ['users', num(data.donors), 'donors'],
    ['clock', num(Math.round(data.volunteerHours)), 'volunteer hours'],
  ];
  return (
    <div style={{ background: 'var(--bg)', minHeight: embed ? 0 : '100vh' }}>
      {!embed && (
        <header style={{ background: 'var(--green-900)', padding: '16px 24px' }}>
          <div className="row" style={{ maxWidth: 1100, margin: '0 auto', justifyContent: 'space-between' }}>
            <Logo />
            <Link to="/" className="btn btn-yellow btn-sm">Sign in</Link>
          </div>
        </header>
      )}
      <div className="content" style={{ maxWidth: 1100 }}>
        {!embed && (
          <div className="hero">
            <div className="eyebrow">Together, we make a difference</div>
            <h1>Our <em>impact</em></h1>
            <p>Live numbers from {data.trust}. Updated {date(data.updatedAt)}.</p>
          </div>
        )}
        <div className="grid grid-3">
          {tiles.map(([icon, v, l]) => (
            <div className="card stat" key={l}><div className="icon-wrap"><Icon name={icon} size={20} /></div><div><div className="value">{v}</div><div className="label">{l}</div></div></div>
          ))}
        </div>
        {data.projects.length > 0 && (
          <>
            <h2 style={{ margin: '28px 0 12px' }}>Projects</h2>
            <div className="grid grid-3">
              {data.projects.map((p) => {
                const pct = Math.min(100, Math.round((p.raised / p.goal_amount) * 100));
                return (
                  <div className="card card-pad" key={p.id}>
                    <div className="row" style={{ justifyContent: 'space-between' }}><h3>{p.name}</h3>{p.status === 'Completed' && <span className="badge green">Completed</span>}</div>
                    <p className="small muted" style={{ margin: '6px 0 12px' }}>{p.village}</p>
                    <div className="progress"><div style={{ width: `${pct}%` }} /></div>
                    <div className="row small" style={{ justifyContent: 'space-between', marginTop: 6 }}><strong>{inrShort(p.raised)} raised</strong><span className="muted">{pct}% of {inrShort(p.goal_amount)}</span></div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {data.stories.length > 0 && (
          <>
            <h2 style={{ margin: '28px 0 12px' }}>Latest stories</h2>
            <div className="grid grid-3">{data.stories.map((s) => <StoryCard key={s.id} s={s} onOpen={setOpen} publicApi />)}</div>
          </>
        )}
      </div>
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <div style={{ margin: '-20px -22px 16px', overflow: 'hidden' }}><StoryImage story={open} height={240} publicApi /></div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{open.excerpt}{open.excerpt?.length >= 220 ? '…' : ''}</p>
        </Modal>
      )}
    </div>
  );
}

/** Where the ID-card QR code points */
export function Verify() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const { data, error } = usePublic(`/public/verify/${encodeURIComponent(code)}?s=${encodeURIComponent(params.get('s') || '')}`);
  return (
    <div className="receipt-page" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="card card-pad" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <LogoMark size={48} />
        <h2 style={{ marginTop: 10 }}>Student ID verification</h2>
        {!data && !error && <Loading />}
        {error && <div className="alert error mt"><Icon name="alert" />{error}</div>}
        {data && (
          <div className="mt">
            <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto', display: 'grid', placeItems: 'center', background: data.valid ? 'var(--green-50)' : 'var(--red-100)', color: data.valid ? 'var(--green-700)' : 'var(--red)' }}>
              <Icon name={data.valid ? 'checkCircle' : 'xCircle'} size={34} />
            </div>
            <h3 style={{ marginTop: 12, color: data.valid ? 'var(--green-800)' : 'var(--red)' }}>{data.valid ? 'Valid student ID' : 'Not valid'}</h3>
            {data.name && (
              <dl className="dl mt" style={{ textAlign: 'left', gridTemplateColumns: '110px 1fr' }}>
                <dt>Name</dt><dd>{data.name}</dd>
                <dt>Student ID</dt><dd>{data.student_code}</dd>
                <dt>Programme</dt><dd>{data.programme || '—'}</dd>
                <dt>Class</dt><dd>{data.class_year || '—'}</dd>
                <dt>Issued by</dt><dd>{data.trust}</dd>
              </dl>
            )}
            {data.reason && <p className="small muted mt">{data.reason}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
