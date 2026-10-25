import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import ResourcePage from '../../components/Resource.jsx';
import { StoryImage } from '../../components/Media.jsx';
import { Badge, useUI } from '../../components/ui.jsx';
import { date, dateTime, inr } from '../../format.js';
import { useMeta } from './common.jsx';
import { PLEDGE_TONE } from '../donor/Pledges.jsx';

export const pledgeFields = (meta) => [
  { name: 'donor_id', label: 'Donor', type: 'donor', required: true, full: true },
  { name: 'amount', label: 'Amount per instalment (₹)', type: 'amount', required: true },
  { name: 'frequency', label: 'Frequency', type: 'select', options: meta?.pledgeFrequencies || ['Monthly'], required: true },
  { name: 'start_date', label: 'First instalment due', type: 'date', required: true, default: 'today' },
  { name: 'end_date', label: 'End date', type: 'date', hint: 'Leave empty if ongoing' },
  { name: 'project_id', label: 'Project', type: 'project' },
  { name: 'purpose', label: 'Purpose', max: 100 },
  { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Paused', 'Ended'], required: true },
  { name: 'notes', label: 'Notes', full: true, max: 300 },
];

export function Pledges() {
  const meta = useMeta();
  return (
    <ResourcePage title="Pledges" subtitle="Regular giving commitments. Donors get a reminder when an instalment is overdue; record their donations against the pledge to keep it on track."
      endpoint="/admin/pledges" listEndpoint="/admin/pledges-status" itemLabel="pledge" newLabel="Add pledge"
      searchPlaceholder="Search donor or purpose…"
      filters={[{ key: 'status', placeholder: 'All statuses', options: ['Active', 'Paused', 'Ended'] }, { key: 'frequency', placeholder: 'Any frequency', options: meta?.pledgeFrequencies || [] }]}
      columns={[
        { key: 'donor_name', label: 'Donor', render: (r) => <Link to={`/donors/${r.donor_id}`}>{r.donor_name}</Link> },
        { key: 'amount', label: 'Pledge', render: (r) => <><strong>{inr(r.amount)}</strong> <span className="muted small">{r.frequency.toLowerCase()}</span><div className="cell-sub">{r.project_name || r.purpose || 'General'}</div></> },
        { key: 'state', label: 'Status', render: (r) => <Badge tone={PLEDGE_TONE[r.state]}>{r.state}</Badge> },
        { key: 'nextDue', label: 'Next due', render: (r) => (r.nextDue ? date(r.nextDue) : '—') },
        { key: 'expected', label: 'Due so far', money: true },
        { key: 'received', label: 'Received', money: true },
      ]}
      fields={pledgeFields(meta)} />
  );
}

export function Expenses() {
  const meta = useMeta();
  return (
    <ResourcePage title="Expenses" subtitle="Money the trust spends — salaries, supplies, buildings, events. Used for fund-utilisation reports."
      endpoint="/admin/expenses" exportType="expenses" itemLabel="expense" newLabel="Record expense" footerSum="Total"
      searchPlaceholder="Search payee, description, voucher…"
      headerExtra={<Link to="/import" className="btn"><Icon name="upload" size={16} />Import</Link>}
      filters={[
        { key: 'category', placeholder: 'All categories', options: meta?.expenseCategories || [] },
        { key: 'project_id', placeholder: 'All projects', options: (meta?.projects || []).map((p) => ({ value: p.id, label: p.name })) },
        { key: 'from', type: 'date', placeholder: 'From' }, { key: 'to', type: 'date', placeholder: 'To' },
      ]}
      columns={[
        { key: 'spent_on', label: 'Date', render: (r) => <span className="nowrap">{date(r.spent_on)}</span> },
        { key: 'vendor', label: 'Paid to', render: (r) => <>{r.vendor || '—'}{r.description && <div className="cell-sub">{r.description}</div>}</> },
        { key: 'category', label: 'Category' },
        { key: 'project_name', label: 'Project', render: (r) => (r.project_id ? <Link to={`/projects/${r.project_id}`}>{r.project_name}</Link> : '—') },
        { key: 'mode', label: 'Mode', render: (r) => <>{r.mode}{r.reference_no && <div className="cell-sub">{r.reference_no}</div>}</> },
        { key: 'amount', label: 'Amount', money: true },
      ]}
      fields={[
        { name: 'spent_on', label: 'Date', type: 'date', required: true, default: 'today' },
        { name: 'amount', label: 'Amount (₹)', type: 'amount', required: true },
        { name: 'category', label: 'Category', type: 'select', options: meta?.expenseCategories || [], required: true },
        { name: 'vendor', label: 'Paid to', max: 150 },
        { name: 'project_id', label: 'Project', type: 'project' },
        { name: 'mode', label: 'Payment mode', type: 'select', options: meta?.donationModes || [], required: true, default: 'Bank Transfer' },
        { name: 'reference_no', label: 'Voucher / reference no', max: 60 },
        { name: 'description', label: 'Description', full: true, max: 500 },
      ]} />
  );
}

export function Payments() {
  return (
    <ResourcePage title="Online Payments" subtitle="Payments donors made through the portal (Razorpay). Paid orders become donations with receipts automatically."
      endpoint="/admin/payments" itemLabel="payment" canDelete={false} footerSum="Total paid" searchPlaceholder="Search donor, order, or payment ID…"
      filters={[{ key: 'status', placeholder: 'All statuses', options: [{ value: 'paid', label: 'Paid' }, { value: 'created', label: 'Started (not paid)' }, { value: 'failed', label: 'Failed' }] }]}
      columns={[
        { key: 'created_at', label: 'Started', render: (r) => <span className="nowrap small">{dateTime(r.created_at)}</span> },
        { key: 'donor_name', label: 'Donor', render: (r) => <Link to={`/donors/${r.donor_id}`}>{r.donor_name}</Link> },
        { key: 'purpose', label: 'Purpose' },
        { key: 'order_id', label: 'Order / payment', render: (r) => <span className="mono small">{r.order_id}{r.payment_id && <div className="cell-sub">{r.payment_id}</div>}</span> },
        { key: 'status', label: 'Status', render: (r) => <><Badge tone={{ paid: 'green', created: 'amber', failed: 'red' }[r.status]}>{r.status === 'created' ? 'not completed' : r.status}</Badge>{r.receipt_no && <div className="cell-sub"><Link to={`/receipt/${r.donation_id}`}>{r.receipt_no}</Link></div>}{r.error && <div className="cell-sub">{r.error}</div>}</> },
        { key: 'amount', label: 'Amount', money: true },
      ]} />
  );
}

function ImageButton({ story, onDone }) {
  const input = useRef();
  const { toast } = useUI();
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png" hidden onChange={async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('image', f);
        try { await api.post(`/admin/stories/${story.id}/image`, fd); toast('Picture uploaded'); onDone(); } catch (err) { toast(err.message, 'error'); }
        e.target.value = '';
      }} />
      <button className="icon-btn" title={story.image_path ? 'Change picture' : 'Add picture'} onClick={() => input.current.click()}><Icon name="camera" size={16} /></button>
    </>
  );
}

export function Stories() {
  const meta = useMeta();
  return (
    <ResourcePage title="Impact Stories" subtitle="Short updates with a photo. Published stories appear for donors and on the public impact page."
      endpoint="/admin/stories" itemLabel="story" newLabel="Write a story"
      headerExtra={<Link to="/impact" target="_blank" className="btn"><Icon name="globe" size={16} />Public page</Link>}
      filters={[{ key: 'published', placeholder: 'Published and drafts', options: [{ value: '1', label: 'Published' }, { value: '0', label: 'Drafts' }] }]}
      rowActions={(row, reload) => <ImageButton story={row} onDone={reload} />}
      columns={[
        { key: 'image', label: '', render: (r) => <div style={{ width: 72, borderRadius: 6, overflow: 'hidden' }}><StoryImage story={{ ...r, has_image: !!r.image_path }} height={44} /></div> },
        { key: 'title', label: 'Story', render: (r) => <><strong>{r.title}</strong><div className="cell-sub" style={{ maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.body}</div></> },
        { key: 'project_name', label: 'Project', render: (r) => r.project_name || '—' },
        { key: 'published', label: 'Status', render: (r) => (r.published ? <Badge tone="green">Published</Badge> : <Badge>Draft</Badge>) },
        { key: 'created_at', label: 'Date', render: (r) => date(r.created_at) },
      ]}
      fields={[
        { name: 'title', label: 'Title', required: true, full: true, max: 160 },
        { name: 'project_id', label: 'Project', type: 'project' },
        { name: 'village', label: 'Village', max: 100 },
        { name: 'body', label: 'Story', type: 'textarea', required: true, rows: 8, max: 10000 },
        { name: 'published', label: 'Published', type: 'checkbox', checkLabel: 'Publish now (visible to donors and the public page)' },
      ]}>
      <p className="small muted" style={{ marginBottom: 12 }}><Icon name="camera" size={13} style={{ verticalAlign: -2 }} /> After saving a story, use the camera button on its row to add a picture.</p>
    </ResourcePage>
  );
}

