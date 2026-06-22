import { describe, it, expect } from 'vitest';
import { computeSuperTrend } from './superTrend';
import { defineGoldenTest } from '../testing/goldenRunner';
import { makeDeterministicCandles } from '../testing/syntheticCandles';

describe('SuperTrend golden master', () => {
  defineGoldenTest({
    name: 'superTrend',
    compute: computeSuperTrend,
    params: { atrPeriod: 10, mult: 3 },
  });

  // The synthetic series trends up after a calm open, so SuperTrend must flip
  // at least once and every flip must carry a buy/sell signal.
  it('emits a signal on every trend flip', () => {
    const candles = makeDeterministicCandles(200, 7);
    const result = computeSuperTrend(candles);
    const st = result.plots[0].data;

    let flips = 0;
    let prevColor: string | null = null;
    result.signals.forEach((sig, i) => {
      const cell = st[i];
      const color = cell && typeof cell === 'object' && 'color' in cell ? cell.color : null;
      if (color && prevColor && color !== prevColor) {
        flips++;
        expect(sig === 'buy' || sig === 'sell').toBe(true);
      }
      if (color) prevColor = color;
    });
    expect(flips).toBeGreaterThan(0);
  });
});
