/** BANA mark: three raised hands with stars, echoing the foundation's logo */
export function LogoMark({ size = 40 }) {
  const hand = (x, color, h) => (
    <g transform={`translate(${x} ${48 - h})`} fill={color}>
      <rect x="0" y="10" width="11" height={h - 10} rx="3" />
      <rect x="0" y="0" width="2.6" height="14" rx="1.3" />
      <rect x="2.9" y="-2" width="2.6" height="16" rx="1.3" />
      <rect x="5.8" y="-1" width="2.6" height="15" rx="1.3" />
      <rect x="8.6" y="1" width="2.4" height="13" rx="1.2" />
      <rect x="-2.5" y="12" width="3" height="7" rx="1.5" transform="rotate(-30 -1 15)" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 48 52" aria-label="BANA">
      {hand(6, '#b5532d', 34)}
      {hand(19, '#3f8f4f', 42)}
      {hand(32, '#2f8fa3', 32)}
      <g fill="#f5c542">
        <path d="M24 0l1.3 2.9 3.1.3-2.4 2 .8 3-2.8-1.6-2.8 1.6.8-3-2.4-2 3.1-.3z" />
        <circle cx="10" cy="9" r="1.5" />
        <circle cx="39" cy="10" r="1.5" />
        <circle cx="6" cy="3" r="1" />
        <circle cx="43" cy="4" r="1" />
      </g>
    </svg>
  );
}

export default function Logo({ light = true, size = 40 }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <LogoMark size={size} />
      <div className="brand-text" style={{ lineHeight: 1.1 }}>
        <strong style={{ display: 'block', fontSize: 20, fontWeight: 800, letterSpacing: '0.02em', color: light ? '#fff' : 'var(--green-900)' }}>BANA</strong>
        <span style={{ display: 'block', fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: light ? '#a9c2ae' : 'var(--muted)' }}>Development Foundation</span>
      </div>
    </div>
  );
}
