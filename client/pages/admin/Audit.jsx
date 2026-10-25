import { useEffect, useState } from 'react';
import { qs } from '../../api.js';
import { Badge, Empty, ErrorBox, Loading, PageHead, Pager, SearchBox, Select, useDebounced, useFetch } from '../../components/ui.jsx';
import { ROLE_LABEL, dateTime } from '../../format.js';

const TONE = (a) => (a.startsWith('delete') || a === 'deactivate' || a.endsWith('rejected') ? 'red' : a.startsWith('create') || a.endsWith('verified') || a === 'import' ? 'green' : a === 'login' ? '' : 'blue');
const ENTITIES = ['student', 'donor', 'donation', 'aid', 'certificate', 'announcement', 'user', 'settings'];

function details(raw) {
  if (!raw) return '';
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' · ');
    return String(v);
  } catch { return raw; }
}

export default function Audit() {
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, action, entity]);
  const { data, loading, error, reload } = useFetch(`/super/audit${qs({ q: dq, action, entity, page })}`);

  return (
    <>
      <PageHead title="Audit Log" subtitle="Every sign-in, change, import, and deletion — who did it and when." />
      <div className="card">
        <div className="filters">
          <SearchBox value={q} onChange={setQ} placeholder="Search person or details…" />
          <Select value={action} onChange={(e) => setAction(e.target.value)} placeholder="All actions" options={(data?.actions || []).map((a) => ({ value: a, label: a.replace(/_/g, ' ') }))} />
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="All records" options={ENTITIES} />
        </div>
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.rows.length ? <Empty icon="history" title="No activity found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap small">{dateTime(r.created_at)}</td>
                    <td>{r.user_name || <span className="faint">deleted user</span>}{r.user_role && <div className="cell-sub">{ROLE_LABEL[r.user_role]}</div>}</td>
                    <td><Badge tone={TONE(r.action)} plain>{r.action.replace(/_/g, ' ')}</Badge></td>
                    <td className="small">{r.entity ? `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` : '—'}</td>
                    <td className="small muted" style={{ maxWidth: 360 }}>{details(r.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>
    </>
  );
}
