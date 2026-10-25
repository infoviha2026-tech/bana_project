import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, Pager, SearchBox, Select } from '../../components/ui.jsx';
import { date, inr, initials } from '../../format.js';
import { DonorForm, ExportButton, useList, useMeta } from './common.jsx';

export default function Donors() {
  const navigate = useNavigate();
  const meta = useMeta();
  const list = useList('/admin/donors', { donor_type: '' });
  const { data, loading, error, reload, filters, setFilter } = list;
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHead title="Donors" subtitle="Trustees, individuals, and organisations who support the foundation."
        actions={<>
          <ExportButton type="donors" query={list.exportQuery} />
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add donor</button>
        </>} />
      <div className="card">
        <div className="filters">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search name, email, phone, city, PAN…" />
          <Select value={filters.donor_type} onChange={(e) => setFilter('donor_type', e.target.value)} placeholder="All donor types" options={meta?.donorTypes || []} />
        </div>
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.rows.length ? (
          <Empty icon="users" title="No donors found" text={filters.q ? 'Try a different search.' : 'Add donors one by one, or import them from Excel.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Donor</th><th>Contact</th><th>Type</th><th>Donations</th><th>Last donation</th><th className="num">Total given</th></tr></thead>
              <tbody>
                {data.rows.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => navigate(`/donors/${d.id}`)}>
                    <td>
                      <div className="person">
                        <div className="avatar">{initials(d.name)}</div>
                        <div><div className="cell-main">{d.name}</div><div className="cell-sub">{d.city || '—'}{!d.is_active && ' · login disabled'}</div></div>
                      </div>
                    </td>
                    <td>{d.email}<div className="cell-sub">{d.phone}</div></td>
                    <td><Badge tone={d.donor_type === 'Trustee' ? 'yellow' : d.donor_type === 'Organisation' ? 'blue' : ''} plain>{d.donor_type}</Badge></td>
                    <td>{d.donation_count}</td>
                    <td className="nowrap">{date(d.last_donation)}</td>
                    <td className="num"><strong>{inr(d.total_donated)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>Total from {data.total} donors</td><td className="num">{inr(data.sum)}</td></tr></tfoot>
            </table>
          </div>
        )}
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={list.setPage} />}
      </div>
      {adding && <DonorForm onClose={() => setAdding(false)} onSaved={(out) => { setAdding(false); navigate(`/donors/${out.id}`); }} />}
    </>
  );
}
