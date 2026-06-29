// MDS — ChartPanel + LineChart. Standardizes the line/area chart pattern (equity
// curves, returns, performance) per the Data-Visualization Grammar (DESIGN.md §D):
// gridlines at low opacity, ≤6 token-driven series colors, axis labels via the
// numeral contract, gradient area fills, a baseline when a series crosses zero.
// ChartPanel = Panel + legend chrome; LineChart = the plot. Pure, token-driven.

import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/format';
import { Panel } from './Panel';
import { cx } from './util';

export interface ChartSeries { data: number[]; color: string; area?: boolean; }

export function LineChart({ series, height = 150, xLabels, yFormat, baseline, ariaLabel = 'Line chart', className }: {
  series: ChartSeries[];
  height?: number;
  xLabels?: string[];
  yFormat?: (n: number) => string;
  baseline?: boolean;            // draw a dashed zero line when the data straddles 0
  /** Screen-reader label for the plot (trend isn't conveyed by the axis text alone). */
  ariaLabel?: string;
  className?: string;
}) {
  const W = 360, pad = 4;
  const all = series.flatMap((s) => s.data);
  if (baseline) all.push(0);
  if (all.length < 2) return <div className={cx('flex items-center justify-center text-[10px] text-ink-faint', className)} style={{ height }}>No data</div>;
  const hi = Math.max(...all), lo = Math.min(...all), range = hi - lo || 1;
  const n = Math.max(...series.map((s) => s.data.length));
  const x = (i: number) => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / range) * (height - 2 * pad);
  const yTicks = [0, 1, 2, 3].map((i) => lo + (range * i) / 3);
  const fmt = yFormat ?? ((v: number) => formatNumber(v, { compact: true }));
  const path = (data: number[]) => data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const gid = (s: ChartSeries) => `lc${s.color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <div className={cx('flex gap-1.5', className)}>
      <div className="flex flex-col justify-between py-0.5 text-right font-mono text-[8px] text-ink-faint" style={{ height }}>
        {[...yTicks].reverse().map((t, i) => <span key={i}>{fmt(t)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
          <defs>
            {series.filter((s) => s.area).map((s) => (
              <linearGradient key={gid(s)} id={gid(s)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {yTicks.map((t, i) => <line key={i} x1={pad} y1={y(t)} x2={W - pad} y2={y(t)} stroke="var(--line)" strokeWidth="0.4" strokeDasharray="2 3" opacity="0.6" />)}
          {baseline && lo < 0 && hi > 0 && <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke="var(--ink-faint)" strokeWidth="0.5" strokeDasharray="3 3" />}
          {series.map((s) => (
            <g key={gid(s)}>
              {s.area && <path d={`${path(s.data)} L ${x(s.data.length - 1)} ${height - pad} L ${pad} ${height - pad} Z`} fill={`url(#${gid(s)})`} />}
              <path d={path(s.data)} fill="none" stroke={s.color} strokeWidth="1.6" strokeLinejoin="round" />
            </g>
          ))}
        </svg>
        {xLabels && <div className="mt-1 flex justify-between font-mono text-[8px] text-ink-faint">{xLabels.map((l, i) => <span key={i}>{l}</span>)}</div>}
      </div>
    </div>
  );
}

export interface LegendItem { label: string; color: string; value?: ReactNode; }

export function ChartPanel({ title, badge, info, action, legend, footer, className, children }: {
  title?: string; badge?: string; info?: boolean; action?: ReactNode; legend?: LegendItem[]; footer?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <Panel title={title} badge={badge} info={info} action={action} footer={footer} className={className}>
      {legend && legend.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-3 text-[11px]">
          {legend.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
              <span className="text-ink-muted">{l.label}</span>
              {l.value != null && <span className="num font-semibold text-ink">{l.value}</span>}
            </span>
          ))}
        </div>
      )}
      {children}
    </Panel>
  );
}
