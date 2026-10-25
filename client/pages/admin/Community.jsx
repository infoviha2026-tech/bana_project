import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import ResourcePage, { ResourceForm } from '../../components/Resource.jsx';
import { BarChart } from '../../components/Charts.jsx';
import { Badge, Empty, ErrorBox, Loading, Modal, PageHead, SearchBox, Stat, useFetch, useUI } from '../../components/ui.jsx';
import { date, inr, inrShort, num } from '../../format.js';
import { useMeta } from './common.jsx';
import { ProjectProgress } from '../donor/Projects.jsx';

/* ---------------- Events ---------------- */

const eventFields = (meta) => [
  { name: 'title', label: 'Title', required: true, full: true, max: 150 },
  { name: 'event_date', label: 'Date', type: 'date', required: true },
  { name: 'location', label: 'Location', max: 150 },
  { name: 'status', label: 'Status', type: 'select', options: meta?.eventStatuses || ['Upcoming'], required: true },
  { name: 'notify_students', label: 'Notify', type: 'checkbox', default: false, checkLabel: 'Notify all active students (new events only)' },
  { name: 'description', label: 'Description', type: 'textarea', max: 3000 },
];

export function Events() {
  const meta = useMeta();
  const navigate = useNavigate();
  return (
    <ResourcePage title="Events" subtitle="Celebrations, camps, and workshops. Mark which students attended and log volunteer hours."
      endpoint="/admin/events" itemLabel="event" newLabel="New event" onRowClick={(r) => navigate(`/events/${r.id}`)}
      filters={[{ key: 'status', placeholder: 'All statuses', options: meta?.eventStatuses || [] }]}
      columns={[
        { key: 'event_date', label: 'Date', render: (r) => <span className="nowrap">{date(r.event_date)}</span> },
        { key: 'title', label: 'Event', render: (r) => <><strong>{r.title}</strong><div className="cell-sub">{r.location}</div></> },
        { key: 'status', label: 'Status', render: (r) => <Badge tone={{ Upcoming: 'blue', Completed: 'green', Cancelled: 'red' }[r.status]}>{r.status}</Badge> },
        { key: 'attendees', label: 'Students', num: true },
        { key: 'volunteer_hours', label: 'Volunteer hrs', num: true },
      ]}
      fields={eventFields(meta)} />
  );
}

function AttendeePicker({ event, onClose, onSaved }) {
  const { toast } = useUI();
  const students = useFetch('/admin/students?pageSize=200&status=Active').data;
  const [picked, setPicked] = useState(() => new Set(event.attendeeList.map((a) => a.id)));
  const [q, setQ] = useState('');
  const rows = (students?.rows || []).filter((s) => !q || `${s.name} ${s.student_code} ${s.village}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal wide title={`Who attended ${event.title}?`} onClose={onClose}
      footer={<>
        <span className="small muted" style={{ marginRight: 'auto' }}>{picked.size} selected</span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={async () => {
          try { await api.put(`/admin/events/${event.id}/attendees`, { student_ids: [...picked] }); toast('Attendance saved'); onSaved(); } catch (e) { toast(e.message, 'error'); }
        }}>Save attendance</button>
      </>}>
      <div className="row" style={{ marginBottom: 10 }}>
        <div style={{ flex: 1 }}><SearchBox value={q} onChange={setQ} placeholder="Filter by name, ID, village…" /></div>
        <button className="btn btn-sm" onClick={() => setPicked(new Set(rows.map((s) => s.id)))}>Select all shown</button>
        <button className="btn btn-sm" onClick={() => setPicked(new Set())}>Clear</button>
      </div>
      {!students ? <Loading /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
          {rows.map((s) => (
            <label key={s.id} className="checkbox" style={{ padding: '7px 10px', border: `1px solid ${picked.has(s.id) ? 'var(--green-600)' : 'var(--border)'}`, borderRadius: 8, background: picked.has(s.id) ? 'var(--green-50)' : undefined }}>
              <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
              <span><strong>{s.name}</strong><div className="cell-sub">{s.student_code} · {s.village}</div></span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

const hoursFields = [
  { name: 'volunteer_id', label: 'Volunteer', type: 'volunteer', required: true },
  { name: 'event_id', label: 'Event', type: 'event' },
  { name: 'worked_on', label: 'Date', type: 'date', required: true, default: 'today' },
  { name: 'hours', label: 'Hours', type: 'number', min: 0.25, maxValue: 24, step: 0.25, required: true },
  { name: 'activity', label: 'What they did', full: true, max: 200 },
];

export function EventDetail() {
  const { id } = useParams();
  const meta = useMeta();
  const { data: e, loading, error, reload } = useFetch(`/admin/events/${id}`);
  const [modal, setModal] = useState(null);
  if (loading && !e) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead back={{ to: '/events', label: 'All events' }} title={e.title} subtitle={`${date(e.event_date)}${e.location ? ` · ${e.location}` : ''}`}
        actions={<>
          <button className="btn" onClick={() => setModal('attend')}><Icon name="users" size={16} />Mark attendance</button>
          <button className="btn btn-primary" onClick={() => setModal('edit')}><Icon name="edit" size={16} />Edit</button>
        </>} />
      {e.description && <div className="card card-pad" style={{ marginBottom: 16 }}><p style={{ whiteSpace: 'pre-wrap' }}>{e.description}</p></div>}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h2>Students attended ({e.attendeeList.length})</h2></div>
          {!e.attendeeList.length ? <Empty icon="users" title="No attendance marked yet" action={<button className="btn btn-primary" onClick={() => setModal('attend')}>Mark attendance</button>} /> : (
            <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {e.attendeeList.map((s) => <Link key={s.id} to={`/students/${s.id}`} className="badge plain" style={{ fontSize: 12.5, padding: '4px 10px' }}>{s.name}</Link>)}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Volunteer hours</h2><button className="btn btn-sm btn-primary" onClick={() => setModal('hours')}><Icon name="plus" size={14} />Log hours</button></div>
          {!e.hoursList.length ? <Empty icon="clock" title="No hours logged" /> : e.hoursList.map((h) => (
            <div className="list-item" key={h.id}><div className="grow"><div className="title">{h.volunteer_name}</div><div className="cell-sub">{h.activity}</div></div><strong>{h.hours} h</strong></div>
          ))}
        </div>
      </div>
      {modal === 'attend' && <AttendeePicker event={e} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'edit' && <ResourceForm title="Edit event" endpoint="/admin/events" fields={eventFields(meta).filter((f) => f.name !== 'notify_students')} row={e} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'hours' && <ResourceForm title="Log volunteer hours" endpoint="/admin/volunteer-hours" fields={hoursFields} row={{ event_id: e.id, worked_on: e.event_date }} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </>
  );
}

/* ---------------- Volunteers ---------------- */

function VolunteerHours({ volunteer, onClose }) {
  const { data, reload } = useFetch(`/admin/volunteers/${volunteer.id}`);
  const [adding, setAdding] = useState(false);
  return (
    <Modal wide title={volunteer.name} onClose={onClose}>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="muted small">{[volunteer.phone, volunteer.email, volunteer.skills].filter(Boolean).join(' · ')}</span>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Log hours</button>
      </div>
      {!data ? <Loading /> : !data.hours.length ? <Empty icon="clock" title="No hours logged yet" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Activity</th><th>Event</th><th className="num">Hours</th></tr></thead>
          <tbody>{data.hours.map((h) => <tr key={h.id}><td className="nowrap">{date(h.worked_on)}</td><td>{h.activity || '—'}</td><td>{h.event_title || '—'}</td><td className="num">{h.hours}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}>Total</td><td className="num">{data.total_hours}</td></tr></tfoot>
        </table></div>
      )}
      {adding && <ResourceForm title="Log hours" endpoint="/admin/volunteer-hours" fields={hoursFields} row={{ volunteer_id: volunteer.id }} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </Modal>
  );
}

export function Volunteers() {
  const [open, setOpen] = useState(null);
  return (
    <>
      <ResourcePage title="Volunteers" subtitle="People who give their time — tutors, doctors, event helpers. Click a volunteer to see and log their hours."
        endpoint="/admin/volunteers" exportType="volunteers" itemLabel="volunteer" newLabel="Add volunteer" onRowClick={setOpen}
        searchPlaceholder="Search name, skill, village…"
        filters={[{ key: 'active', placeholder: 'Active and inactive', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }] }]}
        columns={[
          { key: 'name', label: 'Volunteer', render: (r) => <><strong>{r.name}</strong><div className="cell-sub">{r.phone || r.email || '—'}</div></> },
          { key: 'skills', label: 'Skills' },
          { key: 'village', label: 'Village' },
          { key: 'last_active', label: 'Last active', render: (r) => date(r.last_active) },
          { key: 'active', label: 'Status', render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
          { key: 'total_hours', label: 'Hours', num: true },
        ]}
        fields={[
          { name: 'name', label: 'Name', required: true, max: 120 },
          { name: 'phone', label: 'Phone', type: 'tel' },
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'village', label: 'Village / city', max: 100 },
          { name: 'joined_on', label: 'Joined on', type: 'date' },
          { name: 'active', label: 'Active', type: 'checkbox', checkLabel: 'Currently volunteering' },
          { name: 'skills', label: 'Skills', full: true, max: 200 },
        ]} />
      {open && <VolunteerHours volunteer={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/* ---------------- Villages ---------------- */

export function Villages() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch('/admin/villages');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title="Villages" subtitle="Everything the trust does, grouped by village." />
      {!data.length ? <div className="card"><Empty icon="mapPin" title="No villages yet" text="Villages come from student, project, and volunteer records." /></div> : (
        <div className="grid grid-3">
          {data.map((v) => (
            <button key={v.village} className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate(`/villages/${encodeURIComponent(v.village)}`)}>
              <div className="row" style={{ justifyContent: 'space-between' }}><h3><Icon name="mapPin" size={16} style={{ verticalAlign: -2, color: 'var(--green-700)' }} /> {v.village}</h3><Icon name="chevronRight" size={16} /></div>
              <div className="grid grid-2" style={{ gap: 10, marginTop: 14 }}>
                <div><div className="small muted">Students</div><strong style={{ fontSize: 18 }}>{v.students.active}</strong><span className="small muted"> / {v.students.n}</span></div>
                <div><div className="small muted">Aid given</div><strong style={{ fontSize: 18 }}>{inrShort(v.aid)}</strong></div>
                <div><div className="small muted">Projects</div><strong style={{ fontSize: 18 }}>{v.projects}</strong></div>
                <div><div className="small muted">Raised</div><strong style={{ fontSize: 18 }}>{inrShort(v.raised)}</strong></div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function VillageDetail() {
  const { name } = useParams();
  const { data, loading, error, reload } = useFetch(`/admin/villages/${encodeURIComponent(name)}`);
  const stats = useMemo(() => data && {
    active: data.students.filter((s) => s.status === 'Active').length,
    aid: data.students.reduce((a, s) => a + s.aid_total, 0),
    raised: data.projects.reduce((a, p) => a + p.raised, 0),
  }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead back={{ to: '/villages', label: 'All villages' }} title={data.village} />
      <div className="grid grid-4">
        <Stat icon="graduation" label="Active students" value={num(stats.active)} sub={`${data.students.length} total`} />
        <Stat icon="heart" tone="yellow" label="Aid given" value={inrShort(stats.aid)} />
        <Stat icon="village" tone="blue" label="Projects" value={data.projects.length} sub={`${inrShort(stats.raised)} raised`} />
        <Stat icon="users" label="Volunteers" value={data.volunteers.length} />
      </div>
      <div className="grid grid-main mt">
        <div className="card">
          <div className="card-head"><h2>Students</h2></div>
          {!data.students.length ? <Empty icon="graduation" title="No students from this village" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Student</th><th>School / Class</th><th>Status</th><th className="num">Aid</th></tr></thead>
              <tbody>{data.students.map((s) => (
                <tr key={s.id}><td><Link to={`/students/${s.id}`}><strong>{s.name}</strong></Link><div className="cell-sub">{s.student_code}</div></td><td>{s.school}<div className="cell-sub">{s.class_year}</div></td><td><Badge>{s.status}</Badge></td><td className="num">{inr(s.aid_total)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <div className="stack">
          {data.aidByYear.length > 0 && (
            <div className="card"><div className="card-head"><h2>Aid by year</h2></div><div className="card-body"><BarChart data={data.aidByYear.map((a) => ({ label: a.year, value: a.total }))} height={170} /></div></div>
          )}
          {data.projects.map((p) => (
            <Link to={`/projects/${p.id}`} key={p.id} className="card card-pad" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><strong>{p.name}</strong><Badge plain>{p.status}</Badge></div>
              <ProjectProgress p={p} />
            </Link>
          ))}
          {data.volunteers.length > 0 && (
            <div className="card"><div className="card-head"><h2>Volunteers</h2></div>{data.volunteers.map((v) => <div className="list-item" key={v.id}><div className="grow"><div className="title">{v.name}</div><div className="cell-sub">{v.skills}</div></div></div>)}</div>
          )}
        </div>
      </div>
    </>
  );
}
