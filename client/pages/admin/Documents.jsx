import ResourcePage from '../../components/Resource.jsx';
import { Badge } from '../../components/ui.jsx';
import { useMeta } from './common.jsx';

export default function Documents() {
  const meta = useMeta();
  return (
    <ResourcePage title="Document Checklist" subtitle="Documents every student must upload. Students see a checklist and progress bar; leave Programme empty to require it from everyone."
      endpoint="/admin/doc-requirements" itemLabel="document" newLabel="Add document"
      columns={[
        { key: 'sort', label: '#', num: true },
        { key: 'name', label: 'Document', render: (r) => <><strong>{r.name}</strong>{r.description && <div className="cell-sub">{r.description}</div>}</> },
        { key: 'category', label: 'Category' },
        { key: 'programme', label: 'Required for', render: (r) => r.programme || 'All students' },
        { key: 'active', label: 'Status', render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Hidden</Badge>) },
      ]}
      fields={[
        { name: 'name', label: 'Document name', required: true, max: 120 },
        { name: 'category', label: 'Category', type: 'select', options: meta?.certCategories || [], required: true },
        { name: 'programme', label: 'Only for programme', type: 'select', options: meta?.programmes || [], hint: 'Leave empty for all students' },
        { name: 'sort', label: 'Order', type: 'number', min: 0, default: 10 },
        { name: 'description', label: 'Instructions for students', full: true, max: 300 },
        { name: 'active', label: 'Active', type: 'checkbox', checkLabel: 'Show this in students’ checklist' },
      ]} />
  );
}
