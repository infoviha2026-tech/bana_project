import Icon from '../../components/Icons.jsx';
import { Empty, ErrorBox, Loading, PageHead, Stat, useFetch } from '../../components/ui.jsx';
import { LineChart } from '../../components/Charts.jsx';
import { useT } from '../../i18n.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

/** Marks + attendance view shared by the student portal, admin student page, and sponsor view */
export function ProgressView({ data, t = (s) => s }) {
  const { marks, attendance, attendancePct, latestMarks } = data;
  const prev = marks.at(-2)?.percentage;
  const trend = latestMarks != null && prev != null ? latestMarks - prev : null;
  const attData = attendance.map((a) => ({ label: monthLabel(a.month), value: Math.round((a.days_present / a.days_total) * 100) }));
  return (
    <>
      <div className="grid grid-3">
        <Stat icon="trending" label={t('Latest marks')} value={latestMarks != null ? `${latestMarks}%` : '—'}
          sub={trend != null ? `${trend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(trend))} ${t('points since last exam')}` : null} tone={latestMarks != null && latestMarks < (data.marksThreshold ?? 40) ? 'red' : ''} />
        <Stat icon="calendar" tone={attendancePct != null && attendancePct < (data.attendanceThreshold ?? 75) ? 'red' : 'blue'} label={t('Attendance (last 3 months)')} value={attendancePct != null ? `${attendancePct}%` : '—'} />
        <Stat icon="award" tone="yellow" label={t('Exams recorded')} value={marks.length} />
      </div>
      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head"><h2>{t('Marks')}</h2></div>
          <div className="card-body">
            {marks.length ? <LineChart data={marks.map((m) => ({ label: `${t(m.term)} ${m.academic_year.slice(2)}`, value: m.percentage }))} max={100} suffix="%" threshold={data.marksThreshold} />
              : <Empty icon="trending" title={t('No marks recorded yet')} />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>{t('Attendance')}</h2></div>
          <div className="card-body">
            {attendance.length ? <LineChart data={attData} max={100} suffix="%" threshold={data.attendanceThreshold} color="var(--blue)" />
              : <Empty icon="calendar" title={t('No attendance recorded yet')} />}
          </div>
        </div>
      </div>
      {marks.length > 0 && (
        <div className="card mt">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Year')}</th><th>{t('Exam')}</th><th className="num">{t('Percentage')}</th><th>{t('Grade')}</th><th>{t('Remarks')}</th></tr></thead>
              <tbody>{[...marks].reverse().map((m) => <tr key={m.id}><td>{m.academic_year}</td><td>{t(m.term)}</td><td className="num"><strong>{m.percentage}%</strong></td><td>{m.grade || '—'}</td><td className="muted">{m.remarks || '—'}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export default function StudentProgress() {
  const t = useT();
  const { data, loading, error, reload } = useFetch('/student/progress');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const low = (data.latestMarks != null && data.latestMarks < data.marksThreshold) || (data.attendancePct != null && data.attendancePct < data.attendanceThreshold);
  return (
    <>
      <PageHead title={t('My Progress')} subtitle={t('Your exam results and attendance, as recorded by the trust.')} />
      {low && <div className="alert warn" style={{ marginBottom: 16 }}><Icon name="info" />{t('Your marks or attendance are lower than we would like. Please talk to your coordinator — we are here to help.')}</div>}
      <ProgressView data={data} t={t} />
    </>
  );
}
