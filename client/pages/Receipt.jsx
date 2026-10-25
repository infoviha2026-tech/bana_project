import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icons.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { ErrorBox, Loading, useFetch } from '../components/ui.jsx';
import { amountInWords, date, inr } from '../format.js';

export default function Receipt() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useFetch(`/donations/${id}/receipt`);
  if (loading) return <Loading />;
  if (error) return <div className="content"><ErrorBox error={error} /></div>;
  const { donation: d, trust: t } = data;

  return (
    <div className="receipt-page">
      <div className="receipt-actions">
        <button className="btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          <Icon name="chevronLeft" size={16} />Back
        </button>
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" size={16} />Print / Save as PDF</button>
      </div>
      <article className="receipt">
        <div className="receipt-head">
          <div className="org">
            <LogoMark size={52} />
            <div>
              <strong>{t.trust_name}</strong>
              {t.trust_address && <div className="small muted" style={{ maxWidth: 320 }}>{t.trust_address}</div>}
              <div className="small muted">
                {[t.contact_phone, t.contact_email].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <div className="small" style={{ textAlign: 'right' }}>
            <div><span className="muted">Receipt No. </span><strong>{d.receipt_no}</strong></div>
            <div><span className="muted">Date </span><strong>{date(d.donated_on)}</strong></div>
            {t.registration_no && <div><span className="muted">Reg. No. </span>{t.registration_no}</div>}
          </div>
        </div>

        <div className="receipt-title">DONATION RECEIPT</div>

        <p>
          Received with thanks from <strong>{d.donor_name}</strong>
          {d.address || d.city ? <>, {[d.address, d.city].filter(Boolean).join(', ')}</> : null}
          {d.pan ? <> (PAN: <strong>{d.pan}</strong>)</> : null}, a sum of <strong>{amountInWords(d.amount)}</strong> by {d.mode || 'payment'}
          {d.reference_no ? <> (ref. {d.reference_no})</> : null} towards <strong>{d.purpose}</strong>.
        </p>

        <div className="amount-box">
          <div>
            <div className="small muted">Amount received</div>
            <div className="amt">{inr(d.amount, true)}</div>
          </div>
          <dl className="dl small" style={{ gridTemplateColumns: 'auto auto' }}>
            <dt>Mode</dt><dd>{d.mode}</dd>
            <dt>Purpose</dt><dd>{d.purpose}</dd>
          </dl>
        </div>

        <p className="muted">Thank you for supporting education and community development. Together, we make a difference.</p>

        <div className="sign"><div>Authorised Signatory<br /><span className="muted">{t.trust_name}</span></div></div>

        <div className="note">
          {t.pan_80g_no
            ? <>Donations to {t.trust_name} are eligible for deduction under Section 80G of the Income Tax Act, 1961. 80G Registration No.: <strong>{t.pan_80g_no}</strong>.</>
            : <>This is a computer-generated receipt.</>}
          {' '}Please keep this receipt for your records.
        </div>
      </article>
    </div>
  );
}
