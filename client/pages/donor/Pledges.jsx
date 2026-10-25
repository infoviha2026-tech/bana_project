import { Link } from 'react-router-dom';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, useFetch } from '../../components/ui.jsx';
import { date, inr } from '../../format.js';

export const PLEDGE_TONE = { 'On track': 'green', Behind: 'amber', 'Not started': 'blue', Paused: '', Ended: '' };

export default function DonorPledges() {
  const { data, loading, error, reload } = useFetch('/donor/pledges');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title="My Pledges" subtitle="Regular giving you have committed to. We send a gentle reminder when an instalment is due." />
      {!data.length ? <div className="card"><Empty icon="calendar" title="No pledges yet" text="A pledge is a promise to give regularly — for example ₹2,000 every month. Contact the trust office to set one up." /></div> : (
        <div className="grid grid-2">
          {data.map((p) => {
            const pct = p.expected ? Math.min(100, Math.round((p.received / p.expected) * 100)) : 0;
            return (
              <div className="card card-pad" key={p.id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3>{inr(p.amount)} <span className="muted" style={{ fontWeight: 500 }}>/ {p.frequency === 'Monthly' ? 'month' : p.frequency === 'Quarterly' ? 'quarter' : 'year'}</span></h3>
                  <Badge tone={PLEDGE_TONE[p.state]}>{p.state}</Badge>
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>{p.project_name || p.purpose || 'General Fund'} · since {date(p.start_date)}{p.end_date ? ` until ${date(p.end_date)}` : ''}</div>
                <div className="progress" style={{ margin: '14px 0 6px', height: 10 }}><div style={{ width: `${pct}%` }} /></div>
                <div className="row small" style={{ justifyContent: 'space-between' }}><span>Given <strong>{inr(p.received)}</strong></span><span className="muted">of {inr(p.expected)} due so far</span></div>
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
                  <span className="small muted">{p.nextDue ? <>Next instalment: <strong>{date(p.nextDue)}</strong></> : ''}</span>
                  {p.status === 'Active' && <Link className="btn btn-primary btn-sm" to={`/donate?pledge=${p.id}&amount=${p.balance || p.amount}`}><Icon name="heart" size={14} />Pay {inr(p.balance || p.amount)}</Link>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
