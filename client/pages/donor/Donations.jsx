import { useMemo, useState } from 'react';
import { download } from '../../api.js';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icons.jsx';
import { Empty, ErrorBox, Loading, PageHead, Select, useFetch, useUI } from '../../components/ui.jsx';
import { date, inr } from '../../format.js';

export default function DonorDonations() {
  const { data, loading, error, reload } = useFetch('/donor/donations');
  const { toast } = useUI();
  const [fy, setFy] = useState('');
  const [statementFy, setStatementFy] = useState('');
  const years = useMemo(() => [...new Set((data || []).map((d) => d.fy))], [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const rows = data.filter((d) => !fy || d.fy === fy);
  const total = rows.reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <PageHead title="My Donations" subtitle="Every contribution you have made to BANA Development Foundation, with receipts."
        actions={years.length > 0 && (
          <div className="row">
            <Select value={statementFy || years[0]} onChange={(e) => setStatementFy(e.target.value)} options={years.map((y) => ({ value: y, label: `FY ${y}` }))} />
            <button className="btn btn-primary" onClick={() => download(`/donor/statement?fy=${statementFy || years[0]}`).catch((e) => toast(e.message, 'error'))}>
              <Icon name="download" size={16} />80G statement (PDF)
            </button>
          </div>
        )} />
      <div className="card">
        <div className="filters">
          <Select value={fy} onChange={(e) => setFy(e.target.value)} placeholder="All financial years" options={years.map((y) => ({ value: y, label: `FY ${y}` }))} />
          <div style={{ flex: 1 }} />
          <div className="small muted">{rows.length} {rows.length === 1 ? 'donation' : 'donations'} · <strong style={{ color: 'var(--text)' }}>{inr(total)}</strong></div>
        </div>
        {!rows.length ? <Empty icon="rupee" title="No donations found" text="Donations recorded by the trust will appear here." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Receipt No</th><th>Purpose</th><th>Mode</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="nowrap">{date(d.donated_on)}<div className="cell-sub">FY {d.fy}</div></td>
                    <td className="mono">{d.receipt_no}</td>
                    <td>{d.purpose}</td>
                    <td>{d.mode}{d.reference_no && <div className="cell-sub">{d.reference_no}</div>}</td>
                    <td className="num"><strong>{inr(d.amount)}</strong></td>
                    <td className="right"><Link to={`/receipt/${d.id}`} className="btn btn-sm"><Icon name="printer" size={14} />Receipt</Link></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Total{fy ? ` for FY ${fy}` : ''}</td><td className="num">{inr(total)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
