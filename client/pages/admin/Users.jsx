import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Field, FormModal, Loading, Modal, PageHead, SearchBox, Select, formObj, useDebounced, useFetch, useUI } from '../../components/ui.jsx';
import { ROLE_LABEL, dateTime, initials } from '../../format.js';
import { AccountActions } from './common.jsx';

const ROLE_TONE = { super_admin: 'yellow', admin: 'green', donor: 'blue', student: '' };
const ROLES = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));

function StaffForm({ user, onClose, onSaved }) {
  const { toast } = useUI();
  const u = user || {};
  const [created, setCreated] = useState(null);
  if (created) {
    return (
      <Modal title="Account created" onClose={onSaved} footer={<button className="btn btn-primary" onClick={onSaved}>Done</button>}>
        <p>Share these sign-in details with <strong>{created.name}</strong>. They will be asked to change the password on first sign-in.</p>
        <dl className="dl mt" style={{ padding: 14, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <dt>Email</dt><dd>{created.email}</dd>
          <dt>Password</dt><dd style={{ fontFamily: 'ui-monospace, monospace' }}>{created.password}</dd>
        </dl>
      </Modal>
    );
  }
  const staff = !u.id || u.role === 'admin' || u.role === 'super_admin';
  return (
    <FormModal title={u.id ? `Edit ${u.name}` : 'Add staff account'} submitText={u.id ? 'Save changes' : 'Create account'} onClose={onClose}
      onSubmit={async (fd) => {
        const body = formObj(fd);
        if (u.id) {
          await api.put(`/super/users/${u.id}`, body);
          toast('Account updated');
          onSaved();
        } else {
          const r = await api.post('/super/users', body);
          setCreated({ ...body, password: r.password });
        }
      }}>
      <div className="form-grid">
        <Field label="Full name" required full><input className="input" name="name" defaultValue={u.name} required /></Field>
        <Field label="Email" required={staff || u.role === 'donor'}><input className="input" type="email" name="email" defaultValue={u.email || ''} required={staff || u.role === 'donor'} /></Field>
        <Field label="Phone"><input className="input" name="phone" defaultValue={u.phone || ''} /></Field>
        {staff && (
          <Field label="Role" full hint="Admins manage students, donors, and data. Super Admins also manage accounts, settings, and the audit log.">
            <Select name="role" defaultValue={u.role || 'admin'} options={[{ value: 'admin', label: 'Admin (staff)' }, { value: 'super_admin', label: 'Super Admin' }]} />
          </Field>
        )}
        {!u.id && <Field label="Initial password" hint="Leave blank to use the default password" full><input className="input" name="password" autoComplete="new-password" /></Field>}
      </div>
    </FormModal>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const { toast, confirm } = useUI();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useFetch(`/super/users${qs({ role, q: dq })}`);
  const [editing, setEditing] = useState(null);
  const [manage, setManage] = useState(null);

  const remove = async (u) => {
    if (!(await confirm({ title: `Delete ${u.name}?`, message: 'This permanently deletes the account and any linked student or donor records. This cannot be undone.', confirmText: 'Delete permanently', danger: true }))) return;
    try { await api.del(`/super/users/${u.id}`); toast('Account deleted'); setManage(null); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  const counts = (data || []).reduce((m, u) => ({ ...m, [u.role]: (m[u.role] || 0) + 1 }), {});

  return (
    <>
      <PageHead title="Users & Roles" subtitle="Every account that can sign in to the portal. Only Super Admins can see this page."
        actions={<button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={16} />Add staff account</button>} />
      <div className="card">
        <div className="filters">
          <SearchBox value={q} onChange={setQ} placeholder="Search name, email, Student ID…" />
          <Select value={role} onChange={(e) => setRole(e.target.value)} placeholder="All roles" options={ROLES} />
          <div style={{ flex: 1 }} />
          <div className="row wrap small">{ROLES.map((r) => counts[r.value] ? <Badge key={r.value} tone={ROLE_TONE[r.value]} plain>{counts[r.value]} {r.label}{counts[r.value] > 1 ? 's' : ''}</Badge> : null)}</div>
        </div>
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.length ? <Empty icon="users" title="No accounts found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Sign-in</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id}>
                    <td><div className="person"><div className="avatar">{initials(u.name)}</div><div><div className="cell-main">{u.name}{u.id === me.id && <span className="faint"> (you)</span>}</div><div className="cell-sub">{u.phone}</div></div></div></td>
                    <td>{u.email || '—'}{u.student_code && <div className="cell-sub">{u.student_code}</div>}</td>
                    <td><Badge tone={ROLE_TONE[u.role]} plain>{ROLE_LABEL[u.role]}</Badge></td>
                    <td>
                      {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}
                      {u.locked_until && new Date(u.locked_until) > new Date() && <> <Badge tone="amber">Locked</Badge></>}
                      {u.must_change_password ? <div className="cell-sub">Temp password</div> : null}
                      {u.totp_enabled ? <div className="cell-sub"><Icon name="lock" size={11} style={{ verticalAlign: -1 }} /> 2-step on</div> : (u.role === 'admin' || u.role === 'super_admin') ? <div className="cell-sub" style={{ color: 'var(--amber)' }}>2-step off</div> : null}
                    </td>
                    <td className="nowrap small">{u.last_login_at ? dateTime(u.last_login_at) : <span className="faint">Never</span>}</td>
                    <td className="right nowrap">
                      <button className="icon-btn" onClick={() => setEditing(u)} aria-label="Edit"><Icon name="edit" size={16} /></button>
                      {u.id !== me.id && <button className="btn btn-sm" onClick={() => setManage(u)}>Manage</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <StaffForm user={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {manage && (
        <Modal title={`Manage ${manage.name}`} onClose={() => setManage(null)}>
          <p className="muted" style={{ marginBottom: 16 }}>{ROLE_LABEL[manage.role]} · {manage.email || manage.student_code}</p>
          {(manage.role === 'student' || manage.role === 'donor') && (
            <p className="small" style={{ marginBottom: 16 }}>To edit profile details, open the <Link to={manage.role === 'student' ? '/students' : '/donors'} onClick={() => setManage(null)}>{manage.role === 'student' ? 'Students' : 'Donors'}</Link> page.</p>
          )}
          <div className="row wrap">
            {manage.locked_until && new Date(manage.locked_until) > new Date() && (
              <button className="btn" onClick={async () => {
                try { await api.post(`/super/users/${manage.id}/unlock`); toast('Account unlocked'); setManage(null); reload(); } catch (e) { toast(e.message, 'error'); }
              }}><Icon name="key" size={16} />Unlock</button>
            )}
            {manage.totp_enabled ? (
              <button className="btn" onClick={async () => {
                if (!(await confirm({ title: `Turn off 2-step verification for ${manage.name}?`, message: 'Use this if they lost their phone. They will be signed out and can set it up again.', confirmText: 'Turn off', danger: true }))) return;
                try { await api.post(`/super/users/${manage.id}/reset-2fa`); toast('2-step verification turned off'); setManage(null); reload(); } catch (e) { toast(e.message, 'error'); }
              }}><Icon name="phone2" size={16} />Reset 2-step</button>
            ) : null}
            <AccountActions userId={manage.id} name={manage.name} active={!!manage.is_active} onChanged={() => { setManage(null); reload(); }} onDelete={() => remove(manage)} />
          </div>
        </Modal>
      )}
    </>
  );
}
