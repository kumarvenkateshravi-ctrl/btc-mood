import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/types';
import { computeRegressionGChannel } from './regressionGChannel';

function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.4 + Math.sin(i / 3) * 2;
    const open = close - (i % 2 === 0 ? 0.25 : -0.2);
    return {
      time: 1_700_000_000 + i * 900,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 100 + i,
    };
  });
}

describe('computeRegressionGChannel', () => {
  it('returns a safe empty result', () => {
    expect(computeRegressionGChannel([])).toEqual({ plots: [], signals: [] });
  });

  it('returns one-to-one plots, signals, and no candle-color output', () => {
    const input = candles(80);
    const result = computeRegressionGChannel(input);

    expect(result.plots.length).toBe(22);
    expect(result.plots.every((plot) => plot.data.length === input.length)).toBe(true);
    expect(result.signals).toHaveLength(input.length);
    expect(result.candleColors).toBeUndefined();
    expect(result.plots.some((plot) => plot.id === 'regression_line')).toBe(true);
    expect(result.plots.some((plot) => plot.id === 'g_channel_bull')).toBe(true);
    expect(result.plots.some((plot) => plot.id === 'dsmart_line')).toBe(true);
  });

  it('honors section visibility without changing the output shape', () => {
    const result = computeRegressionGChannel(candles(20), {
      id: 'regression_gchannel',
      settings: {
        inputs: {
          showLine: false,
          showTracer: false,
          gcShow: false,
          showFibLevels: false,
          showFibBands: false,
          showZoneFill: false,
        },
        styles: {},
        visibility: {},
      },
    });

    expect(result.plots).toHaveLength(22);
    expect(result.plots.find((p) => p.id === 'regression_line')?.data.every((v) => v === null)).toBe(true);
    expect(result.plots.find((p) => p.id === 'g_channel_bull')?.data.every((v) => v === null)).toBe(true);
    expect(result.plots.find((p) => p.id === 'fib_1')?.data.every((v) => v === null)).toBe(true);
    expect(result.plots.find((p) => p.id === 'dsmart_zone_bull')?.data.every((v) => v === null)).toBe(true);
  });

  it('is deterministic across repeated calculations and supports interval windows', () => {
    const input = candles(96);
    const config = {
      id: 'regression_gchannel',
      settings: { inputs: { windowType: 'Interval', interval: '4h', filtType: 'ALMA' }, styles: {}, visibility: {} },
    };
    const first = computeRegressionGChannel(input, config);
    const second = computeRegressionGChannel(input, config);
    expect(first).toEqual(second);
    expect(first.plots[0].data.every((v) => v == null || typeof v === 'object')).toBe(true);
  });
});
