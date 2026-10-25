import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { StudentPhoto } from '../../components/Media.jsx';
import { Badge, Empty, ErrorBox, Field, FormModal, Loading, PageHead, Pager, SearchBox, Select, useUI } from '../../components/ui.jsx';
import { inr } from '../../format.js';
import { ExportButton, StudentForm, useList, useMeta } from './common.jsx';

export function MessageModal({ title, count, onClose, onSend }) {
  return (
    <FormModal title={title} submitText={`Send to ${count}`} onClose={onClose} onSubmit={async (fd) => onSend({
      title: fd.get('title'), body: fd.get('body'), email: fd.get('email') === 'on', sms: fd.get('sms') === 'on',
    })}>
      <div className="stack">
        <Field label="Title" required><input className="input" name="title" required maxLength={160} /></Field>
        <Field label="Message" required><textarea className="input" name="body" required rows={5} maxLength={2000} /></Field>
        <div className="row wrap" style={{ gap: 18 }}>
          <span className="small muted">Always sent in the portal (bell icon). Also send by:</span>
          <label className="checkbox"><input type="checkbox" name="email" />Email</label>
          <label className="checkbox"><input type="checkbox" name="sms" />SMS</label>
        </div>
      </div>
    </FormModal>
  );
}

function BulkBar({ ids, onDone, onClear }) {
  const meta = useMeta();
  const { toast, confirm } = useUI();
  const [modal, setModal] = useState(null);
  const run = async (body, msg) => {
    try {
      const r = await api.post('/admin/students/bulk', { ids, ...body });
      toast(`${msg}: ${r.changed} student${r.changed === 1 ? '' : 's'}`);
      setModal(null);
      onDone();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="row wrap" style={{ padding: '10px 16px', background: 'var(--green-50)', borderBottom: '1px solid var(--green-100)', gap: 8 }}>
      <strong>{ids.length} selected</strong>
      <button className="btn btn-sm" onClick={async () => {
        if (await confirm({ title: `Promote ${ids.length} students?`, message: 'Each student moves to the next class (9th → 10th, Inter 1st Year → Inter 2nd Year). You can edit anyone afterwards.', confirmText: 'Promote' })) run({ action: 'promote' }, 'Promoted');
      }}><Icon name="trending" size={14} />Promote to next class</button>
      <button className="btn btn-sm" onClick={() => setModal('status')}><Icon name="edit" size={14} />Change status</button>
      <button className="btn btn-sm" onClick={() => setModal('message')}><Icon name="mail" size={14} />Send message</button>
      <button className="btn btn-sm btn-ghost" onClick={onClear}>Clear selection</button>
      {modal === 'status' && (
        <FormModal title={`Change status of ${ids.length} students`} submitText="Apply" onClose={() => setModal(null)} onSubmit={(fd) => run({ action: 'status', status: fd.get('status') }, 'Updated')}>
          <Field label="New status"><Select name="status" options={meta?.studentStatuses || []} /></Field>
        </FormModal>
      )}
      {modal === 'message' && <MessageModal title={`Message ${ids.length} students`} count={ids.length} onClose={() => setModal(null)} onSend={(b) => run({ action: 'message', ...b }, 'Sent')} />}
    </div>
  );
}

export default function Students() {
  const navigate = useNavigate();
  const meta = useMeta();
  const list = useList('/admin/students', { status: '', programme: '', village: '' });
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const { data, loading, error, reload, filters, setFilter } = list;
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPage = data?.rows.length > 0 && data.rows.every((r) => selected.has(r.id));

  return (
    <>
      <PageHead title="Students" subtitle="Everyone the trust supports. Tick students for bulk actions, or click one to see their full record."
        actions={<>
          <ExportButton type="students" query={list.exportQuery} />
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add student</button>
        </>} />
      <div className="card">
        <div className="filters">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search name, ID, village, school…" />
          <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} placeholder="All statuses" options={meta?.studentStatuses || []} />
          <Select value={filters.programme} onChange={(e) => setFilter('programme', e.target.value)} placeholder="All programmes" options={meta?.programmes || []} />
        </div>
        {selected.size > 0 && <BulkBar ids={[...selected]} onDone={() => { setSelected(new Set()); reload(); }} onClear={() => setSelected(new Set())} />}
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.rows.length ? (
          <Empty icon="graduation" title="No students found" text={filters.q || filters.status || filters.programme ? 'Try a different search or filter.' : 'Add students one by one, or import them from Excel.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); data.rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n; })} /></th>
                <th>Student</th><th>School / Class</th><th>Village</th><th>Programme</th><th>Certificates</th><th className="num">Aid received</th><th>Status</th>
              </tr></thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => navigate(`/students/${s.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
                    <td>
                      <div className="person">
                        <StudentPhoto studentId={s.id} name={s.name} hasPhoto={!!s.photo_path} size={30} />
                        <div><div className="cell-main">{s.name}</div><div className="cell-sub">{s.student_code}{!s.is_active && ' · login disabled'}</div></div>
                      </div>
                    </td>
                    <td>{s.school || '—'}<div className="cell-sub">{s.class_year}</div></td>
                    <td>{s.village || '—'}</td>
                    <td className="small">{s.programme || '—'}</td>
                    <td>{s.cert_count}{s.pending_certs > 0 && <> <Badge tone="amber">{s.pending_certs} pending</Badge></>}</td>
                    <td className="num">{inr(s.aid_total)}</td>
                    <td><Badge>{s.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={list.setPage} />}
      </div>
      {adding && <StudentForm onClose={() => setAdding(false)} onSaved={(out) => { setAdding(false); navigate(`/students/${out.id}`); }} />}
    </>
  );
}
