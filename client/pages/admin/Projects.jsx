import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icons.jsx';
import ResourcePage, { ResourceForm } from '../../components/Resource.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, Stat, useFetch } from '../../components/ui.jsx';
import { date, inr, inrShort } from '../../format.js';
import { useMeta } from './common.jsx';
import { ProjectProgress } from '../donor/Projects.jsx';

const fields = (meta) => [
  { name: 'name', label: 'Project name', required: true, full: true, max: 150 },
  { name: 'goal_amount', label: 'Funding goal (₹)', type: 'amount', required: true },
  { name: 'village', label: 'Village', list: meta?.villages },
  { name: 'start_date', label: 'Start date', type: 'date' },
  { name: 'end_date', label: 'Target end date', type: 'date' },
  { name: 'status', label: 'Status', type: 'select', options: meta?.projectStatuses || ['Active'], required: true },
  { name: 'description', label: 'Description (shown to donors)', type: 'textarea', max: 3000 },
];

export default function Projects() {
  const meta = useMeta();
  const navigate = useNavigate();
  return (
    <ResourcePage title="Projects" subtitle="Fundraising goals donors can give towards. Donations and expenses linked to a project are tracked against its goal."
      endpoint="/admin/projects" exportType="projects" itemLabel="project" newLabel="New project"
      filters={[{ key: 'status', placeholder: 'All statuses', options: meta?.projectStatuses || [] }]}
      onRowClick={(r) => navigate(`/projects/${r.id}`)}
      columns={[
        { key: 'name', label: 'Project', render: (r) => <><strong>{r.name}</strong><div className="cell-sub">{r.village || '—'}</div></> },
        { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'Active' ? 'blue' : r.status === 'Completed' ? 'green' : ''}>{r.status}</Badge> },
        { key: 'progress', label: 'Raised', render: (r) => <div style={{ minWidth: 180 }}><ProjectProgress p={r} /></div> },
        { key: 'donors', label: 'Donors', num: true },
        { key: 'spent', label: 'Spent', money: true },
      ]}
      fields={fields(meta)} />
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const meta = useMeta();
  const { data: p, loading, error, reload } = useFetch(`/admin/projects/${id}`);
  const [editing, setEditing] = useState(false);
  if (loading && !p) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead back={{ to: '/projects', label: 'All projects' }} title={p.name} subtitle={[p.village, p.start_date && `${date(p.start_date)} – ${p.end_date ? date(p.end_date) : 'ongoing'}`].filter(Boolean).join(' · ')}
        actions={<>
          <Link to={`/donations?project_id=${p.id}`} className="btn"><Icon name="rupee" size={16} />Donations</Link>
          <button className="btn btn-primary" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Edit</button>
        </>} />
      <div className="grid grid-4">
        <Stat icon="trending" label="Goal" value={inrShort(p.goal_amount)} />
        <Stat icon="heart" tone="yellow" label="Raised" value={inrShort(p.raised)} sub={`${Math.round((p.raised / p.goal_amount) * 100)}% · ${p.donors} donors`} />
        <Stat icon="file" tone="blue" label="Spent" value={inrShort(p.spent)} />
        <Stat icon="rupee" tone={p.raised - p.spent < 0 ? 'red' : ''} label="Balance" value={inrShort(p.raised - p.spent)} />
      </div>
      <div className="card card-pad mt"><ProjectProgress p={p} />{p.description && <p className="muted" style={{ marginTop: 14 }}>{p.description}</p>}</div>
      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head"><h2>Donations</h2></div>
          {!p.donations.length ? <Empty icon="rupee" title="No donations yet" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Donor</th><th>Receipt</th><th className="num">Amount</th></tr></thead>
              <tbody>{p.donations.map((d) => <tr key={d.id}><td className="nowrap">{date(d.donated_on)}</td><td>{d.donor_name}</td><td className="mono small"><Link to={`/receipt/${d.id}`}>{d.receipt_no}</Link></td><td className="num">{inr(d.amount)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Expenses</h2><Link to="/expenses" className="small">All expenses</Link></div>
          {!p.expenses.length ? <Empty icon="file" title="No expenses yet" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Paid to</th><th>Category</th><th className="num">Amount</th></tr></thead>
              <tbody>{p.expenses.map((e) => <tr key={e.id}><td className="nowrap">{date(e.spent_on)}</td><td>{e.vendor}<div className="cell-sub">{e.description}</div></td><td>{e.category}</td><td className="num">{inr(e.amount)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
      {editing && <ResourceForm title={`Edit ${p.name}`} endpoint="/admin/projects" fields={fields(meta)} row={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
