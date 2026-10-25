import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Avatar, Badge, Empty, ErrorBox, Loading, PageHead, Stat, useFetch, useUI } from '../../components/ui.jsx';
import { date, dateTime, inr } from '../../format.js';
import { AccountActions, DonationForm, DonorForm, ExportButton, useMeta } from './common.jsx';
import { ResourceForm } from '../../components/Resource.jsx';
import { sponsorshipFields } from './Sponsorships.jsx';
import { pledgeFields } from './Finance.jsx';
import { MessageModal } from './Students.jsx';
import { PLEDGE_TONE } from '../donor/Pledges.jsx';

export default function DonorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, confirm } = useUI();
  const { data: d, loading, error, reload } = useFetch(`/admin/donors/${id}`);
  const [editing, setEditing] = useState(false);
  const [donation, setDonation] = useState(null);
  const [modal, setModal] = useState(null);
  const meta = useMeta();
  const sponsorships = useFetch(`/admin/sponsorships?donor_id=${id}`);
  const pledges = useFetch(`/admin/pledges-status?donor_id=${id}`);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const removeDonor = async () => {
    if (!(await confirm({ title: `Permanently delete ${d.name}?`, message: `This deletes the donor, their login, and all ${d.donations.length} donation records (${inr(d.total)}). This cannot be undone. Consider deactivating instead.`, confirmText: 'Delete permanently', danger: true }))) return;
    try { await api.del(`/admin/donors/${d.id}`); toast('Donor deleted'); navigate('/donors'); } catch (e) { toast(e.message, 'error'); }
  };

  const removeDonation = async (x) => {
    if (!(await confirm({ title: 'Delete donation?', message: `${inr(x.amount)} on ${date(x.donated_on)} (receipt ${x.receipt_no}) will be removed.`, confirmText: 'Delete', danger: true }))) return;
    try { await api.del(`/admin/donations/${x.id}`); toast('Donation deleted'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  const years = new Set(d.donations.map((x) => x.donated_on.slice(0, 4)));

  return (
    <>
      <PageHead back={{ to: '/donors', label: 'All donors' }} title={d.name}
        actions={<>
          <button className="btn btn-primary" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Edit</button>
          <button className="btn" onClick={() => setModal('message')}><Icon name="mail" size={16} />Message</button>
          <AccountActions userId={d.user_id} name={d.name} active={!!d.is_active} onChanged={reload} onDelete={removeDonor} />
        </>} />

      <div className="grid grid-3">
        <Stat icon="heart" label="Total given" value={inr(d.total)} />
        <Stat icon="file" tone="blue" label="Donations" value={d.donations.length} sub={years.size ? `across ${years.size} calendar year${years.size > 1 ? 's' : ''}` : null} />
        <Stat icon="clock" tone="yellow" label="Last donation" value={d.donations[0] ? inr(d.donations[0].amount) : '—'} sub={d.donations[0] ? date(d.donations[0].donated_on) : null} />
      </div>

      <div className="grid grid-main mt">
        <div className="card">
          <div className="card-head">
            <h2>Donation history</h2>
            <div className="row">
              <ExportButton type="donations" query={`?donor_id=${d.id}`} />
              <button className="btn btn-primary" onClick={() => setDonation({})}><Icon name="plus" size={16} />Record donation</button>
            </div>
          </div>
          {d.donations.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Receipt</th><th>Purpose</th><th>Mode</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {d.donations.map((x) => (
                    <tr key={x.id}>
                      <td className="nowrap">{date(x.donated_on)}</td>
                      <td className="mono small"><Link to={`/receipt/${x.id}`}>{x.receipt_no}</Link></td>
                      <td>{x.purpose}</td>
                      <td>{x.mode}{x.reference_no && <div className="cell-sub">{x.reference_no}</div>}</td>
                      <td className="num">{inr(x.amount)}</td>
                      <td className="right nowrap">
                        <button className="icon-btn" onClick={() => setDonation(x)} aria-label="Edit"><Icon name="edit" size={16} /></button>
                        <button className="icon-btn danger" onClick={() => removeDonation(x)} aria-label="Delete"><Icon name="trash" size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="rupee" title="No donations recorded yet" />}
        </div>

        <div className="card card-pad">
          <div className="row" style={{ gap: 14 }}>
            <Avatar name={d.name} size="lg" />
            <div className="row wrap"><Badge tone="green" plain>{d.donor_type}</Badge>{!d.is_active && <Badge tone="red">Login disabled</Badge>}</div>
          </div>
          <dl className="dl mt" style={{ gridTemplateColumns: '100px 1fr', fontSize: 13.5 }}>
            <dt>Email</dt><dd>{d.email}</dd>
            <dt>Phone</dt><dd>{d.phone || '—'}</dd>
            <dt>PAN</dt><dd>{d.pan || '—'}</dd>
            <dt>Address</dt><dd>{[d.address, d.city].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Since</dt><dd>{date(d.created_at)}</dd>
            <dt>Last sign-in</dt><dd>{d.last_login_at ? dateTime(d.last_login_at) : 'Never'}</dd>
          </dl>
        </div>
      </div>

      {editing && <DonorForm donor={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head"><h2>Sponsored students</h2><button className="btn btn-sm btn-primary" onClick={() => setModal('sponsor')}><Icon name="plus" size={14} />Add</button></div>
          {!sponsorships.data?.rows.length ? <Empty icon="graduation" title="Not sponsoring anyone yet" /> : sponsorships.data.rows.map((s) => (
            <div className="list-item" key={s.id}>
              <div className="grow"><Link to={`/students/${s.student_id}`} className="title">{s.student_name}</Link><div className="cell-sub">{s.student_code} · {s.class_year} · since {date(s.start_date)}</div></div>
              {s.active ? <Badge tone="green">Active</Badge> : <Badge>Ended</Badge>}
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><h2>Pledges</h2><button className="btn btn-sm btn-primary" onClick={() => setModal('pledge')}><Icon name="plus" size={14} />Add</button></div>
          {!pledges.data?.rows.length ? <Empty icon="calendar" title="No pledges" /> : pledges.data.rows.map((p) => (
            <div className="list-item" key={p.id}>
              <div className="grow"><div className="title">{inr(p.amount)} {p.frequency.toLowerCase()}</div><div className="cell-sub">{p.project_name || p.purpose || 'General'} · received {inr(p.received)} of {inr(p.expected)} due</div></div>
              <Badge tone={PLEDGE_TONE[p.state]}>{p.state}</Badge>
            </div>
          ))}
        </div>
      </div>
      {modal === 'sponsor' && <ResourceForm title="Add a sponsored student" endpoint="/admin/sponsorships" fields={sponsorshipFields} row={{ donor_id: d.id, active: 1 }} onClose={() => setModal(null)} onSaved={() => { setModal(null); sponsorships.reload(); }} />}
      {modal === 'pledge' && <ResourceForm title="Add a pledge" endpoint="/admin/pledges" fields={pledgeFields(meta)} row={{ donor_id: d.id, status: 'Active' }} onClose={() => setModal(null)} onSaved={() => { setModal(null); pledges.reload(); }} />}
      {modal === 'message' && <MessageModal title={`Message ${d.name}`} count={1} onClose={() => setModal(null)} onSend={async (b) => {
        await api.post('/admin/donors/bulk-message', { ids: [d.id], ...b });
        toast('Message sent');
        setModal(null);
      }} />}
      {donation && <DonationForm donation={donation.id ? donation : null} donorId={d.id} onClose={() => setDonation(null)} onSaved={() => { setDonation(null); reload(); }} />}
    </>
  );
}
