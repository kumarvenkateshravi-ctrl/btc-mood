// Shared VWAP anchoring — TradingView's VWAP "Anchor Period" selector.
// A change in the period key between consecutive bars resets the cumulative
// sums (Σpv, Σv, Σp²v), exactly like TV re-anchoring at the start of a period.

export type VwapAnchor = 'session' | 'week' | 'month' | 'quarter' | 'year';

export const VWAP_ANCHOR_OPTIONS = [
  { value: 'session', label: 'Session' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
] as const;

/**
 * Period bucket for a bar's open time (seconds). Session = UTC day (the start of
 * a 24/7 crypto session); weeks start Monday 00:00 UTC (epoch 1970-01-01 was a
 * Thursday, hence the +3 shift); month/quarter/year are UTC calendar buckets.
 */
export function vwapPeriodKey(timeSec: number, anchor: VwapAnchor): number {
  switch (anchor) {
    case 'week': {
      const days = Math.floor(timeSec / 86_400);
      return Math.floor((days + 3) / 7); // align week start to Monday
    }
    case 'month': {
      const d = new Date(timeSec * 1000);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    }
    case 'quarter': {
      const d = new Date(timeSec * 1000);
      return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
    }
    case 'year':
      return new Date(timeSec * 1000).getUTCFullYear();
    case 'session':
    default:
      return Math.floor(timeSec / 86_400); // UTC day
  }
}
