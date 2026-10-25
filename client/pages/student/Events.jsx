import Icon from '../../components/Icons.jsx';
import { Empty, ErrorBox, Loading, PageHead, useFetch } from '../../components/ui.jsx';
import { date } from '../../format.js';
import { useT } from '../../i18n.jsx';

export default function StudentEvents() {
  const t = useT();
  const { data, loading, error, reload } = useFetch('/student/events');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title={t('Events')} subtitle={t('Celebrations, camps, and activities organised by the trust.')} />
      <h2 style={{ marginBottom: 12 }}>{t('Upcoming events')}</h2>
      {!data.upcoming.length ? <div className="card"><Empty icon="calendar" title={t('No upcoming events')} /></div> : (
        <div className="grid grid-2">
          {data.upcoming.map((e) => {
            const d = new Date(`${e.event_date}T00:00:00`);
            return (
              <div className="card card-pad row" key={e.id} style={{ alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 58, flexShrink: 0, textAlign: 'center', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ background: 'var(--green-800)', color: 'var(--yellow)', fontSize: 11, fontWeight: 800, padding: 3 }}>{d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, padding: 4 }}>{d.getDate()}</div>
                </div>
                <div>
                  <h3>{e.title}</h3>
                  {e.location && <div className="small muted"><Icon name="mapPin" size={13} style={{ verticalAlign: -2 }} /> {e.location}</div>}
                  {e.description && <p className="small" style={{ marginTop: 6 }}>{e.description}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <h2 style={{ margin: '28px 0 12px' }}>{t('Events I attended')}</h2>
      <div className="card">
        {!data.attended.length ? <Empty icon="calendar" title={t('No events yet')} /> : data.attended.map((e) => (
          <div className="list-item" key={e.id}>
            <div className="file-icon"><Icon name="checkCircle" /></div>
            <div className="grow"><div className="title">{e.title}</div><div className="cell-sub">{date(e.event_date)}{e.location ? ` · ${e.location}` : ''}</div></div>
          </div>
        ))}
      </div>
    </>
  );
}
