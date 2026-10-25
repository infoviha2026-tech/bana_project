import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, Pager, SearchBox, Select, useUI } from '../../components/ui.jsx';
import { date, inr } from '../../format.js';
import { AidForm, ExportButton, useList, useMeta } from './common.jsx';

export default function Aid() {
  const meta = useMeta();
  const { toast, confirm } = useUI();
  const list = useList('/admin/aid', { type: '', from: '', to: '' });
  const { data, loading, error, reload, filters, setFilter } = list;
  const [editing, setEditing] = useState(null);

  const remove = async (a) => {
    if (!(await confirm({ title: 'Delete this record?', message: `${a.type} of ${inr(a.amount)} to ${a.student_name} will be removed.`, confirmText: 'Delete', danger: true }))) return;
    try { await api.del(`/admin/aid/${a.id}`); toast('Record deleted'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="Aid & Scholarships" subtitle="Money and support given to students — scholarships, fees, books, and uniforms."
        actions={<>
          <ExportButton type="aid" query={list.exportQuery} />
          <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={16} />Record support</button>
        </>} />
      <div className="card">
        <div className="filters">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search student or notes…" />
          <Select value={filters.type} onChange={(e) => setFilter('type', e.target.value)} placeholder="All types" options={meta?.aidTypes || []} />
          <input className="input" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} aria-label="From date" />
          <span className="muted small">to</span>
          <input className="input" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} aria-label="To date" />
        </div>
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.rows.length ? (
          <Empty icon="heart" title="No records found" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Student</th><th>Type</th><th>Notes</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {data.rows.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{date(a.given_on)}</td>
                    <td><Link to={`/students/${a.student_id}`}>{a.student_name}</Link><div className="cell-sub">{a.student_code}</div></td>
                    <td><Badge tone="green" plain>{a.type}</Badge></td>
                    <td className="muted">{a.notes || '—'}</td>
                    <td className="num">{inr(a.amount)}</td>
                    <td className="right nowrap">
                      <button className="icon-btn" onClick={() => setEditing(a)} aria-label="Edit"><Icon name="edit" size={16} /></button>
                      <button className="icon-btn danger" onClick={() => remove(a)} aria-label="Delete"><Icon name="trash" size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Total ({data.total} records)</td><td className="num">{inr(data.sum)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={list.setPage} />}
      </div>
      {editing && <AidForm aid={editing.id ? editing : null} studentId={editing.student_id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}
