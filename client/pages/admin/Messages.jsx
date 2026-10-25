import { useState } from 'react';
import { api, qs } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, SearchBox, Select, useDebounced, useFetch, useUI } from '../../components/ui.jsx';
import { dateTime } from '../../format.js';

const TONE = { sent: 'green', logged: 'blue', pending: 'amber', failed: 'red' };

export default function Messages() {
  const { toast } = useUI();
  const integ = useFetch('/super/integrations').data;
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useFetch(`/super/outbox${qs({ status, channel, q: dq })}`);

  return (
    <>
      <PageHead title="Email & SMS" subtitle="Every email and text the portal sends — receipts, OTP codes, certificate decisions, reminders." />
      {integ && (
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          {[
            ['mail', 'Email', integ.email, 'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in the server environment (e.g. Gmail app password, Zoho, Amazon SES).'],
            ['phone2', 'SMS', integ.sms, 'Set TWILIO_SID, TWILIO_TOKEN and TWILIO_FROM in the server environment.'],
            ['rupee', 'Online payments', integ.payments, 'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (and RAZORPAY_WEBHOOK_SECRET for the webhook) in the server environment.'],
          ].map(([icon, label, on, help]) => (
            <div className="card card-pad" key={label}>
              <div className="row" style={{ justifyContent: 'space-between' }}><h3><Icon name={icon} size={16} style={{ verticalAlign: -2 }} /> {label}</h3>{on ? <Badge tone="green">Connected</Badge> : <Badge tone="amber">Not set up</Badge>}</div>
              {!on && <p className="small muted" style={{ marginTop: 8 }}>{help} Until then, messages are <strong>logged here</strong> instead of being sent.</p>}
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="filters">
          <SearchBox value={q} onChange={setQ} placeholder="Search recipient or subject…" />
          <Select value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Email and SMS" options={[{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }]} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={['sent', 'logged', 'pending', 'failed']} />
        </div>
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.length ? <Empty icon="mail" title="No messages yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap small">{dateTime(m.created_at)}</td>
                    <td><Icon name={m.channel === 'email' ? 'mail' : 'phone2'} size={14} style={{ verticalAlign: -2 }} /> {m.recipient}{m.user_name && <div className="cell-sub">{m.user_name}</div>}</td>
                    <td style={{ maxWidth: 460 }}>{m.subject && <strong>{m.subject}</strong>}<div className="cell-sub" style={{ whiteSpace: 'pre-wrap' }}>{m.body.replace(/\s*\[link:.*?\]/, '')}</div></td>
                    <td><Badge tone={TONE[m.status]}>{m.status === 'logged' ? 'logged (not sent)' : m.status}</Badge>{m.error && <div className="cell-sub" style={{ color: 'var(--red)' }}>{m.error}</div>}</td>
                    <td className="right">{['failed', 'logged'].includes(m.status) && <button className="btn btn-sm" onClick={async () => {
                      try { const r = await api.post(`/super/outbox/${m.id}/retry`); toast(`Status: ${r.status}`); reload(); } catch (e) { toast(e.message, 'error'); }
                    }}>Retry</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
