import { describe, expect, it } from 'vitest';
import type { Candle } from './types';
import { createChartIndicatorEvaluationContext, evaluateChartIndicators } from './chartIndicatorController';

const candles: Candle[] = Array.from({ length: 40 }, (_, index) => ({
  time: index * 60,
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100.5 + index,
  volume: 10 + index,
}));

describe('chart indicator controller extraction contract', () => {
  it('builds raw/display context without changing analytical source identity', () => {
    const context = createChartIndicatorEvaluationContext({
      rawCandles: candles,
      displayCandles: candles.map((candle) => ({ ...candle, close: candle.close + 50 })),
      symbol: 'BTCUSDT',
      timeframe: '5m',
      mode: 'live',
      transform: 'heikinAshi',
      sourceRevision: 'revision-a',
    });

    expect(context.rawCandles).toBe(candles);
    expect(context.displayCandles[0].close).toBeGreaterThan(candles[0].close);
    expect(context.symbol).toBe('BTCUSDT');
    expect(context.provenance.raw).toBe('market');
    expect(context.provenance.display).toBe('heikinAshi');
  });

  it('evaluates the same stack through the extracted boundary and contains unknown indicators', () => {
    const context = createChartIndicatorEvaluationContext({
      rawCandles: candles,
      displayCandles: candles,
      symbol: 'BTCUSDT',
      timeframe: '5m',
      mode: 'live',
      transform: 'candlestick',
      sourceRevision: 'revision-a',
    });
    const output = evaluateChartIndicators({
      activeIndicatorIds: ['sma', 'does-not-exist'],
      indicatorSettings: {},
      context,
    });

    expect(output.results.map((entry) => entry.key)).toEqual(['sma']);
    expect(output.results[0].result.plots.length).toBeGreaterThan(0);
    expect(output.diagnostics).toEqual([]);
  });

  it('keeps replay evaluation bounded to the supplied snapshot context', () => {
    const context = createChartIndicatorEvaluationContext({
      rawCandles: candles.slice(0, 20),
      displayCandles: candles.slice(0, 20),
      symbol: 'BTCUSDT',
      timeframe: '15m',
      mode: 'replay',
      transform: 'renko',
      replay: { sessionId: 'replay-a', cutTime: candles[19].time, executionTimeframe: '15m' },
      sourceRevision: 'replay-a:20',
    });
    const output = evaluateChartIndicators({ activeIndicatorIds: ['atr'], indicatorSettings: {}, context });

    expect(output.evaluationContext.mode).toBe('replay');
    expect(output.evaluationContext.rawCandles).toHaveLength(20);
    expect(output.evaluationContext.replay?.sessionId).toBe('replay-a');
  });
});

