import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Loading, Stat, useFetch } from '../../components/ui.jsx';
import { AnnouncementList } from '../Announcements.jsx';
import { date, inr, timeAgo } from '../../format.js';
import { useT } from '../../i18n.jsx';

export default function StudentDashboard() {
  const { user } = useAuth();
  const t = useT();
  const { data, loading, error, reload } = useFetch('/student/dashboard');
  const checklist = useFetch('/student/checklist').data;
  const scholarships = useFetch('/student/scholarships').data;
  const events = useFetch('/student/events').data;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const c = data.certificates;
  const openCalls = scholarships?.open.filter((x) => !x.applied_id) || [];

  return (
    <>
      <div className="hero">
        <div className="eyebrow">{t('Student portal')} · {user.student_code}</div>
        <h1>{t('Hello')}, <em>{user.name.split(' ')[0]}</em></h1>
        <p>{t('Keep your certificates up to date so the trust can support your next step.')}</p>
        <div className="hero-actions">
          <Link to="/certificates?upload=1" className="btn btn-yellow"><Icon name="upload" size={16} />{t('Upload a certificate')}</Link>
          <Link to="/progress" className="btn btn-ghost-light"><Icon name="trending" size={16} />{t('My Progress')}</Link>
        </div>
      </div>

      {openCalls.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <Icon name="sparkle" />
          <div style={{ flex: 1 }}><strong>{t('Scholarship open')}: {openCalls[0].title}</strong> — {t('apply before {date}', { date: date(openCalls[0].deadline) })}</div>
          <Link to="/scholarships" className="btn btn-sm">{t('Apply')}</Link>
        </div>
      )}

      <div className="grid grid-4">
        <Stat icon="checkCircle" label={t('Verified certificates')} value={c.Verified} />
        <Stat icon="clock" tone="yellow" label={t('Waiting for review')} value={c.Pending} />
        <Stat icon="xCircle" tone="red" label={t('Need re-upload')} value={c.Rejected} sub={c.Rejected ? t('See remarks') : null} />
        <Stat icon="heart" tone="blue" label={t('Support received')} value={inr(data.aid.total)} sub={t('{n} payments', { n: data.aid.n })} />
      </div>

      <div className="grid grid-main mt">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>{t('Recent certificates')}</h2><Link to="/certificates" className="small">{t('View all')}</Link></div>
            {data.recentCertificates.length ? data.recentCertificates.map((x) => (
              <div className="list-item" key={x.id}>
                <div className="file-icon"><Icon name="award" /></div>
                <div className="grow"><div className="title">{x.title}</div><div className="cell-sub">{t(x.category)} · {timeAgo(x.created_at)}</div></div>
                <Badge tone={{ Verified: 'green', Pending: 'amber', Rejected: 'red' }[x.status]}>{t(x.status)}</Badge>
              </div>
            )) : <Empty icon="award" title={t('No certificates yet')} text={t('Upload your marksheets and achievement certificates.')} action={<Link className="btn btn-primary" to="/certificates?upload=1">{t('Upload now')}</Link>} />}
          </div>
          {events?.upcoming.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>{t('Upcoming events')}</h2><Link to="/events" className="small">{t('View all')}</Link></div>
              {events.upcoming.slice(0, 3).map((e) => (
                <div className="list-item" key={e.id}>
                  <div className="file-icon"><Icon name="calendar" /></div>
                  <div className="grow"><div className="title">{e.title}</div><div className="cell-sub">{date(e.event_date)}{e.location ? ` · ${e.location}` : ''}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="stack">
          {checklist?.total > 0 && (
            <div className="card card-pad">
              <div className="row" style={{ justifyContent: 'space-between' }}><h3>{t('Documents')}</h3><strong>{checklist.done} / {checklist.total}</strong></div>
              <div className="progress" style={{ marginTop: 10 }}><div style={{ width: `${(checklist.done / checklist.total) * 100}%` }} /></div>
              <p className="small muted" style={{ marginTop: 10 }}>{checklist.done === checklist.total ? t('All required documents are verified.') : <Link to="/certificates">{t('See which documents are still needed')}</Link>}</p>
            </div>
          )}
          <div className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between' }}><h3>{t('Profile completion')}</h3><strong>{data.profileCompletion}%</strong></div>
            <div className="progress" style={{ marginTop: 10 }}><div style={{ width: `${data.profileCompletion}%` }} /></div>
            {data.profileCompletion < 100 && <p className="small muted" style={{ marginTop: 10 }}><Link to="/profile">{t('Add your contact and guardian details')}</Link></p>}
          </div>
          <div className="card">
            <div className="card-head"><h2>{t('Announcements')}</h2><Link to="/announcements" className="small">{t('See all')}</Link></div>
            <AnnouncementList items={data.announcements} compact />
          </div>
        </div>
      </div>
    </>
  );
}
