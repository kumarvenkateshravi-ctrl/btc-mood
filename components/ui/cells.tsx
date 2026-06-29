// MDS Pass-3 (pre-DataTable) — Financial Cells.
//
// The shared vocabulary for every table, list and domain row. Clean layering:
//   DataTable / PositionRow  ->  Financial Cells  ->  Num.*
// Num formats the value, cells add DOMAIN semantics (alignment, the score badge,
// status -> Badge tone, timestamp formatting) and table presentation. A cell
// renders a <td> by default; pass as="div" for list/card contexts.
// See DESIGN.md §B5-FREEZE (numbers) and §H (tables).

import type { ReactNode } from 'react';
import { type Currency } from '@/lib/format';
import Num from './Num';
import { Badge } from './Badge';
import { cx, scoreColor, type Tone } from './util';

type CellAs = 'td' | 'div';
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export interface CellProps { align?: keyof typeof ALIGN; as?: CellAs; className?: string; }

/** Base cell: handles td/div, alignment and padding. */
export function Cell({ align = 'right', as = 'td', className, children }: CellProps & { children: ReactNode }) {
  const cls = cx('py-2 align-middle', ALIGN[align], className);
  return as === 'td' ? <td className={cls}>{children}</td> : <div className={cls}>{children}</div>;
}

const pricePrecision = (v: number) => (Math.abs(v) < 10 ? 4 : Math.abs(v) < 1000 ? 2 : 1);

/** An asset price (no currency symbol by default; tables imply the unit). */
export function PriceCell({ value, currency = 'none', precision, muted, ...rest }: CellProps & { value: number; currency?: Currency; precision?: number; muted?: boolean }) {
  return <Cell align="right" {...rest}><Num.Price value={value} currency={currency} precision={precision ?? pricePrecision(value)} className={muted ? 'text-ink-muted' : undefined} /></Cell>;
}

/** Profit / loss money: always signed + semantic color. */
export function PnlCell({ value, currency = 'USD', ...rest }: CellProps & { value: number; currency?: Currency }) {
  return <Cell align="right" {...rest}><Num.Pnl value={value} currency={currency} /></Cell>;
}

/** A percentage. Default: signed + semantic color (a change/return). Pass `plain`
 *  for a magnitude like win rate or allocation. */
export function PercentCell({ value, plain, precision, ...rest }: CellProps & { value: number; plain?: boolean; precision?: number }) {
  return <Cell align="right" {...rest}><Num.Pct value={value} signed={!plain} tone={!plain} precision={precision} /></Cell>;
}

/** A quantity / size with an optional unit (e.g. "0.18 BTC"). */
export function QtyCell({ value, unit, precision, ...rest }: CellProps & { value: number; unit?: string; precision?: number }) {
  return <Cell align="right" {...rest}><Num.Qty value={value} unit={unit} precision={precision} /></Cell>;
}

/** A 0-100 score. Default visual is the circular health badge, band-colored. */
export function ScoreCell({ value, variant = 'badge', ...rest }: CellProps & { value: number; variant?: 'badge' | 'plain' }) {
  const col = scoreColor(value);
  return (
    <Cell align="center" {...rest}>
      {variant === 'badge'
        ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold" style={{ borderColor: col, color: col }}><Num.Score value={value} /></span>
        : <Num.Score value={value} band />}
    </Cell>
  );
}

/** A timestamp. Accepts ms / Date; formats time | date | datetime | relative. */
export function TimestampCell({ value, format = 'time', ...rest }: CellProps & { value: number | Date; format?: 'time' | 'date' | 'datetime' | 'relative' }) {
  const d = value instanceof Date ? value : new Date(value);
  let text: string;
  if (format === 'date') text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  else if (format === 'datetime') text = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  else if (format === 'relative') text = relativeTime(d);
  else text = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return <Cell align="left" {...rest}><span className="num text-ink-faint">{text}</span></Cell>;
}
function relativeTime(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** A status / category string -> a semantic Badge. Direction, outcome, action all
 *  map to a consistent tint. Override the tone with `tone`. */
const STATUS_TONE: Record<string, Tone> = {
  Long: 'bull', Short: 'bear', Buy: 'bull', Sell: 'bear',
  Win: 'bull', Loss: 'bear', Breakeven: 'neutral',
  Hold: 'bull', Watch: 'warn', Reduce: 'warn', Exit: 'bear', 'Take Profit': 'bull',
  Active: 'accent', Open: 'accent', Closed: 'neutral', Live: 'bull',
  Bullish: 'bull', Bearish: 'bear', Neutral: 'neutral',
};
export function StatusCell({ value, tone, ...rest }: CellProps & { value: string; tone?: Tone }) {
  return <Cell align="center" {...rest}><Badge tone={tone ?? STATUS_TONE[value] ?? 'neutral'}>{value}</Badge></Cell>;
}
