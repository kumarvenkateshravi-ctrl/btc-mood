import { describe, expect, it } from 'vitest';
import { makeDeterministicCandles } from '../testing/syntheticCandles';
import { computeRsi } from './rsi';

describe('RSI TradingView defaults', () => {
  it('enables the RSI-based SMA smoothing plot by default', () => {
    const result = computeRsi(makeDeterministicCandles(80, 11));
    const plotIds = result.plots.map((plot) => plot.id);

    expect(plotIds).toContain('rsi');
    expect(plotIds).toContain('rsiMa');
  });
});
