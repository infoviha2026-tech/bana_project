import { useEffect, useState } from 'react';
import { getToken } from '../api.js';
import { initials } from '../format.js';

/* Authenticated images: fetched with the bearer token and shown from a blob URL (cached for the session) */

const cache = new Map();

export function useAuthImage(url) {
  const [src, setSrc] = useState(() => (url ? cache.get(url) : null));
  useEffect(() => {
    if (!url) { setSrc(null); return; }
    if (cache.has(url)) { setSrc(cache.get(url)); return; }
    let alive = true;
    fetch(`/api${url}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        const href = b ? URL.createObjectURL(b) : null;
        cache.set(url, href);
        if (alive) setSrc(href);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return src;
}

/** Forget a cached image (after uploading a new photo) */
export function bustImage(url) {
  const old = cache.get(url);
  if (old) URL.revokeObjectURL(old);
  cache.delete(url);
}

/** Student avatar: photo when available, initials otherwise */
export function StudentPhoto({ studentId, name, hasPhoto = true, size = 32, version = 0 }) {
  const src = useAuthImage(hasPhoto && studentId ? `/photos/students/${studentId}?v=${version}` : null);
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.36) };
  return src
    ? <img src={src} alt={name} className="avatar" style={{ ...style, objectFit: 'cover', background: 'var(--green-50)' }} />
    : <div className="avatar" style={style}>{initials(name)}</div>;
}

/** Story picture with a soft branded placeholder */
export function StoryImage({ story, height = 160, publicApi = false }) {
  const authed = useAuthImage(!publicApi && story.has_image ? `/stories/${story.id}/image` : null);
  const src = publicApi && story.has_image ? `/api/public/stories/${story.id}/image` : authed;
  return src
    ? <img src={src} alt="" style={{ width: '100%', height, objectFit: 'cover', display: 'block' }} />
    : (
      <div style={{ height, background: 'linear-gradient(135deg, var(--green-800), var(--green-600))', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.85)', fontWeight: 800, fontSize: 18, padding: 16, textAlign: 'center' }}>
        {story.village || 'BANA'}
      </div>
    );
}
