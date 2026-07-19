import { describe, expect, it } from 'vitest';
import { explainLifecycle } from './explanation';

const ctx = (o: Partial<Parameters<typeof explainLifecycle>[0]>) => ({
  timeframe: '1d' as const, stage: 'trend_establishment' as const,
  invalidation: { invalidated: false, condition: null }, overallMarketState: 'range_bound' as const,
  exhaustion: 20, ...o,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('explainLifecycle', () => {
  it('breakout stage names the TF in a strong signal', () => {
    const r = explainLifecycle(ctx({ stage: 'breakout' }));
    expect(codes(r.signals)).toContain('LC_BREAKOUT');
    expect(r.signals.find((s) => s.code === 'LC_BREAKOUT')!.message).toContain('1d');
  });
  it('trend_establishment / continuation / exhaustion each fire their own signal', () => {
    expect(codes(explainLifecycle(ctx({ stage: 'trend_establishment' })).signals)).toContain('LC_TREND');
    expect(codes(explainLifecycle(ctx({ stage: 'continuation' })).signals)).toContain('LC_CONTINUATION');
    expect(codes(explainLifecycle(ctx({ stage: 'exhaustion' })).signals)).toContain('LC_EXHAUSTION');
  });
  it('invalidation warning names the condition', () => {
    const r = explainLifecycle(ctx({ invalidation: { invalidated: true, condition: 'bias flip' } }));
    const w = r.warnings.find((x) => x.code === 'LC_INVALIDATION')!;
    expect(w.message).toContain('bias flip');
  });
  it('reversal_risk market state warns', () => {
    expect(codes(explainLifecycle(ctx({ overallMarketState: 'reversal_risk' })).warnings)).toContain('LC_REVERSAL_RISK');
  });
  it('high exhaustion warns', () => {
    expect(codes(explainLifecycle(ctx({ exhaustion: 85 })).warnings)).toContain('LC_EXHAUSTION_WARN');
  });
  it('healthy case (no controller-notable stage) returns without throwing', () => {
    expect(() => explainLifecycle(ctx({ stage: 'range' }))).not.toThrow();
  });
});
