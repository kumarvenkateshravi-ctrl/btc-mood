import { describe, it, expect } from 'vitest';
import { detectDivergence, groupBias, LOWER_TFS, HIGHER_TFS } from './divergence';
import type { TFSnapshot } from './signals';
import type { Timeframe } from './types';

function snap(side: 'buy' | 'sell' | 'neutral'): TFSnapshot {
  return {
    tf: '1m',
    signal: { side, source: 'test', fresh: true },
    ema9: null,
    ema21: null,
    rsi14: null,
    regime: null,
    confluenceScore: 0,
  };
}

function build(sides: Partial<Record<Timeframe, 'buy' | 'sell' | 'neutral'>>): Record<Timeframe, TFSnapshot | null> {
  const all: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
  return Object.fromEntries(all.map((tf) => [tf, sides[tf] ? snap(sides[tf]!) : null])) as Record<Timeframe, TFSnapshot | null>;
}

describe('groupBias', () => {
  it('reports the majority side', () => {
    const snaps = build({ '1m': 'buy', '5m': 'buy', '15m': 'sell' });
    expect(groupBias(snaps, LOWER_TFS).bias).toBe('bullish');
  });
  it('is neutral on a tie', () => {
    const snaps = build({ '1m': 'buy', '5m': 'sell' });
    expect(groupBias(snaps, LOWER_TFS).bias).toBe('neutral');
  });
});

describe('detectDivergence', () => {
  it('flags lower-bearish vs higher-bullish', () => {
    const snaps = build({
      '1m': 'sell', '5m': 'sell', '15m': 'sell',
      '1h': 'buy', '4h': 'buy', '1d': 'buy',
    });
    const d = detectDivergence(snaps);
    expect(d.diverging).toBe(true);
    expect(d.lower).toBe('bearish');
    expect(d.higher).toBe('bullish');
    expect(d.message).toMatch(/pullback/);
  });

  it('flags lower-bullish vs higher-bearish', () => {
    const snaps = build({
      '1m': 'buy', '5m': 'buy', '15m': 'buy',
      '1h': 'sell', '4h': 'sell', '1d': 'sell',
    });
    const d = detectDivergence(snaps);
    expect(d.diverging).toBe(true);
    expect(d.message).toMatch(/bounce/);
  });

  it('does not flag when aligned', () => {
    const snaps = build({
      '1m': 'buy', '5m': 'buy', '15m': 'buy',
      '1h': 'buy', '4h': 'buy', '1d': 'buy',
    });
    expect(detectDivergence(snaps).diverging).toBe(false);
  });

  it('does not flag when a group is neutral', () => {
    const snaps = build({ '1m': 'sell', '5m': 'buy', '1h': 'buy', '4h': 'buy' });
    expect(detectDivergence(snaps).diverging).toBe(false);
  });
});
