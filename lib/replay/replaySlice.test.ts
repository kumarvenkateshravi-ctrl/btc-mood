import { describe, it, expect } from 'vitest';
import { sliceAtTime, sliceCandlesByTf, replayIndexForTime, TF_SECONDS } from './replaySlice';
import { validateReplayData } from './validate';
import type { Candle, Timeframe } from '@/lib/types';

/** Contiguous series for a tf starting at t0. */
function series(tf: Timeframe, t0: number, count: number): Candle[] {
  const step = TF_SECONDS[tf];
  return Array.from({ length: count }, (_, i) => ({
    time: t0 + i * step,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 10,
  }));
}

const T0 = 1_700_000_000 - (1_700_000_000 % 86400); // day-aligned epoch

describe('sliceCandlesByTf (Prime Invariant)', () => {
  const byTf: Partial<Record<Timeframe, Candle[]>> = {
    '15m': series('15m', T0, 200),
    '5m': series('5m', T0, 600),
    '1h': series('1h', T0, 50),
    '1d': series('1d', T0, 3),
  };
  // Replay bar = 15m bar #21 (opens T0+21*900, closes T0+22*900 = "now").
  const cutBar = byTf['15m']![21];
  const now = cutBar.time + TF_SECONDS['15m'];
  const sliced = sliceCandlesByTf(byTf, '15m', cutBar);

  it('no timeframe contains a bar that CLOSES after now (except the synthesized forming bar)', () => {
    for (const tf of Object.keys(sliced) as Timeframe[]) {
      for (const c of sliced[tf]!) {
        // every bar opened before now
        expect(c.time).toBeLessThan(now);
      }
    }
  });

  it('eval tf keeps exactly the bars up to the cut', () => {
    expect(sliced['15m']!.length).toBe(22);
    expect(sliced['15m']![21].time).toBe(cutBar.time);
  });

  it('lower tf keeps only bars closed by now', () => {
    // now = T0 + 22*900 → 5m bars closed by then = (22*900)/300 = 66
    expect(sliced['5m']!.length).toBe(66);
    const last = sliced['5m']![65];
    expect(last.time + TF_SECONDS['5m']).toBeLessThanOrEqual(now);
  });

  it('higher tf forming bar is synthesized from the eval slice, not the stored bar', () => {
    // now = T0 + 19800s → 5 full hours closed, 6th hour forming (opened T0+18000)
    const hours = sliced['1h']!;
    expect(hours.length).toBe(6);
    const forming = hours[5];
    expect(forming.time).toBe(T0 + 5 * 3600);
    // Window covers 15m bars #20 and #21 → open of #20, close of #21
    const b20 = byTf['15m']![20];
    const b21 = byTf['15m']![21];
    expect(forming.open).toBe(b20.open);
    expect(forming.close).toBe(b21.close);
    expect(forming.high).toBe(Math.max(b20.high, b21.high));
    expect(forming.low).toBe(Math.min(b20.low, b21.low));
    expect(forming.volume).toBe(b20.volume + b21.volume);
    // and it must differ from the stored (fully formed) hour bar
    expect(forming.close).not.toBe(byTf['1h']![5].close);
  });

  it('daily forming bar synthesizes from all eval bars of the day', () => {
    const days = sliced['1d']!;
    expect(days.length).toBe(1); // day 0 forming (opened T0, closes T0+86400 > now)
    expect(days[0].time).toBe(T0);
    expect(days[0].close).toBe(cutBar.close);
  });

  it('replayIndexForTime keeps the moment across TF switches (round-trips on the eval TF)', () => {
    // now = close of 15m bar #21
    expect(replayIndexForTime(byTf['15m']!, '15m', now)).toBe(21); // round-trip
    expect(replayIndexForTime(byTf['5m']!, '5m', now)).toBe(65); // 66 closed 5m bars → head 65
    expect(replayIndexForTime(byTf['1h']!, '1h', now)).toBe(4); // 5 closed hours → head 4
    // clamps to 1 when the moment predates the series
    expect(replayIndexForTime(byTf['1h']!, '1h', T0 - 100)).toBe(1);
  });

  it('sliceAtTime handles edges', () => {
    expect(sliceAtTime([], 123)).toEqual([]);
    expect(sliceAtTime(series('15m', T0, 5), T0 - 1)).toEqual([]);
  });
});

describe('validateReplayData', () => {
  it('accepts a clean series', () => {
    expect(validateReplayData(series('15m', T0, 50), '15m').ok).toBe(true);
  });

  it('reports missing candles', () => {
    const s = series('15m', T0, 50);
    s.splice(10, 3); // remove 3 bars → gap
    const v = validateReplayData(s, '15m');
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/Missing 3 candles/);
  });

  it('reports duplicates and broken OHLC', () => {
    const s = series('15m', T0, 20);
    s[5] = { ...s[4] }; // duplicate timestamp
    s[8] = { ...s[8], high: s[8].low - 1 }; // broken OHLC
    const v = validateReplayData(s, '15m');
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/duplicate/i);
    expect(v.problems.join(' ')).toMatch(/broken OHLC/);
  });

  it('rejects too-short history', () => {
    expect(validateReplayData(series('15m', T0, 5), '15m').ok).toBe(false);
  });
});
