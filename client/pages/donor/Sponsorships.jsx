import Icon from '../../components/Icons.jsx';
import { LineChart } from '../../components/Charts.jsx';
import { StudentPhoto } from '../../components/Media.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, useFetch } from '../../components/ui.jsx';
import { date, inr } from '../../format.js';

export default function DonorSponsorships() {
  const { data, loading, error, reload } = useFetch('/donor/sponsorships');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title="Sponsored Students" subtitle="Follow the progress of the students you sponsor. To protect their privacy, we share first names and school progress only." />
      {!data.length ? (
        <div className="card"><Empty icon="graduation" title="You are not sponsoring a student yet" text="Sponsoring a student for a year covers their fees, books, and uniform. Contact the trust office to start." /></div>
      ) : (
        <div className="stack">
          {data.map((s) => (
            <div className="card" key={s.id}>
              <div className="card-body row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
                <StudentPhoto studentId={s.student_id} name={s.name} hasPhoto={!!s.has_photo} size={72} />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="row wrap" style={{ gap: 8 }}><h2>{s.name}</h2><Badge tone={s.status === 'Active' ? 'green' : 'blue'}>{s.status}</Badge></div>
                  <div className="small muted" style={{ marginTop: 4 }}>{[s.class_year, s.school, s.village].filter(Boolean).join(' · ')}</div>
                  <div className="small muted">{s.programme} · sponsoring since {date(s.start_date)}{s.annual_amount ? ` · ${inr(s.annual_amount)} / year` : ''}</div>
                  <div className="row wrap" style={{ gap: 18, marginTop: 14 }}>
                    <div><div className="small muted">Latest marks</div><div style={{ fontSize: 22, fontWeight: 800 }}>{s.latestMarks != null ? `${s.latestMarks}%` : '—'}</div></div>
                    <div><div className="small muted">Attendance</div><div style={{ fontSize: 22, fontWeight: 800 }}>{s.attendancePct != null ? `${s.attendancePct}%` : '—'}</div></div>
                    <div><div className="small muted">Achievements</div><div style={{ fontSize: 22, fontWeight: 800 }}>{s.certificates_verified}</div></div>
                    <div><div className="small muted">Support received</div><div style={{ fontSize: 22, fontWeight: 800 }}>{inr(s.aid_total)}</div></div>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                  {s.marks.length > 1 ? <LineChart data={s.marks} max={100} suffix="%" height={170} /> : <p className="small muted">Marks will appear here after exams.</p>}
                </div>
              </div>
              {s.achievements.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px' }} className="row wrap small">
                  <Icon name="award" size={16} style={{ color: 'var(--yellow-600)' }} />
                  {s.achievements.map((a, i) => <span key={i}><strong>{a.title}</strong>{a.issued_on ? ` (${date(a.issued_on)})` : ''}{i < s.achievements.length - 1 ? ' ·' : ''}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
