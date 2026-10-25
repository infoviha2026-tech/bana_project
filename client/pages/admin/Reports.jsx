import { useState } from 'react';
import { download } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { GroupedBars, HBars } from '../../components/Charts.jsx';
import { ErrorBox, Loading, PageHead, Select, Stat, useFetch, useUI } from '../../components/ui.jsx';
import { inr, inrShort, num } from '../../format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fyList() {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => { const y = start - i; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; });
}

export default function Reports() {
  const { toast } = useUI();
  const years = fyList();
  const [fy, setFy] = useState(years[0]);
  const { data: s, loading, error, reload } = useFetch(`/admin/reports/summary?fy=${fy}`);
  const dl = (url) => download(url).catch((e) => toast(e.message, 'error'));

  return (
    <>
      <PageHead title="Reports" subtitle="Fund utilisation, the trustees' annual summary, and Form 10BD for income tax filing."
        actions={<Select value={fy} onChange={(e) => setFy(e.target.value)} options={years.map((y) => ({ value: y, label: `FY ${y}` }))} />} />

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        {[
          ['file', 'Trustees’ annual summary', 'One-page PDF with income, spending, projects, and key numbers.', `/admin/reports/annual.pdf?fy=${fy}`, 'Download PDF'],
          ['sheet', 'Form 10BD', 'Donor-wise statement of donations for the Income Tax portal. Check flagged rows before filing.', `/admin/reports/form-10bd?fy=${fy}`, 'Download Excel'],
          ['trending', 'Fund utilisation', 'Income by purpose against aid and expenses by category.', `/admin/reports/fund-utilisation.xlsx?fy=${fy}`, 'Download Excel'],
        ].map(([icon, title, text, url, label]) => (
          <div className="card card-pad" key={title}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="stat" style={{ padding: 0 }}><div className="icon-wrap"><Icon name={icon} size={20} /></div></div>
              <div><h3>{title}</h3><p className="small muted" style={{ margin: '4px 0 12px' }}>{text}</p><button className="btn btn-sm btn-primary" onClick={() => dl(url)}><Icon name="download" size={14} />{label}</button></div>
            </div>
          </div>
        ))}
      </div>

      {loading && !s ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          {(s.missingPan > 0 || s.cashOver2000.n > 0) && (
            <div className="alert warn" style={{ marginBottom: 16 }}>
              <Icon name="alert" />
              <div>
                <strong>Before filing Form 10BD for FY {s.fy}:</strong>
                {s.missingPan > 0 && <> {s.missingPan} donor{s.missingPan > 1 ? 's' : ''} without PAN.</>}
                {s.cashOver2000.n > 0 && <> {s.cashOver2000.n} cash donation{s.cashOver2000.n > 1 ? 's' : ''} above ₹2,000 ({inr(s.cashOver2000.total)}) — not eligible for 80G.</>}
              </div>
            </div>
          )}
          <div className="grid grid-4">
            <Stat icon="heart" label="Donations received" value={inrShort(s.income)} sub={`${num(s.donors)} donors · ${num(s.newDonors)} new`} />
            <Stat icon="graduation" tone="yellow" label="Aid to students" value={inrShort(s.aid)} sub={`${num(s.scholarshipsApproved)} scholarships approved`} />
            <Stat icon="file" tone="blue" label="Other expenses" value={inrShort(s.expenses)} />
            <Stat icon="trending" tone={s.income - s.aid - s.expenses < 0 ? 'red' : ''} label="Surplus / (deficit)" value={inrShort(s.income - s.aid - s.expenses)} />
          </div>

          <div className="card mt">
            <div className="card-head"><h2>Money in and out, month by month</h2></div>
            <div className="card-body">
              <GroupedBars data={s.monthly.map((m) => ({ label: MONTHS[Number(m.month.slice(5)) - 1], values: [m.income, m.aid, m.expenses] }))}
                series={[{ name: 'Donations', color: 'var(--green-700)' }, { name: 'Aid to students', color: 'var(--yellow-600)' }, { name: 'Expenses', color: '#8b958d' }]} />
            </div>
          </div>

          <div className="grid grid-3 mt">
            <div className="card"><div className="card-head"><h2>Income by purpose</h2></div><div className="card-body">
              {s.byPurpose.length ? <HBars data={s.byPurpose.map((x) => ({ label: x.purpose, value: x.total }))} format={inrShort} /> : <p className="muted">No donations.</p>}
            </div></div>
            <div className="card"><div className="card-head"><h2>Aid by type</h2></div><div className="card-body">
              {s.aidByType.length ? <HBars data={s.aidByType.map((x) => ({ label: x.type, value: x.total }))} format={inrShort} /> : <p className="muted">No aid given.</p>}
            </div></div>
            <div className="card"><div className="card-head"><h2>Expenses by category</h2></div><div className="card-body">
              {s.expensesByCategory.length ? <HBars data={s.expensesByCategory.map((x) => ({ label: x.category, value: x.total }))} format={inrShort} /> : <p className="muted">No expenses.</p>}
            </div></div>
          </div>

          <div className="grid grid-2 mt">
            <div className="card">
              <div className="card-head"><h2>Projects this year</h2></div>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Project</th><th className="num">Raised (FY)</th><th className="num">Spent (FY)</th><th className="num">Funded (all time)</th></tr></thead>
                <tbody>{s.projects.map((p) => <tr key={p.id}><td>{p.name}<div className="cell-sub">{p.status}</div></td><td className="num">{inr(p.raised_fy)}</td><td className="num">{inr(p.spent_fy)}</td><td className="num">{Math.round((p.raised / p.goal_amount) * 100)}%</td></tr>)}</tbody>
              </table></div>
            </div>
            <div className="card">
              <div className="card-head"><h2>Programme numbers</h2></div>
              <dl className="dl card-body">
                <dt>Active students</dt><dd>{num(s.activeStudents)}</dd>
                <dt>New students</dt><dd>{num(s.newStudents)}</dd>
                <dt>Certificates verified</dt><dd>{num(s.certificatesVerified)}</dd>
                <dt>Scholarships approved</dt><dd>{num(s.scholarshipsApproved)}</dd>
                <dt>Events held</dt><dd>{num(s.events)}</dd>
                <dt>Volunteer hours</dt><dd>{num(s.volunteerHours)}</dd>
                <dt>Donations by mode</dt><dd>{s.byMode.map((m) => `${m.mode}: ${inrShort(m.total)}`).join(' · ') || '—'}</dd>
              </dl>
            </div>
          </div>
        </>
      )}
    </>
  );
}
