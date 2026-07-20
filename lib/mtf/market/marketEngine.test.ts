import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../../types';
import { computeFullMarketIntelligence, computeMarketIntelligence } from './marketEngine';
import { agr, conf, hier, lcyc, prob } from './testFixtures';

const series = (n: number, base: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return { time: i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 80 };
  });

const BANNED = /\b(likely|expected|will|probable|should|forecast|anticipat\w*|predict\w*)\b/i;
const LAYERS = ['M3', 'M4', 'M5', 'M6', 'M7', 'M8'];

describe('computeMarketIntelligence — projections (controlled fixture)', () => {
  const hierarchy = hier({
    htfBias: 'bullish', overallMarketState: 'bullish_continuation', controller: '4h', alignment: 70, conflict: 20, transition: false,
    perTimeframe: { '4h': { timeframe: '4h', bias: 'bullish', confidence: 70, regime: 'trending_up', regimeClarity: 60, role: 'context', authority: 70, agreesWithHTF: true } },
  });
  const r = computeMarketIntelligence(agr({ agreement: 74 }), conf({ confidence: 68 }), hierarchy, lcyc({ stage: 'continuation', lifecycleStrength: 60 }), prob());

  it('headline mirrors the frozen inputs (incl. controller regime)', () => {
    expect(r.headline).toEqual({
      bias: 'bullish', state: 'bullish_continuation', controller: '4h', regime: 'trending_up',
      stage: 'continuation', mostLikelyOutcome: 'continuation', outcomeProbability: 0.5, calibration: 'prior',
    });
  });

  it('regime falls back to ranging when the controller has no perTimeframe entry', () => {
    const r2 = computeMarketIntelligence(agr(), conf(), hier({ controller: '1d' }), lcyc(), prob());
    expect(r2.headline.regime).toBe('ranging');
  });

  it('outlook + diagnostics are pure pass-throughs', () => {
    expect(r.outlook.expectedStage).toBe('healthy_pullback');
    expect(r.outlook.marketOutcomes).toHaveLength(2);
    expect(r.outlook.transition).toBe(false);
    expect(r.diagnostics.schemaVersions).toEqual({ agreement: 1, confidence: 1, hierarchy: 1, lifecycle: 1, probability: 1 });
    expect(r.diagnostics.scores).toEqual({ agreement: 74, confidence: 68, alignment: 70, conflict: 20, lifecycleStrength: 60, probabilityOpportunity: 40 });
  });

  it('M8 readiness note appears in the unified feed', () => {
    const mi = r.signals.find((s) => s.code === 'MI_READINESS')!;
    expect(mi.source).toBe('M8');
    expect(mi.message).toContain(r.readiness.state);
  });
});

describe('computeFullMarketIntelligence — real M0→M8 pipeline', () => {
  const candlesByTf: Partial<Record<Timeframe, Candle[]>> = {
    '1d': series(260, 100, 0.6), '4h': series(260, 100, 0.5), '1h': series(260, 100, 0.4),
  };

  it('well-formed synthesis with traceable evidence and clean narrative', () => {
    const { result, layers } = computeFullMarketIntelligence(candlesByTf);
    expect(result.schemaVersion).toBe(1);
    expect(result.headline.calibration).toBe('prior');
    expect(['ready', 'wait', 'no_trade', 'avoid']).toContain(result.readiness.state);
    for (const e of [...result.evidence.supporting, ...result.evidence.opposing]) expect(LAYERS).toContain(e.source);
    expect(result.narrative).toHaveLength(6);
    for (const s of result.narrative) expect(s).not.toMatch(BANNED);
    expect(layers.agreement.schemaVersion).toBe(1);
    expect(layers.snapshots).toHaveLength(3);
    expect(layers.hierarchy.controller).toBe(result.headline.controller);
  });

  it('empty candles → safe result, no throw', () => {
    expect(() => computeFullMarketIntelligence({})).not.toThrow();
    const { result } = computeFullMarketIntelligence({});
    expect(result.schemaVersion).toBe(1);
    expect(result.narrative).toHaveLength(6);
  });

  it('is deterministic end-to-end', () => {
    const c = { '1d': series(200, 200, -0.5), '1h': series(200, 200, -0.4) };
    expect(computeFullMarketIntelligence(c)).toEqual(computeFullMarketIntelligence(c));
  });
});
