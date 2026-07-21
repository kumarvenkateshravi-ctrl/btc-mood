import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { detectFvgs } from './fvg';

const C = (high: number, low: number, close: number, i: number): Candle => ({
  time: i * 3600, open: close, high, low, close, volume: 100,
});

describe('detectFvgs — LuxAlgo 3-bar gaps + mitigation', () => {
  it('detects a bullish FVG and marks it mitigated when close drops below its floor', () => {
    // i=2: low[2]=12 > high[0]=10, close[1]=10.5 > high[0]=10 → bull gap [top 12, bottom 10].
    // i=3: close 9 < 10 → mitigated at bar 3.
    const bars = [C(10, 8, 9, 0), C(11, 9, 10.5, 1), C(20, 12, 18, 2), C(9.5, 7, 9, 3)];
    const r = detectFvgs(bars, { thresholdPct: 0, auto: false });
    expect(r.fvgs).toEqual([{ isBull: true, top: 12, bottom: 10, startIndex: 2, endIndex: 3 }]);
    expect(r).toMatchObject({ bullCount: 1, bullMitigated: 1, bearCount: 0, bearMitigated: 0 });
  });

  it('detects a bearish FVG and mitigates when close rises above its ceiling', () => {
    // i=2: high[2]=15 < low[0]=18, close[1]=17.5 < low[0]=18 → bear gap [top 18, bottom 15].
    // i=3: close 19 > 18 → mitigated at bar 3.
    const bars = [C(20, 18, 19, 0), C(19, 17, 17.5, 1), C(15, 13, 14, 2), C(20, 15, 19, 3)];
    const r = detectFvgs(bars, { thresholdPct: 0, auto: false });
    expect(r.fvgs).toEqual([{ isBull: false, top: 18, bottom: 15, startIndex: 2, endIndex: 3 }]);
    expect(r).toMatchObject({ bearCount: 1, bearMitigated: 1, bullCount: 0 });
  });

  it('leaves an unmitigated gap open (endIndex null) when price never fills it', () => {
    // Same bull gap; b3 close 11 stays above the floor 10 → still open.
    const bars = [C(10, 8, 9, 0), C(11, 9, 10.5, 1), C(20, 12, 18, 2), C(13, 11, 11, 3)];
    const r = detectFvgs(bars, { thresholdPct: 0, auto: false });
    expect(r.fvgs).toEqual([{ isBull: true, top: 12, bottom: 10, startIndex: 2, endIndex: null }]);
    expect(r.bullMitigated).toBe(0);
  });

  it('threshold rejects gaps smaller than the required percentage', () => {
    // Gap (12-10)/10 = 20%. A 25% threshold rejects it.
    const bars = [C(10, 8, 9, 0), C(11, 9, 10.5, 1), C(20, 12, 18, 2), C(13, 11, 11, 3)];
    expect(detectFvgs(bars, { thresholdPct: 25, auto: false }).fvgs).toEqual([]);
  });
});
