import { useState } from 'react';
import Icon from '../components/Icons.jsx';
import { StoryImage } from '../components/Media.jsx';
import { Badge, Empty, ErrorBox, Loading, Modal, PageHead, useFetch } from '../components/ui.jsx';
import { date } from '../format.js';
import { useT } from '../i18n.jsx';

export function StoryCard({ s, onOpen, publicApi }) {
  return (
    <button className="card" onClick={() => onOpen(s)} style={{ padding: 0, overflow: 'hidden', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}>
      <StoryImage story={s} publicApi={publicApi} />
      <div style={{ padding: 16, flex: 1 }}>
        <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
          {s.village && <Badge plain>{s.village}</Badge>}
          {s.funded_by_me && <Badge tone="yellow" plain>You helped fund this</Badge>}
        </div>
        <h3>{s.title}</h3>
        <p className="small muted" style={{ marginTop: 6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.excerpt || s.body}</p>
        <div className="small faint" style={{ marginTop: 8 }}>{date(s.created_at)}{s.project_name ? ` · ${s.project_name}` : ''}</div>
      </div>
    </button>
  );
}

export default function Stories() {
  const t = useT();
  const { data, loading, error, reload } = useFetch('/stories');
  const [open, setOpen] = useState(null);
  const [mine, setMine] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const rows = mine ? data.filter((s) => s.funded_by_me) : data;
  return (
    <>
      <PageHead title={t('Impact Stories')} subtitle={t('Updates and photos from the villages and projects you support.')}
        actions={data.some((s) => s.funded_by_me) && (
          <label className="checkbox"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{t('Only projects I funded')}</label>
        )} />
      {!rows.length ? <div className="card"><Empty icon="image" title={t('No stories yet')} /></div> : (
        <div className="grid grid-3">{rows.map((s) => <StoryCard key={s.id} s={s} onOpen={setOpen} />)}</div>
      )}
      {open && (
        <Modal wide title={open.title} onClose={() => setOpen(null)}>
          <div style={{ margin: '-20px -22px 16px', overflow: 'hidden' }}><StoryImage story={open} height={280} /></div>
          <div className="small muted" style={{ marginBottom: 10 }}><Icon name="mapPin" size={13} style={{ verticalAlign: -2 }} /> {open.village || '—'} · {date(open.created_at)}{open.project_name ? ` · ${open.project_name}` : ''}</div>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{open.body}</p>
        </Modal>
      )}
    </>
  );
}
