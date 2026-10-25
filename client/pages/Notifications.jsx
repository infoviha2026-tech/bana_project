import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icons.jsx';
import { Empty, ErrorBox, Loading, PageHead, useFetch } from '../components/ui.jsx';
import { dateTime } from '../format.js';
import { useT } from '../i18n.jsx';

export default function Notifications() {
  const t = useT();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch('/notifications');
  const open = async (n) => {
    if (!n.read_at) await api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
    if (n.link) navigate(n.link); else reload();
  };
  return (
    <>
      <PageHead title={t('Notifications')}
        actions={data?.unread > 0 && <button className="btn" onClick={async () => { await api.post('/notifications/read', { all: true }); reload(); }}><Icon name="check" size={16} />{t('Mark all read')}</button>} />
      <div className="card">
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.rows.length
          ? <Empty icon="bell" title={t('You have no notifications yet.')} />
          : data.rows.map((n) => (
            <button key={n.id} className="list-item" onClick={() => open(n)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border)', background: n.read_at ? 'transparent' : 'var(--green-50)', cursor: 'pointer' }}>
              <div className="file-icon"><Icon name="bell" /></div>
              <div className="grow">
                <div className="title" style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</div>
                {n.body && <div className="cell-sub" style={{ whiteSpace: 'normal' }}>{n.body}</div>}
              </div>
              <span className="small faint nowrap">{dateTime(n.created_at)}</span>
            </button>
          ))}
      </div>
    </>
  );
}
