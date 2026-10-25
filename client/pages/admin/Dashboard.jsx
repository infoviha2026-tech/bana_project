import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import Icon from '../../components/Icons.jsx';
import { BarChart, HBars } from '../../components/Charts.jsx';
import { Empty, ErrorBox, Loading, Stat, useFetch } from '../../components/ui.jsx';
import { date, inr, inrShort, num, timeAgo } from '../../format.js';
import { ProjectProgress } from '../donor/Projects.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function AdminDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch('/admin/dashboard');
  const risk = useFetch('/admin/academics/at-risk').data;
  const apps = useFetch('/admin/scholarship-applications?status=Submitted').data;
  const pledges = useFetch('/admin/pledges-status?status=Active&pageSize=200').data;
  const projects = useFetch('/admin/projects?status=Active').data;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const monthly = data.monthly.map((m) => {
    const [y, mo] = m.month.split('-');
    return { label: MONTHS[+mo - 1], full: `${MONTHS[+mo - 1]} ${y}`, value: m.total };
  });

  return (
    <>
      <div className="hero">
        <div className="eyebrow">{user.role === 'super_admin' ? 'Super Admin' : 'Admin'} · FY {data.currentFy}</div>
        <h1>Good to see you, <em>{user.name.split(' ')[0]}</em></h1>
        <p>{data.pendingCertificates ? `${data.pendingCertificates} certificate${data.pendingCertificates === 1 ? ' is' : 's are'} waiting for review.` : 'All certificates are reviewed. Nice work!'}</p>
        <div className="hero-actions">
          {data.pendingCertificates > 0 && <Link to="/certificates" className="btn btn-yellow"><Icon name="award" size={16} />Review certificates</Link>}
          <Link to="/donations?new=1" className="btn btn-ghost-light"><Icon name="plus" size={16} />Record donation</Link>
          <Link to="/import" className="btn btn-ghost-light"><Icon name="sheet" size={16} />Import from Excel</Link>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat icon="graduation" label="Active students" value={num(data.students.active)} sub={`${num(data.students.n)} total`} />
        <Stat icon="users" tone="blue" label="Donors" value={num(data.donors)} />
        <Stat icon="rupee" tone="yellow" label={`Donations FY ${data.currentFy}`} value={inrShort(data.donationsFy)} sub={`${inrShort(data.donations.total)} all time`} />
        <Stat icon="heart" label="Aid disbursed" value={inrShort(data.aid)} sub="Scholarships, fees, books" />
      </div>

      <div className="grid grid-3 mt">
        {[
          ['alert', 'red', 'Students needing attention', risk?.rows.length, 'Low marks or attendance', '/academics'],
          ['sparkle', 'yellow', 'Scholarship applications to review', apps?.length, 'New this cycle', '/scholarships'],
          ['clock', 'blue', 'Pledges behind schedule', pledges?.rows.filter((p) => p.state === 'Behind').length, 'Donors get automatic reminders', '/pledges'],
        ].map(([icon, tone, label, value, sub, to]) => (
          <Link key={label} to={to} style={{ color: 'inherit', textDecoration: 'none' }}>
            <Stat icon={icon} tone={value ? tone : ''} label={label} value={value ?? '…'} sub={sub} />
          </Link>
        ))}
      </div>

      {projects?.rows.length > 0 && (
        <div className="card mt">
          <div className="card-head"><h2>Active projects</h2><Link to="/projects" className="small">All projects</Link></div>
          <div className="card-body grid grid-3" style={{ gap: 20 }}>
            {projects.rows.slice(0, 3).map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <strong>{p.name}</strong><div className="small muted" style={{ marginBottom: 8 }}>{p.village}</div>
                <ProjectProgress p={p} />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-main mt">
        <div className="card">
          <div className="card-head"><h2>Donations — last 12 months</h2><Link to="/donations" className="small">All donations</Link></div>
          <div className="card-body"><BarChart data={monthly} highlightLast /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>By purpose</h2></div>
          <div className="card-body">
            {data.byPurpose.length ? <HBars data={data.byPurpose.map((p) => ({ label: p.purpose, value: p.total }))} format={inrShort} /> : <p className="muted">No donations yet.</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-3 mt">
        <div className="card">
          <div className="card-head"><h2>Waiting for review</h2><Link to="/certificates" className="small">Open queue</Link></div>
          {data.recentCertificates.length ? data.recentCertificates.map((c) => (
            <div className="list-item" key={c.id}>
              <div className="file-icon"><Icon name="award" /></div>
              <div className="grow"><div className="title">{c.title}</div><div className="cell-sub">{c.student} · {timeAgo(c.created_at)}</div></div>
            </div>
          )) : <Empty icon="checkCircle" title="All caught up" />}
        </div>
        <div className="card">
          <div className="card-head"><h2>Recent donations</h2></div>
          {data.recentDonations.map((d) => (
            <div className="list-item" key={d.id}>
              <div className="grow"><div className="title">{d.donor}</div><div className="cell-sub">{date(d.donated_on)}</div></div>
              <strong className="mono">{inr(d.amount)}</strong>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><h2>Top donors</h2><Link to="/donors" className="small">All donors</Link></div>
          {data.topDonors.map((d, i) => (
            <Link to={`/donors/${d.id}`} className="list-item" key={d.id} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="avatar" style={{ background: i === 0 ? 'var(--yellow)' : undefined, color: i === 0 ? 'var(--green-950)' : undefined }}>{i + 1}</div>
              <div className="grow"><div className="title">{d.name}</div></div>
              <strong className="mono">{inrShort(d.total)}</strong>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
