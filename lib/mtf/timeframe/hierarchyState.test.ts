import { describe, expect, it } from 'vitest';
import type { Verdict } from '../types';
import type { RegimeType, TimeframeSnapshot } from './timeframeTypes';
import { computeTimeframeHierarchy } from './hierarchy';

const snap = (
  timeframe: TimeframeSnapshot['timeframe'], bias: Verdict, confidence: number,
  regimeClarity = 60, regime: RegimeType = 'trending_up',
): TimeframeSnapshot => ({ timeframe, bias, agreement: confidence, conflict: 0, confidence, regime, regimeClarity, trendFreshness: 0, momentumExhaustion: 0 });
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('hierarchy overallMarketState + transition + explanation', () => {
  it('aligned trigger → bullish_continuation + TF_STACK_ALIGNED', () => {
    const r = computeTimeframeHierarchy([
      snap('1d', 'bullish', 90, 80), snap('4h', 'bullish', 85, 70),
      snap('1h', 'bullish', 80, 60), snap('15m', 'bullish', 75), snap('5m', 'bullish', 70),
    ]);
    expect(r.overallMarketState).toBe('bullish_continuation');
    expect(codes(r.signals)).toContain('TF_STACK_ALIGNED');
    expect(r.transition).toBe(false);
  });

  it('opposed trigger + strong context → bullish_pullback', () => {
    const r = computeTimeframeHierarchy([
      snap('1d', 'bullish', 90, 80), snap('4h', 'bullish', 85, 70), snap('1h', 'bullish', 70, 60),
      snap('15m', 'bearish', 60), snap('5m', 'bearish', 60),
    ]);
    expect(r.htfBias).toBe('bullish');
    expect(r.overallMarketState).toBe('bullish_pullback');
    expect(codes(r.warnings)).toContain('TF_LTF_DIVERGENCE');
  });

  it('opposed trigger + weak context → reversal_risk', () => {
    const r = computeTimeframeHierarchy([
      snap('1d', 'bullish', 40, 30), snap('4h', 'bullish', 45, 30),
      snap('15m', 'bearish', 80, 80), snap('5m', 'bearish', 80, 80),
    ]);
    expect(r.htfBias).toBe('bullish');
    expect(r.overallMarketState).toBe('reversal_risk');
    expect(codes(r.warnings)).toContain('TF_REVERSAL_RISK');
  });

  it('neutral htfBias + compression controller → compression', () => {
    const r = computeTimeframeHierarchy([snap('1d', 'neutral', 80, 70, 'compression'), snap('4h', 'neutral', 75, 60, 'compression')]);
    expect(r.htfBias).toBe('neutral');
    expect(r.overallMarketState).toBe('compression');
  });

  it('control transfer surfaces a warning naming both TFs', () => {
    const r = computeTimeframeHierarchy([snap('1d', 'bullish', 20, 20), snap('4h', 'bullish', 90, 80)]);
    const w = r.warnings.find((x) => x.code === 'TF_CONTROL_TRANSFER')!;
    expect(w.message).toContain('1d');
    expect(w.message).toContain('4h');
  });

  it('conflicting stack → transition true + TF_STACK_CONFLICT', () => {
    const r = computeTimeframeHierarchy([snap('1d', 'bullish', 80), snap('4h', 'bearish', 80)]);
    expect(r.conflict).toBeGreaterThanOrEqual(50);
    expect(r.transition).toBe(true);
    expect(codes(r.warnings)).toContain('TF_STACK_CONFLICT');
  });
});
