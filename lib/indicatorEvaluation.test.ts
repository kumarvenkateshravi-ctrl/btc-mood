import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from './types';
import {
  createIndicatorEvaluationContext,
  evaluationIdentity,
  projectIndicatorResultToDisplay,
  selectIndicatorCandles,
  type IndicatorEvaluationContext,
} from './indicatorEvaluation';
import { CUSTOM_INDICATORS } from './customIndicatorsLibrary';
import { computeMaFvg } from './indicators/maFvg';

const bar = (time: number, close: number): Candle => ({
  time,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 10,
});

function context(overrides: Partial<Parameters<typeof createIndicatorEvaluationContext>[0]> = {}) {
  return createIndicatorEvaluationContext({
    rawCandles: [bar(100, 10), bar(200, 11), bar(300, 12)],
    displayCandles: [bar(100, 9), bar(200, 10), bar(300, 11)],
    symbol: 'BTCUSDT',
    timeframe: '5m' as Timeframe,
    mode: 'live',
    sourceRevision: 'rev-1',
    ...overrides,
  });
}

describe('canonical indicator evaluation context', () => {
  it('derives closed candles and forming state without mutating either source', () => {
    const raw = [bar(100, 10), bar(200, 11), bar(300, 12)];
    const display = [bar(100, 9), bar(200, 10), bar(300, 11)];
    const result = createIndicatorEvaluationContext({
      rawCandles: raw,
      displayCandles: display,
      symbol: 'BTCUSDT',
      timeframe: '5m',
      mode: 'live',
      sourceRevision: 'rev-1',
      hasFormingBar: true,
    });

    expect(result.hasFormingBar).toBe(true);
    expect(result.rawCandles).toBe(raw);
    expect(result.displayCandles).toBe(display);
    expect(result.closedCandles).toEqual(raw.slice(0, -1));
    expect(result.closedCandles).not.toBe(raw);
  });

  it('keeps a fully closed series intact', () => {
    const result = context({ hasFormingBar: false });
    expect(result.closedCandles).toEqual(result.rawCandles);
    expect(result.hasFormingBar).toBe(false);
  });

  it('captures replay identity and produces a structural cache identity', () => {
    const result = context({
      mode: 'replay',
      replay: { sessionId: 'session-1', cutTime: 250, executionTimeframe: '5m' },
    });
    expect(result.replay?.sessionId).toBe('session-1');
    expect(evaluationIdentity(result)).toContain('replay:session-1');
    expect(evaluationIdentity(result)).toContain('BTCUSDT|5m|candlestick|rev-1');
  });

  it('changes identity for symbol, timeframe, transform, mode, cut, and source revision', () => {
    const base = context();
    const variants: IndicatorEvaluationContext[] = [
      context({ symbol: 'ETHUSDT' }),
      context({ timeframe: '1h' }),
      context({ transform: 'heikinAshi' }),
      context({ mode: 'replay', replay: { sessionId: 's', cutTime: 300, executionTimeframe: '5m' } }),
      context({ sourceRevision: 'rev-2' }),
    ];
    const ids = new Set([evaluationIdentity(base), ...variants.map(evaluationIdentity)]);
    expect(ids.size).toBe(variants.length + 1);
  });

  it('declares analytical source and finality policy for structural indicators', () => {
    const expected = new Map([
      ['session_volume_profile', ['raw', 'developing']],
      ['ma_fvg', ['mixed', 'closed']],
      ['sd_zones', ['raw', 'closed']],
      ['sd_signals', ['raw', 'closed']],
      ['volume_distribution_zones', ['raw', 'closed']],
      ['smc', ['raw', 'closed']],
    ]);

    for (const [id, [sourcePolicy, finalityPolicy]] of expected) {
      const declaration = CUSTOM_INDICATORS.find((indicator) => indicator.id === id)?.evaluation;
      expect(declaration, id).toMatchObject({ sourcePolicy, finalityPolicy, replaySafe: true });
    }
  });

  it('projects raw structural outputs onto a transformed display index', () => {
    const source = [bar(100, 10), bar(200, 11), bar(300, 12)];
    const display = [bar(100, 9), bar(300, 11)];
    const result = projectIndicatorResultToDisplay({
      plots: [{ id: 'line', title: 'Line', color: '#fff', type: 'line', data: [1, 2, 3] }],
      signals: ['neutral', 'buy', 'sell'],
      markers: [{ index: 2, position: 'aboveBar', color: '#f00', shape: 'arrowDown' }],
    }, source, display);
    expect(result.plots[0].data).toEqual([2, 3]);
    expect(result.signals).toEqual(['buy', 'sell']);
    expect(result.markers?.[0].index).toBe(1);
  });

  it('does not create a forming-bar FVG object when closed finality is declared', () => {
    const candles = [
      { ...bar(100, 95), high: 100, low: 90 },
      { ...bar(200, 96), high: 101, low: 95 },
      { ...bar(300, 112), high: 114, low: 110 },
    ];
    const contextWithForming = createIndicatorEvaluationContext({
      rawCandles: candles, displayCandles: candles, symbol: 'BTCUSDT', timeframe: '5m', mode: 'live', sourceRevision: 'fvg', hasFormingBar: true,
    });
    const result = computeMaFvg(candles, undefined, undefined, contextWithForming);
    expect(result.plots.some((plot) => plot.id.startsWith('fvg_'))).toBe(false);
  });

  it('keeps raw analytical inputs invariant across display transforms', () => {
    const raw = [bar(100, 10), bar(200, 11), bar(300, 12)];
    const rawContext = context({ rawCandles: raw, displayCandles: raw, hasFormingBar: true, transform: 'candlestick' });
    const haContext = context({ rawCandles: raw, displayCandles: raw.map((c) => ({ ...c, open: c.open + 3, close: c.close + 3 })), hasFormingBar: true, transform: 'heikinAshi' });
    const renkoContext = context({ rawCandles: raw, displayCandles: [bar(100, 8), bar(300, 13)], hasFormingBar: true, transform: 'renko' });
    expect(selectIndicatorCandles(rawContext, 'raw', 'closed')).toEqual(selectIndicatorCandles(haContext, 'raw', 'closed'));
    expect(selectIndicatorCandles(rawContext, 'raw', 'closed')).toEqual(selectIndicatorCandles(renkoContext, 'raw', 'closed'));
    expect(selectIndicatorCandles(haContext, 'display', 'developing')).toBe(haContext.displayCandles);
  });
});
