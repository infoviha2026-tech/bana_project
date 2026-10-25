import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Empty, ErrorBox, Loading, PageHead, Pager, SearchBox, Select, useUI } from '../../components/ui.jsx';
import { date, inr } from '../../format.js';
import { DonationForm, ExportButton, useList, useMeta } from './common.jsx';

function fyOptions() {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => {
    const y = start - i;
    const v = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    return { value: v, label: `FY ${v}` };
  });
}

export default function Donations() {
  const meta = useMeta();
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const list = useList('/admin/donations', { fy: '', mode: '', purpose: '', from: '', to: '', project_id: params.get('project_id') || '' });
  const { data, loading, error, reload, filters, setFilter } = list;
  const [editing, setEditing] = useState(params.get('new') === '1' ? {} : null);

  const close = () => { setEditing(null); if (params.get('new')) setParams({}, { replace: true }); };

  const remove = async (d) => {
    if (!(await confirm({ title: 'Delete donation?', message: `${inr(d.amount)} from ${d.donor_name} (receipt ${d.receipt_no}) will be removed.`, confirmText: 'Delete', danger: true }))) return;
    try { await api.del(`/admin/donations/${d.id}`); toast('Donation deleted'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="Donations" subtitle="Every contribution received by the trust. Each donation gets a receipt number automatically."
        actions={<>
          <ExportButton type="donations" query={list.exportQuery} />
          <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={16} />Record donation</button>
        </>} />
      <div className="card">
        <div className="filters">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search donor, receipt, reference…" />
          <Select value={filters.fy} onChange={(e) => setFilter('fy', e.target.value)} placeholder="All years" options={fyOptions()} />
          <Select value={filters.mode} onChange={(e) => setFilter('mode', e.target.value)} placeholder="All modes" options={meta?.donationModes || []} />
          <Select value={filters.purpose} onChange={(e) => setFilter('purpose', e.target.value)} placeholder="All purposes" options={meta?.purposes || []} />
          <Select value={filters.project_id} onChange={(e) => setFilter('project_id', e.target.value)} placeholder="All projects" options={(meta?.projects || []).map((p) => ({ value: p.id, label: p.name }))} />
          <input className="input" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} aria-label="From date" />
          <span className="muted small">to</span>
          <input className="input" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} aria-label="To date" />
        </div>
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.rows.length ? (
          <Empty icon="rupee" title="No donations found" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Receipt</th><th>Donor</th><th>Purpose</th><th>Mode</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {data.rows.map((d) => (
                  <tr key={d.id}>
                    <td className="nowrap">{date(d.donated_on)}</td>
                    <td className="mono small"><Link to={`/receipt/${d.id}`}>{d.receipt_no}</Link></td>
                    <td><Link to={`/donors/${d.donor_id}`}>{d.donor_name}</Link><div className="cell-sub">{d.donor_email}</div></td>
                    <td>{d.purpose}{d.project_name && <div className="cell-sub">{d.project_name}</div>}</td>
                    <td>{d.mode}{d.reference_no && <div className="cell-sub">{d.reference_no}</div>}</td>
                    <td className="num"><strong>{inr(d.amount)}</strong></td>
                    <td className="right nowrap">
                      <button className="icon-btn" onClick={() => setEditing(d)} aria-label="Edit"><Icon name="edit" size={16} /></button>
                      <button className="icon-btn danger" onClick={() => remove(d)} aria-label="Delete"><Icon name="trash" size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>Total ({data.total} donations{Object.entries(filters).some(([, v]) => v) ? ', filtered' : ''})</td><td className="num">{inr(data.sum)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={list.setPage} />}
      </div>
      {editing && <DonationForm donation={editing.id ? editing : null} onClose={close} onSaved={() => { close(); reload(); }} />}
    </>
  );
}
