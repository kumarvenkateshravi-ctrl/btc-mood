import { describe, it, expect } from 'vitest';
import { planDeepLoad, MAX_BARS_PER_TF, earliestReplayDateMs } from './deepLoad';

const NOW = Date.UTC(2026, 6, 13);
const YEARS = (n: number) => NOW - n * 365 * 86400 * 1000;

describe('planDeepLoad', () => {
  it('loads the selected TF and everything above it, selected first', () => {
    const steps = planDeepLoad('1h', YEARS(5), NOW);
    expect(steps.map((s) => s.tf)).toEqual(['1h', '4h', '1d']);
    expect(steps[0].untilMs).toBe(YEARS(5)); // uncapped TF honors the request
  });

  it('caps intraday depth: 5m never loads more than 6 months', () => {
    const steps = planDeepLoad('5m', YEARS(5), NOW);
    const m5 = steps.find((s) => s.tf === '5m')!;
    expect(m5.untilMs).toBeGreaterThan(YEARS(1)); // clamped to ~6 months back
    // higher uncapped TFs still reach the full request
    expect(steps.find((s) => s.tf === '1h')!.untilMs).toBe(YEARS(5));
  });

  it('page budget matches the span (5y of 1h ≈ 44 pages, 1d ≈ 2 pages)', () => {
    const steps = planDeepLoad('1h', YEARS(5), NOW);
    const h1 = steps.find((s) => s.tf === '1h')!;
    expect(h1.maxPages).toBeGreaterThanOrEqual(44);
    expect(h1.maxPages).toBeLessThanOrEqual(46);
    const d1 = steps.find((s) => s.tf === '1d')!;
    expect(d1.maxPages).toBeLessThanOrEqual(3);
  });

  it('never exceeds the absolute bar safety valve', () => {
    const steps = planDeepLoad('5m', YEARS(10), NOW);
    for (const s of steps) expect(s.maxPages * 1000).toBeLessThanOrEqual(MAX_BARS_PER_TF + 1000);
  });

  it('returns nothing for a future or now target', () => {
    expect(planDeepLoad('1h', NOW + 1000, NOW)).toEqual([]);
  });

  it('skips TFs below the selected one', () => {
    const steps = planDeepLoad('4h', YEARS(3), NOW);
    expect(steps.map((s) => s.tf)).toEqual(['4h', '1d']);
  });
});

describe('earliestReplayDateMs', () => {
  const NOW = Date.UTC(2026, 6, 14);
  it('1d and 4h reach the exchange listing (Aug 2017)', () => {
    expect(earliestReplayDateMs('1d', NOW)).toBe(Date.UTC(2017, 7, 17));
    expect(earliestReplayDateMs('4h', NOW)).toBe(Date.UTC(2017, 7, 17));
  });
  it('1h is bounded by the 75k-bar valve (~8.5 years — within months of listing)', () => {
    const ms = earliestReplayDateMs('1h', NOW);
    const years = (NOW - ms) / (365 * 86400 * 1000);
    expect(years).toBeGreaterThan(8.3);
    expect(years).toBeLessThan(8.7);
    // Jan 1st 2020 is comfortably selectable on 1h
    expect(ms).toBeLessThan(Date.UTC(2020, 0, 1));
  });
  it('intraday TFs disclose their depth caps', () => {
    expect(NOW - earliestReplayDateMs('5m', NOW)).toBe(180 * 86400 * 1000);
    expect(NOW - earliestReplayDateMs('15m', NOW)).toBe(2 * 365 * 86400 * 1000);
    expect(NOW - earliestReplayDateMs('30m', NOW)).toBe(3 * 365 * 86400 * 1000);
  });
});
