import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import Icon from '../../components/Icons.jsx';
import { BarChart } from '../../components/Charts.jsx';
import { Empty, ErrorBox, Loading, Stat, useFetch } from '../../components/ui.jsx';
import { AnnouncementList } from '../Announcements.jsx';
import { date, inr, inrShort, num } from '../../format.js';

export default function DonorDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch('/donor/dashboard');
  const pledges = useFetch('/donor/pledges').data;
  const sponsored = useFetch('/donor/sponsorships').data;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const im = data.impact;

  return (
    <>
      <div className="hero">
        <div className="eyebrow">Thank you for your support</div>
        <h1>Welcome, <em>{user.name.split(' ')[0]}</em></h1>
        <p>Your generosity helps children stay in school and villages grow stronger. Here is everything you have given, in one place.</p>
        <div className="hero-actions">
          <Link to="/donate" className="btn btn-yellow"><Icon name="heart" size={16} />Donate now</Link>
          <Link to="/donations" className="btn btn-ghost-light"><Icon name="rupee" size={16} />My donations</Link>
          {data.last && <Link to={`/receipt/${data.last.id}`} className="btn btn-ghost-light"><Icon name="printer" size={16} />Latest receipt</Link>}
        </div>
      </div>

      <div className="grid grid-4">
        <Stat icon="heart" label="Total given" value={inr(data.lifetime)} sub="All time" />
        <Stat icon="calendar" tone="yellow" label={`This year (FY ${data.currentFy})`} value={inr(data.thisFy)} />
        <Stat icon="file" tone="blue" label="Donations" value={num(data.count)} />
        <Stat icon="clock" label="Last donation" value={data.last ? inr(data.last.amount) : '—'} sub={data.last ? date(data.last.donated_on) : null} />
      </div>

      {(pledges?.some((p) => p.state === 'Behind') || sponsored?.length > 0) && (
        <div className="grid grid-2 mt">
          {pledges?.filter((p) => p.state === 'Behind').slice(0, 1).map((p) => (
            <div className="card card-pad row" key={p.id} style={{ justifyContent: 'space-between' }}>
              <div><h3>Pledge instalment due</h3><p className="small muted">{inr(p.balance)} pending on your {p.frequency.toLowerCase()} pledge{p.project_name ? ` for ${p.project_name}` : ''}.</p></div>
              <Link to={`/donate?pledge=${p.id}&amount=${p.balance}`} className="btn btn-primary btn-sm">Pay now</Link>
            </div>
          ))}
          {sponsored?.length > 0 && (
            <Link to="/sponsorships" className="card card-pad row" style={{ justifyContent: 'space-between', color: 'inherit', textDecoration: 'none' }}>
              <div><h3>You sponsor {sponsored.length} student{sponsored.length > 1 ? 's' : ''}</h3><p className="small muted">{sponsored.map((s) => s.name).join(', ')} — see their progress</p></div>
              <Icon name="chevronRight" />
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-main mt">
        <div className="card">
          <div className="card-head"><h2>Your giving by financial year</h2></div>
          <div className="card-body">
            {data.byFy.length ? <BarChart data={data.byFy.map((d) => ({ label: `FY ${d.fy}`, value: d.total }))} highlightLast /> :
              <Empty icon="trending" title="No donations recorded yet" text="Once the trust records a donation from you, it will show up here." />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Your impact, together with others</h2></div>
          <div className="card-body stack">
            {[
              ['graduation', num(im.activeStudents), 'students currently supported'],
              ['heart', inrShort(im.aidDisbursed), 'given directly to students'],
              ['award', num(im.certificatesVerified), 'achievements verified'],
              ['village', num(im.villages), 'villages reached'],
            ].map(([icon, v, l]) => (
              <div className="row" key={l} style={{ gap: 14 }}>
                <div className="stat" style={{ padding: 0 }}><div className="icon-wrap"><Icon name={icon} size={20} /></div></div>
                <div><div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div><div className="small muted">{l}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="card-head"><h2>News from the trust</h2><Link to="/announcements" className="small">See all</Link></div>
        <AnnouncementList items={data.announcements} compact />
      </div>
    </>
  );
}
