import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import type { StandardMtfCategories } from './standardMtfContract';
import { buildStandardMtfSnapshot } from './standardMtfService';
import { applyStandardCategoryContext } from './market/marketEngine';
import type { MarketIntelligenceResult } from './market/marketTypes';
import { computeStandardCategoryIntelligence } from './standardCategoryIntelligence';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import { evaluateClosedDerivedIntelligence } from './derivedIntelligence';

const START = 1_700_000_000;
function candles(seed = 0, count = 241, slope = 0.25): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + seed + index * slope + Math.sin(index / 8);
    const close = open + Math.cos(index / 5);
    return { time: START + index * 300, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1_000 + (index % 13) * 70, takerBuyVolume: 520 + (index % 11) * 25 };
  });
}
function source(): Record<Timeframe, Candle[]> {
  return Object.fromEntries(['5m', '15m', '30m', '1h', '4h', '1d'].map((tf, index) => [tf, candles(index * 10)])) as Record<Timeframe, Candle[]>;
}
function categories(overrides: Partial<StandardMtfCategories> = {}) {
  return { ...buildStandardMtfSnapshot({ symbol: 'BTCUSDT', candlesByTimeframe: source() }).snapshot.categories, ...overrides } as StandardMtfCategories;
}

describe('Phase 5 Standard category intelligence', () => {
  it('creates an aligned strong-bullish fixture and a deterministic mirror bearish fixture from closed primitives', () => {
    const up = candles(0, 240, 0.5);
    const down = candles(0, 240, -0.5);
    const evaluate = (data: Candle[]) => {
      const context = createIndicatorEvaluationContext({ rawCandles: data, displayCandles: data, symbol: 'BTCUSDT', timeframe: '5m', mode: 'live', hasFormingBar: false, sourceRevision: 'phase-5-fixture' });
      return computeStandardCategoryIntelligence({ symbol: 'BTCUSDT', context, derived: evaluateClosedDerivedIntelligence(context) });
    };
    expect(evaluate(up).trend.availability).toBe('available');
    expect(evaluate(up).marketStructure.availability).toBe('available');
    expect(evaluate(down).trend.availability).toBe('available');
    expect(evaluate(down)).toEqual(evaluate(down));
  });

  it('reduces M8 tradeability for bullish direction with a mixed/range POC stack', () => {
    const baseline = buildStandardMtfSnapshot({ symbol: 'BTCUSDT', candlesByTimeframe: source() }).snapshot.canonical.market;
    const base = categories();
    const result = applyStandardCategoryContext(baseline as unknown as MarketIntelligenceResult, categories({
      volumeProfile: { ...base.volumeProfile, availability: 'available', state: 'mixed_range', score: 50, verdict: 'neutral', warnings: [{ category: 'volumeProfile', code: 'POC_MIXED_RANGE', message: 'mixed', severity: 'warning', source: ['pocStructure'] }] } as never,
    }));
    expect(result.opportunity.score).toBeLessThan(baseline.opportunity.score);
    expect(result.risk.score).toBeGreaterThanOrEqual(baseline.risk.score);
  });

  it('reduces M8 tradeability for a compressed/squeeze market without inventing direction', () => {
    const baseline = buildStandardMtfSnapshot({ symbol: 'BTCUSDT', candlesByTimeframe: source() }).snapshot.canonical.market;
    const base = categories();
    const result = applyStandardCategoryContext(baseline as unknown as MarketIntelligenceResult, categories({
      volatility: { ...base.volatility, availability: 'available', state: 'compressed', score: 50, verdict: 'neutral', warnings: [{ category: 'volatility', code: 'VOLATILITY_SQUEEZE', message: 'squeeze', severity: 'warning', source: ['squeeze'] }] } as never,
    }));
    expect(result.headline.bias).toBe(baseline.headline.bias);
    expect(result.opportunity.score).toBeLessThan(baseline.opportunity.score);
  });

  it('records trend/structure conflict as quality and risk context, not a replacement bias', () => {
    const baseline = buildStandardMtfSnapshot({ symbol: 'BTCUSDT', candlesByTimeframe: source() }).snapshot.canonical.market;
    const base = categories();
    const result = applyStandardCategoryContext(baseline as unknown as MarketIntelligenceResult, categories({
      trend: { ...base.trend, availability: 'available', verdict: 'bullish' } as never,
      marketStructure: { ...base.marketStructure, availability: 'available', verdict: 'bearish' } as never,
      confluence: { ...base.confluence, availability: 'available', state: 'mixed', warnings: [{ category: 'confluence', code: 'FVG_MIXED', message: 'mixed', severity: 'warning', source: ['fvgStructure'] }] } as never,
    }));
    expect(result.headline.bias).toBe(baseline.headline.bias);
    expect(result.quality.score).toBeLessThan(baseline.quality.score);
    expect(result.risk.score).toBeGreaterThan(baseline.risk.score);
  });

  it('keeps missing order flow honest and does not make it bearish', () => {
    const xau = buildStandardMtfSnapshot({ symbol: 'XAUUSD', candlesByTimeframe: source() }).snapshot;
    expect(xau.categories.orderFlow.availability).toBe('unavailable');
    expect(xau.categories.orderFlow.verdict).toBeNull();
    expect(xau.categories.orderFlow.score).toBeNull();
  });

  it('preserves insufficient evidence instead of manufacturing category scores', () => {
    const shortSource = Object.fromEntries(['5m', '15m', '30m', '1h', '4h', '1d'].map((tf) => [tf, candles(0, 20)])) as Record<Timeframe, Candle[]>;
    const snapshot = buildStandardMtfSnapshot({ symbol: 'BTCUSDT', candlesByTimeframe: shortSource }).snapshot;
    expect(snapshot.categories.trend.availability).toBe('insufficient_data');
    expect(snapshot.categories.marketStructure.availability).toBe('insufficient_data');
    expect(snapshot.categories.orderFlow.score).toBeNull();
  });
});
