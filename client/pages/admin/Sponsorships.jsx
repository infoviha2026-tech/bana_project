import { Link } from 'react-router-dom';
import ResourcePage from '../../components/Resource.jsx';
import { Badge } from '../../components/ui.jsx';
import { date } from '../../format.js';

export const sponsorshipFields = [
  { name: 'donor_id', label: 'Donor', type: 'donor', required: true },
  { name: 'student_id', label: 'Student', type: 'student', required: true },
  { name: 'start_date', label: 'Start date', type: 'date', required: true, default: 'today' },
  { name: 'end_date', label: 'End date', type: 'date', hint: 'Leave empty if ongoing' },
  { name: 'annual_amount', label: 'Annual amount (₹)', type: 'amount' },
  { name: 'active', label: 'Active', type: 'checkbox', checkLabel: 'Active — donor can see this student' },
  { name: 'notes', label: 'Notes', full: true, max: 300 },
];

export default function Sponsorships() {
  return (
    <ResourcePage title="Sponsorships" subtitle="Link a donor to the students they sponsor. Sponsors see first name, school progress, and achievements — never contact details."
      endpoint="/admin/sponsorships" exportType="sponsorships" itemLabel="sponsorship" newLabel="Add sponsorship"
      searchPlaceholder="Search donor or student…"
      filters={[{ key: 'active', placeholder: 'Active and ended', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Ended' }] }]}
      columns={[
        { key: 'donor_name', label: 'Donor', render: (r) => <Link to={`/donors/${r.donor_id}`}>{r.donor_name}</Link> },
        { key: 'student_name', label: 'Student', render: (r) => <><Link to={`/students/${r.student_id}`}>{r.student_name}</Link><div className="cell-sub">{r.student_code} · {r.class_year}</div></> },
        { key: 'village', label: 'Village' },
        { key: 'start_date', label: 'Since', render: (r) => date(r.start_date) },
        { key: 'active', label: 'Status', render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Ended</Badge>) },
        { key: 'annual_amount', label: 'Per year', money: true },
      ]}
      fields={sponsorshipFields} />
  );
}
