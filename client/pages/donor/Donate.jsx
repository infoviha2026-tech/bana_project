import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { ErrorBox, Field, Loading, PageHead, Select, useFetch, useUI } from '../../components/ui.jsx';
import { inr } from '../../format.js';

const PRESETS = [1000, 2500, 5000, 10000, 25000];
const PURPOSES = ['General Fund', 'Scholarships', 'Books & Uniforms', 'School Infrastructure', 'Village Development'];

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the payment window. Check your internet connection'));
    document.body.appendChild(s);
  });
}

function BankDetails({ bank }) {
  const { toast } = useUI();
  const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast('Copied'));
  const rows = [['Account name', bank.trust], ['Bank', bank.name], ['Account number', bank.account], ['IFSC', bank.ifsc], ['UPI ID', bank.upi]].filter(([, v]) => v);
  if (rows.length <= 1) return <p className="muted">Please contact the trust office for bank details.</p>;
  return (
    <dl className="dl">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd className="row" style={{ gap: 6 }}><span className="mono">{v}</span>{k !== 'Account name' && <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => copy(v)} aria-label={`Copy ${k}`}><Icon name="file" size={13} /></button>}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Donate() {
  const { toast } = useUI();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: cfg, loading, error } = useFetch('/donor/payments/config');
  const projects = useFetch('/donor/projects').data;
  const pledges = useFetch('/donor/pledges').data;
  const [amount, setAmount] = useState(params.get('amount') || 2500);
  const [projectId, setProjectId] = useState(params.get('project') || '');
  const [pledgeId, setPledgeId] = useState(params.get('pledge') || '');
  const [purpose, setPurpose] = useState('General Fund');
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const activeProjects = projects?.filter((p) => p.status === 'Active') || [];
  const activePledges = pledges?.filter((p) => p.status === 'Active') || [];

  const pay = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await loadCheckout();
      const project = activeProjects.find((p) => String(p.id) === String(projectId));
      const order = await api.post('/donor/payments/order', { amount: Number(amount), purpose: project ? project.name : purpose, project_id: projectId || null, pledge_id: pledgeId || null });
      const rzp = new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
        name: cfg.bank.trust, description: project ? project.name : purpose,
        prefill: { name: order.name, email: order.email || undefined, contact: order.phone || undefined },
        theme: { color: '#1F4D2B' },
        handler: async (resp) => {
          try {
            const r = await api.post('/donor/payments/verify', { order_id: resp.razorpay_order_id, payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature });
            toast('Thank you! Your donation was received');
            navigate(`/receipt/${r.donationId}`);
          } catch (err) { toast(err.message, 'error'); }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', (r) => { toast(r.error?.description || 'Payment failed', 'error'); setBusy(false); });
      rzp.open();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Donate" subtitle="Your gift supports students and village projects. You get an 80G receipt instantly." />
      <div className="grid grid-main">
        <div className="card">
          <div className="card-head"><h2>{cfg.enabled ? 'Donate online' : 'Donate by bank transfer or UPI'}</h2>{cfg.enabled && <span className="small muted"><Icon name="lock" size={13} style={{ verticalAlign: -2 }} /> Secured by Razorpay</span>}</div>
          {cfg.enabled ? (
            <form className="card-body stack" onSubmit={pay}>
              <Field label="Amount (₹)" required>
                <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                  {PRESETS.map((p) => <button type="button" key={p} className={`btn btn-sm ${Number(amount) === p ? 'btn-primary' : ''}`} onClick={() => setAmount(p)}>{inr(p)}</button>)}
                </div>
                <input className="input" type="number" min={cfg.min} max={cfg.max} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
              {activePledges.length > 0 && (
                <Field label="Is this for a pledge?">
                  <Select value={pledgeId} onChange={(e) => setPledgeId(e.target.value)} placeholder="No"
                    options={activePledges.map((p) => ({ value: p.id, label: `${inr(p.amount)} ${p.frequency.toLowerCase()}${p.purpose ? ` — ${p.purpose}` : ''}${p.balance ? ` (${inr(p.balance)} due)` : ''}` }))} />
                </Field>
              )}
              <Field label="Give towards a project (optional)">
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="No specific project" options={activeProjects.map((p) => ({ value: p.id, label: p.name }))} />
              </Field>
              {!projectId && <Field label="Purpose"><Select value={purpose} onChange={(e) => setPurpose(e.target.value)} options={PURPOSES} /></Field>}
              <button className="btn btn-primary" style={{ height: 46, fontSize: 15 }} disabled={busy}>{busy ? 'Opening payment…' : <><Icon name="heart" size={16} />Donate {inr(amount)}</>}</button>
              <p className="small muted">Pay by UPI, card, net banking, or wallet. Your receipt number is generated as soon as the payment is confirmed.</p>
            </form>
          ) : (
            <div className="card-body stack">
              <div className="alert info"><Icon name="info" />Online payment isn't available yet. Please transfer to the account below and share the UTR / reference number with the trust office. Your receipt will appear under My Donations once it is recorded.</div>
              <BankDetails bank={cfg.bank} />
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card card-pad">
            <h3>Where your money goes</h3>
            <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.8, marginTop: 8 }}>
              <li>{inr(2500)} buys books and a uniform for one student</li>
              <li>{inr(10000)} pays a year's school fees</li>
              <li>{inr(25000)} funds a higher-education scholarship</li>
            </ul>
          </div>
          {activeProjects.slice(0, 3).map((p) => {
            const pct = Math.min(100, Math.round((p.raised / p.goal_amount) * 100));
            return (
              <button key={p.id} className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer', border: String(projectId) === String(p.id) ? '2px solid var(--green-700)' : undefined }} onClick={() => setProjectId(p.id)}>
                <strong>{p.name}</strong>
                <div className="progress" style={{ margin: '8px 0 4px' }}><div style={{ width: `${pct}%` }} /></div>
                <div className="small muted">{pct}% of {inr(p.goal_amount)} raised</div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
