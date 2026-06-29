// MDS Phase C — data-viz primitives. One consistent visual language for the
// gauges, rings, sparklines and donuts repeated across pages. Token-driven
// colors (CSS vars) so they follow the theme. See DESIGN.md §D.

import type { ReactNode } from 'react';
import { clamp, scoreColor } from './util';

/** Semicircle gauge with optional needle, glow and centered value/label. */
export function Gauge({ value, max = 100, color, label, showValue = true, needle = true, width = 144, className }: {
  value: number; max?: number; color?: string; label?: string; showValue?: boolean; needle?: boolean; width?: number; className?: string;
}) {
  const v = clamp((value / max) * 100, 0, 100);
  const col = color ?? scoreColor(v);
  const angle = -90 + (v / 100) * 180;
  return (
    <div className={['flex flex-col items-center', className].filter(Boolean).join(' ')}>
      <svg viewBox="0 0 200 116" style={{ width }} aria-hidden="true">
        <defs><filter id="gaugeGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke="var(--surface-3)" strokeWidth="13" strokeLinecap="round" />
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke={col} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${(v / 100) * 267} 400`} style={{ filter: 'url(#gaugeGlow)' }} />
        {needle && <g transform={`rotate(${angle} 100 105)`}><line x1="100" y1="105" x2="100" y2="42" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="105" r="5" fill="var(--ink)" /></g>}
      </svg>
      {showValue && <div className="-mt-5 font-mono text-2xl font-bold" style={{ color: col }}>{Math.round(value)}</div>}
      {label && <div className="text-xs font-semibold" style={{ color: col }}>{label}</div>}
    </div>
  );
}

/** Circular progress ring with optional centered content. */
export function Ring({ value, max = 100, size = 40, thickness = 4, color = 'var(--bull-bright)', track = 'var(--surface-3)', glow, children }: {
  value: number; max?: number; size?: number; thickness?: number; color?: string; track?: string; glow?: boolean; children?: ReactNode;
}) {
  const v = clamp((value / max) * 100, 0, 100);
  const r = 18 - thickness / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke={track} strokeWidth={thickness} />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} style={glow ? { filter: `drop-shadow(0 0 2px ${color})` } : undefined} />
      </svg>
      {children != null && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}

/** Mini sparkline with optional gradient area fill and end dot. */
export function Sparkline({ data, color = 'var(--accent)', area = true, dot = false, width = 56, height = 24, className }: {
  data: number[]; color?: string; area?: boolean; dot?: boolean; width?: number; height?: number; className?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const X = (i: number) => (i / (data.length - 1)) * width;
  const Y = (p: number) => height - 2 - ((p - min) / range) * (height - 4);
  const line = data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(p).toFixed(1)}`).join(' ');
  const id = `spk-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} style={{ width, height }} aria-hidden="true">
      {area && <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.32" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>}
      {area && <path d={`${line} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {dot && <circle cx={X(data.length - 1)} cy={Y(data[data.length - 1])} r="1.7" fill={color} />}
    </svg>
  );
}

/** Categorical donut. Slices are drawn in order with small gaps. */
export function Donut({ slices, size = 64, thickness = 9, track = 'var(--surface-3)', children }: {
  slices: { value: number; color: string }[]; size?: number; thickness?: number; track?: string; children?: ReactNode;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const r = 18 - thickness / 2;
  const c = 2 * Math.PI * r;
  const angles = slices.map((s) => (s.value / total) * c);
  const offsets = angles.map((_, i) => angles.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke={track} strokeWidth={thickness} />
        {slices.map((s, i) => (
          <circle key={i} cx="18" cy="18" r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${angles[i]} ${c}`} strokeDashoffset={-offsets[i]} />
        ))}
      </svg>
      {children != null && <span className="absolute inset-0 flex flex-col items-center justify-center">{children}</span>}
    </span>
  );
}
