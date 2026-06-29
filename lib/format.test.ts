import { describe, it, expect } from 'vitest';
import { formatNumber, usd, inr, compact, delta, formatPercent, precisionFor, toneClass } from './format';

describe('formatNumber — precision by magnitude (B5)', () => {
  it('keeps cents on large prices and groups them', () => {
    expect(usd(109421.52)).toBe('$109,421.52');
  });
  it('gives sub-unit crypto up to 8 decimals', () => {
    expect(formatNumber(0.00000001)).toBe('0.00000001');
  });
  it('uses scientific notation below 1e-8', () => {
    expect(formatNumber(0.000000001)).toBe('1.00e-9');
  });
  it('returns an em dash for non-finite input', () => {
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(Infinity)).toBe('—');
  });
  it('magnitude buckets', () => {
    expect(precisionFor(0.00005)).toBe(8);
    expect(precisionFor(0.5)).toBe(4);
    expect(precisionFor(42)).toBe(0);      // integer count
    expect(precisionFor(42.5)).toBe(2);    // fractional value
    expect(precisionFor(5000)).toBe(0);
    expect(precisionFor(50000)).toBe(0);
    expect(precisionFor(50000, 'USD')).toBe(2);
  });
});

describe('locale grouping', () => {
  it('formats USD with US grouping', () => {
    expect(usd(12345.6)).toBe('$12,345.60');
  });
  it('formats INR with lakh/crore grouping', () => {
    expect(inr(145000)).toBe('₹1,45,000.00');
    expect(inr(14500000, { precision: 0 })).toBe('₹1,45,00,000');
  });
});

describe('compact + deltas + percent', () => {
  it('compacts to K/M/B/T', () => {
    expect(compact(1500)).toBe('1.50K');
    expect(usd(2.14e12, { compact: true })).toBe('$2.14T');
    expect(compact(950)).toBe('950'); // below 1K, no suffix
  });
  it('signs deltas', () => {
    expect(delta(18)).toBe('+18');
    expect(delta(-42.5)).toBe('-42.50');
  });
  it('formats percentages signed by default', () => {
    expect(formatPercent(3.82)).toBe('+3.82%');
    expect(formatPercent(-1.1)).toBe('-1.10%');
    expect(formatPercent(0.21, { signed: false })).toBe('0.21%');
  });
  it('maps tone class', () => {
    expect(toneClass(1)).toBe('text-bull-bright');
    expect(toneClass(-1)).toBe('text-bear-bright');
    expect(toneClass(0)).toBe('text-ink-muted');
  });
});
