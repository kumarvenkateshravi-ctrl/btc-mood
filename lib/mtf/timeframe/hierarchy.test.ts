import { describe, expect, it } from 'vitest';
import type { Verdict } from '../types';
import type { RegimeType, TimeframeSnapshot } from './timeframeTypes';
import { authorityOf, computeTimeframeHierarchy } from './hierarchy';

const snap = (
  timeframe: TimeframeSnapshot['timeframe'], bias: Verdict, confidence: number,
  regimeClarity = 60, regime: RegimeType = 'trending_up',
): TimeframeSnapshot => ({ timeframe, bias, agreement: confidence, conflict: 0, confidence, regime, regimeClarity });

describe('computeTimeframeHierarchy — vote, authority, controller', () => {
  it('aligned bullish stack → htfBias bullish, high alignment, controller = top TF', () => {
    const r = computeTimeframeHierarchy([snap('1d', 'bullish', 90, 80), snap('4h', 'bullish', 85, 70), snap('1h', 'bullish', 80, 60)]);
    expect(r.htfBias).toBe('bullish');
    expect(r.alignment).toBe(100);
    expect(r.controller).toBe('1d');
    expect(r.perTimeframe['1d']!.agreesWithHTF).toBe(true);
  });

  it('authority = round(0.6·confidence + 0.4·clarity)', () => {
    expect(authorityOf(90, 80)).toBe(86);
    const r = computeTimeframeHierarchy([snap('4h', 'bullish', 90, 80)]);
    expect(r.perTimeframe['4h']!.authority).toBe(86);
  });

  it('control transfers down when the top TF loses authority', () => {
    // 1d authority = round(.6·20+.4·20)=20 (<55); 4h = round(.6·90+.4·80)=86
    const r = computeTimeframeHierarchy([snap('1d', 'bullish', 20, 20), snap('4h', 'bullish', 90, 80), snap('1h', 'bullish', 80, 60)]);
    expect(r.controller).toBe('4h');
    expect(r.controllerAuthority).toBe(86);
  });

  it('agreesWithHTF reflects the controller bias', () => {
    const r = computeTimeframeHierarchy([snap('1d', 'bullish', 90, 80), snap('4h', 'bearish', 85, 70)]);
    expect(r.perTimeframe['1d']!.agreesWithHTF).toBe(true);   // controller is 1d, bullish
    expect(r.perTimeframe['4h']!.agreesWithHTF).toBe(false);
  });

  it('empty snapshots → safe neutral result', () => {
    const r = computeTimeframeHierarchy([]);
    expect(r.htfBias).toBe('neutral');
    expect(r.alignment).toBe(0);
    expect(r.contributors).toEqual([]);
    expect(r.perTimeframe).toEqual({});
  });
});
