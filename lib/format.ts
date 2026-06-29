// MDS B5 — Numeral Design Language. The single source of truth for every
// number rendered in the product: precision by magnitude, signed semantic
// deltas, compact K/M/B/T, scientific notation for vanishing values, and
// USD/INR locale (lakh-crore) grouping. Pure + unit-tested.
//
// Pair the output with the `.num` / `font-mono` class (tabular-nums) so
// columns align. See DESIGN.md §B5.

export type Currency = 'USD' | 'INR' | 'none';

export interface NumOpts {
  currency?: Currency;
  /** K/M/B/T compaction for counts, volume, market cap. */
  compact?: boolean;
  /** Force a leading '+' on non-negative values (deltas). */
  signed?: boolean;
  /** Override the magnitude-derived decimal places (e.g. an exchange tick). */
  precision?: number;
}

const LOCALE: Record<Currency, string> = { USD: 'en-US', INR: 'en-IN', none: 'en-US' };
const SYMBOL: Record<Currency, string> = { USD: '$', INR: '₹', none: '' };
const COMPACT: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

/** Decimal places by magnitude (DESIGN.md §B5). Currency keeps cents at scale;
 *  non-currency integers (counts) stay integers, fractionals get 2 dp. */
export function precisionFor(abs: number, currency: Currency = 'none'): number {
  const cents = currency !== 'none';
  if (abs === 0) return cents ? 2 : 0;
  if (abs < 1e-4) return 8;              // sub-unit crypto (e.g. SHIB)
  if (abs < 1) return 4;                 // small alts
  if (cents) return 2;                   // prices always keep cents at scale
  return Number.isInteger(abs) ? 0 : 2;  // counts integer; values 2 dp
}

/** The core formatter; every other helper is a thin wrapper. */
export function formatNumber(value: number, opts: NumOpts = {}): string {
  const { currency = 'none', compact = false, signed = false, precision } = opts;
  if (!Number.isFinite(value)) return '—'; // em dash placeholder for N/A
  const sym = SYMBOL[currency];
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : '';
  const abs = Math.abs(value);

  // Vanishingly small: scientific, never a row of zeros.
  if (abs > 0 && abs < 1e-8) return `${sign}${sym}${abs.toExponential(2)}`;

  if (compact) {
    for (const [threshold, suffix] of COMPACT) {
      if (abs >= threshold) {
        const v = abs / threshold;
        const dp = v < 10 ? 2 : v < 100 ? 1 : 0;
        return `${sign}${sym}${v.toFixed(dp)}${suffix}`;
      }
    }
  }

  const dp = precision ?? precisionFor(abs, currency);
  const body = abs.toLocaleString(LOCALE[currency], { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${sign}${sym}${body}`;
}

export const usd = (v: number, o: Omit<NumOpts, 'currency'> = {}) => formatNumber(v, { ...o, currency: 'USD' });
export const inr = (v: number, o: Omit<NumOpts, 'currency'> = {}) => formatNumber(v, { ...o, currency: 'INR' });
export const compact = (v: number, o: Omit<NumOpts, 'compact'> = {}) => formatNumber(v, { ...o, compact: true });
/** A signed delta value (e.g. "+18", "-1.10"). */
export const delta = (v: number, o: NumOpts = {}) => formatNumber(v, { ...o, signed: true });

/** Percentages: signed by default, semantic-colored by the caller via toneClass. */
export function formatPercent(value: number, { signed = true, precision = 2 }: { signed?: boolean; precision?: number } = {}): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : '';
  return `${sign}${Math.abs(value).toFixed(precision)}%`;
}

/** Semantic Tailwind text class for a signed value (ties to F market-state grammar). */
export function toneClass(value: number): string {
  return value > 0 ? 'text-bull-bright' : value < 0 ? 'text-bear-bright' : 'text-ink-muted';
}
