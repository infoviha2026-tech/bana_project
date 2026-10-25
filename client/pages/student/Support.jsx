import Icon from '../../components/Icons.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHead, Stat, useFetch } from '../../components/ui.jsx';
import { date, inr } from '../../format.js';
import { useT } from '../../i18n.jsx';

export default function StudentSupport() {
  const t = useT();
  const { data, loading, error, reload } = useFetch('/student/aid');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const total = data.reduce((s, a) => s + a.amount, 0);
  const byType = data.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] || 0) + a.amount }), {});

  return (
    <>
      <PageHead title={t('My Support')} subtitle={t('Scholarships, fees, books, and other help you have received from the trust.')} />
      <div className="grid grid-3">
        <Stat icon="heart" label={t('Total support received')} value={inr(total)} />
        <Stat icon="graduation" tone="yellow" label={t('Scholarships')} value={inr(byType.Scholarship || 0)} />
        <Stat icon="sparkle" tone="blue" label={t('Other support')} value={inr(total - (byType.Scholarship || 0))} sub={t('Fees, books, uniforms')} />
      </div>
      <div className="card mt">
        <div className="card-head"><h2>{t('History')}</h2></div>
        {!data.length ? <Empty icon="heart" title={t('No support recorded yet')} text={t('When the trust gives you a scholarship or other help, it will appear here.')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Notes')}</th><th className="num">{t('Amount')}</th></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{date(a.given_on)}</td>
                    <td><Badge tone="green" plain>{t(a.type)}</Badge></td>
                    <td className="muted">{a.notes || '—'}</td>
                    <td className="num"><strong>{inr(a.amount)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>{t('Total')}</td><td className="num">{inr(total)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>
      <p className="small muted mt"><Icon name="info" size={14} style={{ verticalAlign: -2 }} /> {t('If something here looks wrong, please contact the trust office.')}</p>
    </>
  );
}
