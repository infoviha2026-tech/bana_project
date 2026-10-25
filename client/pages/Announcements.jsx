import { useState } from 'react';
import { api } from '../api.js';
import { isAdmin, useAuth } from '../auth.jsx';
import Icon from '../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Field, FormModal, Loading, PageHead, Select, useFetch, useUI } from '../components/ui.jsx';
import { dateTime, timeAgo } from '../format.js';

const AUDIENCE = { all: 'Everyone', students: 'Students', donors: 'Donors' };

export function AnnouncementList({ items, onEdit, onDelete, compact }) {
  if (!items.length) return <Empty icon="megaphone" title="No announcements yet" text="News and notices from the trust will appear here." />;
  return items.map((a) => (
    <div className="announcement" key={a.id}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3>{a.pinned ? <Icon name="pin" size={14} style={{ color: 'var(--yellow-600)', marginRight: 6, verticalAlign: -2 }} /> : null}{a.title}</h3>
        {onEdit && (
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn" onClick={() => onEdit(a)} aria-label="Edit"><Icon name="edit" size={16} /></button>
            <button className="icon-btn danger" onClick={() => onDelete(a)} aria-label="Delete"><Icon name="trash" size={16} /></button>
          </div>
        )}
      </div>
      <p style={compact ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}>{a.body}</p>
      <div className="meta">
        <span title={dateTime(a.created_at)}>{timeAgo(a.created_at)}</span>
        {a.author && <span>· {a.author}</span>}
        {onEdit && <Badge tone="blue" plain>{AUDIENCE[a.audience]}</Badge>}
      </div>
    </div>
  ));
}

export default function Announcements() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const { toast, confirm } = useUI();
  const { data, loading, error, reload } = useFetch('/announcements');
  const [editing, setEditing] = useState(null);

  const remove = async (a) => {
    if (!(await confirm({ title: 'Delete announcement?', message: `"${a.title}" will be removed for everyone.`, confirmText: 'Delete', danger: true }))) return;
    try {
      await api.del(`/admin/announcements/${a.id}`);
      toast('Announcement deleted');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="Announcements" subtitle={admin ? 'Share news and notices with students, donors, or everyone.' : 'News and notices from BANA Development Foundation.'}
        actions={admin && <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={16} />New announcement</button>} />
      <div className="card">
        {loading ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> :
          <AnnouncementList items={data} onEdit={admin ? setEditing : null} onDelete={remove} />}
      </div>
      {editing && (
        <FormModal title={editing.id ? 'Edit announcement' : 'New announcement'} submitText={editing.id ? 'Save changes' : 'Publish'} onClose={() => setEditing(null)}
          onSubmit={async (fd) => {
            const body = { title: fd.get('title'), body: fd.get('body'), audience: fd.get('audience'), pinned: fd.get('pinned') === 'on' };
            if (editing.id) await api.put(`/admin/announcements/${editing.id}`, body);
            else await api.post('/admin/announcements', body);
            toast(editing.id ? 'Announcement updated' : 'Announcement published');
            setEditing(null);
            reload();
          }}>
          <div className="stack">
            <Field label="Title" required><input className="input" name="title" defaultValue={editing.title} required maxLength={160} /></Field>
            <Field label="Message" required><textarea className="input" name="body" defaultValue={editing.body} required rows={5} /></Field>
            <Field label="Who should see this?">
              <Select name="audience" defaultValue={editing.audience || 'all'} options={Object.entries(AUDIENCE).map(([value, label]) => ({ value, label }))} />
            </Field>
            <label className="checkbox"><input type="checkbox" name="pinned" defaultChecked={!!editing.pinned} />Pin to the top</label>
          </div>
        </FormModal>
      )}
    </>
  );
}
