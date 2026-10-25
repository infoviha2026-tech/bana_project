import { Link } from 'react-router-dom';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, useFetch } from '../../components/ui.jsx';
import { date, inr, inrShort } from '../../format.js';

export function ProjectProgress({ p }) {
  const pct = Math.min(100, Math.round((p.raised / p.goal_amount) * 100));
  return (
    <>
      <div className="progress" style={{ height: 10 }}><div style={{ width: `${pct}%` }} /></div>
      <div className="row small" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span><strong>{inrShort(p.raised)}</strong> <span className="muted">of {inrShort(p.goal_amount)}</span></span>
        <strong style={{ color: 'var(--green-700)' }}>{pct}%</strong>
      </div>
    </>
  );
}

export default function DonorProjects() {
  const { data, loading, error, reload } = useFetch('/donor/projects');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title="Projects" subtitle="Specific goals you can give towards. Every rupee is tracked against the project." />
      {!data.length ? <div className="card"><Empty icon="village" title="No projects yet" /></div> : (
        <div className="grid grid-2">
          {data.map((p) => (
            <div className="card card-pad" key={p.id}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div><h3>{p.name}</h3><div className="small muted"><Icon name="mapPin" size={13} style={{ verticalAlign: -2 }} /> {p.village || '—'}{p.end_date ? ` · until ${date(p.end_date)}` : ''}</div></div>
                <Badge tone={p.status === 'Completed' ? 'green' : 'blue'} plain>{p.status}</Badge>
              </div>
              {p.description && <p className="small" style={{ margin: '10px 0 14px' }}>{p.description}</p>}
              <ProjectProgress p={p} />
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
                <span className="small muted">{p.donors} donor{p.donors === 1 ? '' : 's'}{p.my_total > 0 && <> · <strong style={{ color: 'var(--green-800)' }}>you gave {inr(p.my_total)}</strong></>}</span>
                {p.status === 'Active' && <Link to={`/donate?project=${p.id}`} className="btn btn-primary btn-sm"><Icon name="heart" size={14} />Give to this</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
