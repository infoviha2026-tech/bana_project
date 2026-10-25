import { useState } from 'react';
import { inr, inrShort } from '../format.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

/** Vertical bar chart. data: [{ label, value }] */
export function BarChart({ data, height = 220, format = inrShort, highlightLast }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = height, padL = 54, padB = 26, padT = 12;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const bw = (W - padL) / Math.max(data.length, 1);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const h = hover != null ? data[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const bh = Math.max(d.value ? 2 : 0, H - padB - y(d.value));
          const w = Math.min(bw * 0.62, 44);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              <rect className={`bar ${highlightLast && i === data.length - 1 ? 'hl' : ''}`} x={padL + i * bw + (bw - w) / 2} y={H - padB - bh} width={w} height={bh} rx="4" />
              <text x={padL + i * bw + bw / 2} y={H - 8} textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {h && (
        <div style={{ position: 'absolute', top: 0, left: `${((padL + hover * bw + bw / 2) / W) * 100}%`, transform: 'translateX(-50%)', background: 'var(--green-950)', color: '#fff', padding: '5px 9px', borderRadius: 7, fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <strong>{inr(h.value)}</strong> · {h.full || h.label}
        </div>
      )}
    </div>
  );
}

/** Line chart with points. data: [{ label, value }]; optional dashed threshold line */
export function LineChart({ data, max, suffix = '', threshold, color = 'var(--green-700)', height = 200 }) {
  const [hover, setHover] = useState(null);
  const W = 560, H = height, padL = 36, padR = 12, padT = 14, padB = 28;
  const top = max ?? niceMax(Math.max(...data.map((d) => d.value), 1));
  const x = (i) => padL + (data.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (data.length - 1));
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const every = Math.ceil(data.length / 8);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}><line className="grid-line" x1={padL} x2={W - padR} y1={y(f * top)} y2={y(f * top)} /><text x={padL - 6} y={y(f * top) + 4} textAnchor="end">{Math.round(f * top)}{suffix}</text></g>
      ))}
      {threshold != null && <line x1={padL} x2={W - padR} y1={y(threshold)} y2={y(threshold)} stroke="var(--red)" strokeDasharray="5 4" strokeWidth="1.5" opacity="0.7" />}
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 6 : 4} fill="#fff" stroke={threshold != null && d.value < threshold ? 'var(--red)' : color} strokeWidth="2.5" />
          <rect x={x(i) - 14} y={padT} width={28} height={H - padT - padB} fill="transparent" />
          {hover === i && <text x={x(i)} y={y(d.value) - 10} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 700, fontSize: 12 }}>{d.value}{suffix}</text>}
          {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle">{d.label}</text>}
        </g>
      ))}
    </svg>
  );
}

/** Grouped vertical bars. data: [{ label, values: [n, n, …] }], series: [{ name, color }] */
export function GroupedBars({ data, series, height = 240, format = inrShort }) {
  const [hover, setHover] = useState(null);
  const W = 680, H = height, padL = 54, padB = 26, padT = 12;
  const max = niceMax(Math.max(...data.flatMap((d) => d.values), 0));
  const gw = (W - padL) / Math.max(data.length, 1);
  const bw = Math.min((gw * 0.8) / series.length, 18);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <div>
      <div className="row wrap small" style={{ gap: 14, marginBottom: 8 }}>
        {series.map((s) => <span key={s.name} className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.name}</span>)}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}><line className="grid-line" x1={padL} x2={W} y1={y(f * max)} y2={y(f * max)} /><text x={padL - 8} y={y(f * max) + 4} textAnchor="end">{format(f * max)}</text></g>
        ))}
        {data.map((d, i) => {
          const x0 = padL + i * gw + (gw - bw * series.length) / 2;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * gw} y={padT} width={gw} height={H - padT - padB} fill={hover === i ? 'rgba(31,77,43,0.04)' : 'transparent'} />
              {d.values.map((v, j) => <rect key={j} x={x0 + j * bw} y={y(v)} width={bw - 2} height={Math.max(0, H - padB - y(v))} rx="2" fill={series[j].color} />)}
              <text x={padL + i * gw + gw / 2} y={H - 8} textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="small row wrap" style={{ gap: 14, marginTop: 4 }}>
          <strong>{data[hover].label}</strong>
          {series.map((s, j) => <span key={s.name}>{s.name}: <strong>{inr(data[hover].values[j])}</strong></span>)}
        </div>
      )}
    </div>
  );
}

/** Horizontal ranked bars. data: [{ label, value }] */
export function HBars({ data, format = inr }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="hbar">
      {data.map((d) => (
        <div className="hbar-row" key={d.label}>
          <div className="hbar-label"><span>{d.label}</span><span>{format(d.value)}</span></div>
          <div className="hbar-track"><div style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
