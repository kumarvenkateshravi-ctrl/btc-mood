// MDS Phase B5 / Pass-2 — the Financial Information Language.
//
// Num is the ONLY legal way to render a financial value in the product. Callers
// pick a SEMANTIC variant (Price, Pnl, Pct, Delta, RR, Qty, Score, Compact,
// Money) instead of choosing formatting options ad hoc; each variant encodes the
// correct precision, sign behavior, semantic color and unit. Every variant emits
// the tabular `.num` class so columns align. See DESIGN.md §B5 / §B5-FREEZE.
//
// FROZEN: do not format numbers with toLocaleString/toFixed/manual concatenation
// in a page. If a new financial value type appears, add a variant HERE.

import type { ReactNode } from 'react';
import { formatNumber, formatPercent, toneClass, type Currency } from '@/lib/format';
import { cx, scoreColor } from './util';

interface Base { className?: string }

/** Generic formatted number (escape hatch). Prefer a semantic variant below. */
function NumBase({ value, currency, compact, signed, precision, tone, className }: Base & {
  value: number; currency?: Currency; compact?: boolean; signed?: boolean; precision?: number; tone?: boolean;
}) {
  return <span className={cx('num', tone && toneClass(value), className)}>{formatNumber(value, { currency, compact, signed, precision })}</span>;
}

/** Asset price. Currency + exchange-tick (or magnitude) precision. Neutral color. */
function Price({ value, currency = 'USD', precision, className }: Base & { value: number; currency?: Currency; precision?: number }) {
  return <span className={cx('num', className)}>{formatNumber(value, { currency, precision })}</span>;
}

/** A money amount (cents). Optional sign + semantic color. */
function Money({ value, currency = 'USD', signed, tone, className }: Base & { value: number; currency?: Currency; signed?: boolean; tone?: boolean }) {
  return <span className={cx('num', tone && toneClass(value), className)}>{formatNumber(value, { currency, signed })}</span>;
}

/** Profit / loss. ALWAYS signed and semantic-colored (the flagship money value). */
function Pnl({ value, currency = 'USD', className }: Base & { value: number; currency?: Currency }) {
  return <span className={cx('num font-semibold', toneClass(value), className)}>{formatNumber(value, { currency, signed: true })}</span>;
}

/** Percentage. Signed by default; semantic color is opt-in. */
function Pct({ value, signed = true, tone, precision, className }: Base & { value: number; signed?: boolean; tone?: boolean; precision?: number }) {
  return <span className={cx('num', tone && toneClass(value), className)}>{formatPercent(value, { signed, precision })}</span>;
}

/** A signed change: semantic color + optional directional arrow. */
function Delta({ value, percent, arrow = true, precision, className }: Base & { value: number; percent?: boolean; arrow?: boolean; precision?: number }) {
  const glyph = value > 0 ? '▲' : value < 0 ? '▼' : '';
  const body = percent ? formatPercent(value, { precision }) : formatNumber(value, { signed: true, precision });
  return <span className={cx('num inline-flex items-center gap-0.5', toneClass(value), className)}>{arrow && glyph && <span className="text-[0.72em] leading-none">{glyph}</span>}{body}</span>;
}

/** Risk:reward ratio, e.g. "1 : 2.4". */
function RR({ ratio, className }: Base & { ratio: number }) {
  return <span className={cx('num', className)}>1 : {ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}</span>;
}

/** A quantity / position size with an optional unit, e.g. "0.18 BTC". */
function Qty({ value, unit, precision = 3, className }: Base & { value: number; unit?: string; precision?: number }) {
  return <span className={cx('num', className)}>{formatNumber(value, { precision })}{unit && <span className="ml-0.5 text-[0.85em] text-ink-faint">{unit}</span>}</span>;
}

/** A 0-100 score. Integer; optional band color via the score ramp. */
function Score({ value, band, className }: Base & { value: number; band?: boolean }) {
  return <span className={cx('num font-semibold', className)} style={band ? { color: scoreColor(value) } : undefined}>{Math.round(value)}</span>;
}

/** Large counts / volume / market cap, compacted to K/M/B/T. */
function Compact({ value, currency, className }: Base & { value: number; currency?: Currency }) {
  return <span className={cx('num', className)}>{formatNumber(value, { currency, compact: true })}</span>;
}

/** The Num namespace: `<Num.Pnl />`, `<Num.Price />`, ... plus `<Num />` as the escape hatch. */
const Num = Object.assign(NumBase, { Price, Money, Pnl, Pct, Delta, RR, Qty, Score, Compact });
export default Num;

/** Convenience for KpiCard / callers that need a delta node. */
export type NumChild = ReactNode;
