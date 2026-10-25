import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icons.jsx';
import ResourcePage from '../../components/Resource.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, useFetch } from '../../components/ui.jsx';
import { useMeta } from './common.jsx';
import { monthLabel } from '../student/Progress.jsx';

function AtRisk() {
  const { data, loading, error, reload } = useFetch('/admin/academics/at-risk');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Students who need attention</h2>
        <span className="small muted">Marks below {data.marksThreshold}%, a drop of 10+ points, or attendance below {data.attendanceThreshold}% · <Link to="/settings">change levels</Link></span>
      </div>
      {!data.rows.length ? <Empty icon="checkCircle" title="No students need attention right now" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Student</th><th>School / Class</th><th>Village</th><th className="num">Latest marks</th><th className="num">Attendance</th><th>Why</th></tr></thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/students/${s.id}`}><strong>{s.name}</strong></Link><div className="cell-sub">{s.student_code}</div></td>
                  <td>{s.school}<div className="cell-sub">{s.class_year}</div></td>
                  <td>{s.village}</td>
                  <td className="num">{s.latestMarks != null ? `${s.latestMarks}%` : '—'}</td>
                  <td className="num">{s.attendancePct != null ? `${s.attendancePct}%` : '—'}</td>
                  <td>{s.reasons.map((r) => <div key={r} className="small" style={{ color: 'var(--red)' }}><Icon name="alert" size={12} style={{ verticalAlign: -1 }} /> {r}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Academics() {
  const meta = useMeta();
  const [tab, setTab] = useState('risk');
  const years = [...new Set([...(meta ? [] : []), '2026-27', '2025-26', '2024-25', '2023-24'])];
  const terms = meta?.terms || [];
  return (
    <>
      <PageHead title="Marks & Attendance" subtitle="Record exam results and monthly attendance. Bulk-load them from Excel under Import from Excel."
        actions={<Link to="/import" className="btn"><Icon name="upload" size={16} />Import from Excel</Link>} />
      <div className="tabs" style={{ marginBottom: 16, padding: 0 }}>
        {[['risk', 'Needs attention'], ['marks', 'Marks'], ['attendance', 'Attendance']].map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'risk' && <AtRisk />}
      {tab === 'marks' && (
        <ResourcePage noHead endpoint="/admin/marks" exportType="marks" itemLabel="marks record" newLabel="Add marks"
          searchPlaceholder="Search student or ID…"
          filters={[{ key: 'academic_year', placeholder: 'All years', options: years }, { key: 'term', placeholder: 'All exams', options: terms }]}
          columns={[
            { key: 'student_name', label: 'Student', render: (r) => <><Link to={`/students/${r.student_id}`}>{r.student_name}</Link><div className="cell-sub">{r.student_code}</div></> },
            { key: 'academic_year', label: 'Year' }, { key: 'term', label: 'Exam' },
            { key: 'grade', label: 'Grade' },
            { key: 'percentage', label: 'Percentage', num: true, render: (r) => <strong style={{ color: r.percentage < 40 ? 'var(--red)' : undefined }}>{r.percentage}%</strong> },
          ]}
          fields={[
            { name: 'student_id', label: 'Student', type: 'student', required: true, full: true },
            { name: 'academic_year', label: 'Academic year', required: true, default: '2026-27', hint: 'e.g. 2026-27' },
            { name: 'term', label: 'Exam', type: 'select', options: terms, required: true },
            { name: 'percentage', label: 'Percentage', type: 'number', min: 0, maxValue: 100, required: true },
            { name: 'grade', label: 'Grade', max: 5 },
            { name: 'remarks', label: 'Remarks', full: true, max: 300 },
          ]} />
      )}
      {tab === 'attendance' && (
        <ResourcePage noHead endpoint="/admin/attendance" exportType="attendance" itemLabel="attendance record" newLabel="Add attendance"
          searchPlaceholder="Search student or ID…"
          columns={[
            { key: 'student_name', label: 'Student', render: (r) => <><Link to={`/students/${r.student_id}`}>{r.student_name}</Link><div className="cell-sub">{r.student_code}</div></> },
            { key: 'month', label: 'Month', render: (r) => monthLabel(r.month) },
            { key: 'days_present', label: 'Present', num: true }, { key: 'days_total', label: 'Working days', num: true },
            { key: 'pct', label: 'Attendance', num: true, render: (r) => <Badge tone={r.pct < 75 ? 'red' : 'green'} plain>{r.pct}%</Badge> },
          ]}
          fields={[
            { name: 'student_id', label: 'Student', type: 'student', required: true, full: true },
            { name: 'month', label: 'Month', type: 'month', required: true },
            { name: 'days_present', label: 'Days present', type: 'number', min: 0, maxValue: 31, required: true },
            { name: 'days_total', label: 'Working days', type: 'number', min: 1, maxValue: 31, required: true },
          ]} />
      )}
    </>
  );
}
