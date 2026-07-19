import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../../types';
import { buildTimeframeSnapshots } from './snapshots';
import { computeTimeframeHierarchy } from './hierarchy';

const series = (n: number, base: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return { time: i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 80 };
  });

const REGIMES = ['trending_up', 'trending_down', 'ranging', 'compression', 'expansion'];
const STATES = ['bullish_continuation', 'bullish_pullback', 'bullish_transition', 'bearish_continuation', 'bearish_pullback', 'bearish_transition', 'reversal_risk', 'range_bound', 'compression', 'expansion'];

describe('buildTimeframeSnapshots', () => {
  it('one well-formed snapshot per input TF, ordered by hierarchy', () => {
    const snaps = buildTimeframeSnapshots({ '4h': series(260, 100, 0.5), '1d': series(260, 100, 0.6) });
    expect(snaps.map((s) => s.timeframe)).toEqual(['1d', '4h']); // hierarchy order, not input order
    for (const s of snaps) {
      expect(['bullish', 'bearish', 'neutral']).toContain(s.bias);
      expect(REGIMES).toContain(s.regime);
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(100);
    }
  });

  it('empty candles for a TF still produce a well-formed snapshot', () => {
    const [s] = buildTimeframeSnapshots({ '1d': [] });
    expect(s.timeframe).toBe('1d');
    expect(REGIMES).toContain(s.regime);
  });

  it('end-to-end: snapshots → hierarchy is well-formed', () => {
    const candlesByTf: Partial<Record<Timeframe, Candle[]>> = {
      '1d': series(260, 100, 0.6), '4h': series(260, 100, 0.5), '1h': series(260, 100, 0.4),
    };
    const r = computeTimeframeHierarchy(buildTimeframeSnapshots(candlesByTf));
    expect(r.schemaVersion).toBe(1);
    expect(STATES).toContain(r.overallMarketState);
    expect(r.contributors).toHaveLength(3);
    expect(['5m', '15m', '30m', '1h', '4h', '1d']).toContain(r.controller);
  });

  it('is deterministic end-to-end', () => {
    const c = { '1d': series(200, 200, -0.5), '1h': series(200, 200, -0.4) };
    expect(computeTimeframeHierarchy(buildTimeframeSnapshots(c))).toEqual(computeTimeframeHierarchy(buildTimeframeSnapshots(c)));
  });
});
