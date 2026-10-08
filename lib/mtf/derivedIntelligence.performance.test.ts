import { expect, it } from 'vitest';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import type { Candle } from '../types';
import {
  evaluateClosedFvgIntelligence,
  evaluateClosedPocStructure,
  evaluateClosedVwapStructure,
} from './derivedIntelligence';

function fixture(count: number): Candle[] {
  const start = Date.UTC(2024, 0, 1) / 1000;
  return Array.from({ length: count }, (_, index) => {
    const price = 40_000 + index * 2 + Math.sin(index / 9) * 90;
    return { time: start + index * 300, open: price - 8, high: price + 28, low: price - 25, close: price + (index % 5 - 2), volume: 800 + (index % 17) * 35, takerBuyVolume: 300 + (index % 13) * 30 };
  });
}

it('measures Phase 4 derived-layer work separately from primitive computation', () => {
  const candles = fixture(720);
  const context = createIndicatorEvaluationContext({ rawCandles: candles, displayCandles: candles, symbol: 'BTCUSDT', timeframe: '5m', mode: 'live', sourceRevision: 'phase-4-performance-fixture' });
  const measure = (work: () => unknown) => {
    const start = performance.now();
    work();
    return Number((performance.now() - start).toFixed(2));
  };
  const fvg = measure(() => evaluateClosedFvgIntelligence(context));
  const vwap = measure(() => evaluateClosedVwapStructure(context));
  const poc = measure(() => evaluateClosedPocStructure(context));
  console.info('[phase-4-derived-performance-ms]', JSON.stringify({ bars: candles.length, fvg, vwap, poc }));
  expect([fvg, vwap, poc].every(Number.isFinite)).toBe(true);
});
