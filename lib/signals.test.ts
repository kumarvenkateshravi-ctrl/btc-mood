import { describe, it, expect } from 'vitest';
import { aggregateMood, computeSignal } from './signals';
import type { Candle, Timeframe } from './types';
import type { TFSnapshot } from './signals';

// Build a noisy but trending series using a deterministic LCG so tests
// are reproducible. `trendPerBar` is the average step in price units
// and `noise` is the peak-to-peak noise added per bar.
const makeSeries = (
  n: number,
  base: number,
  trendPerBar: number,
  noise: number,
  seed: number,
): Candle[] => {
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Array.from({ length: n }, (_, i) => {
    const trend = i * trendPerBar;
    const wiggle = (rand() - 0.5) * noise;
    const close = base + trend + wiggle;
    return {
      time: i * 60,
      open: base + trend,
      high: Math.max(base + trend, close) + 0.05,
      low: Math.min(base + trend, close) - 0.05,
      close,
      volume: 1,
    };
  });
};

const flat = (n: number, base = 100): Candle[] =>
  // Truly zero-mean flat: every close equals the previous close so the
  // EMA9 ≈ EMA21, and the candle body is a flat line. With
  // close-to-close change exactly 0 every bar, Wilder's RSI seeds
  // with avgGain=0 and avgLoss=0 — the indicator's guard returns all
  // nulls and rsiScore stays 0.
  Array.from({ length: n }, (_, i) => ({
    time: i * 60,
    open: base,
    high: base,
    low: base,
    close: base,
    volume: 1,
  }));

const uptrend = (n: number): Candle[] => makeSeries(n, 100, 0.4, 6, 1234);
const downtrend = (n: number): Candle[] => makeSeries(n, 200, -0.4, 6, 5678);

const snap = (tf: Timeframe, side: TFSnapshot['signal']['side']): TFSnapshot => ({
  tf,
  signal: { side, source: 'ema+rsi', fresh: false },
  ema9: 100,
  ema21: 100,
  rsi14: 50,
  regime: null,
  confluenceScore: 0,
});

describe('computeSignal', () => {
  it('returns the empty snapshot when not enough candles', () => {
    const out = computeSignal('15m', flat(5));
    expect(out.signal.side).toBe('neutral');
    expect(out.confluenceScore).toBe(0);
    expect(out.ema9).toBeNull();
  });

  it('flags a long uptrend as buy on the 15m timeframe', () => {
    const out = computeSignal('15m', uptrend(120));
    // The noisy uptrend has a positive EMA gap and RSI drifts into the
    // 55-70 range; together confluenceScore >= 0.5.
    expect(out.confluenceScore).toBeGreaterThan(0);
    expect(out.signal.side).toBe('buy');
    expect(out.regime).not.toBeNull();
  });

  it('flags a long downtrend as sell', () => {
    const out = computeSignal('15m', downtrend(120));
    expect(out.confluenceScore).toBeLessThan(0);
    expect(out.signal.side).toBe('sell');
  });

  it('a flat series keeps the signal neutral and populates a regime', () => {
    const out = computeSignal('15m', flat(120));
    // With truly zero close-to-close change, EMA9 == EMA21 (both equal
    // to `base`) and rsi14 stays null. confluenceScore = 0.
    expect(out.confluenceScore).toBe(0);
    expect(out.signal.side).toBe('neutral');
    expect(out.regime).not.toBeNull();
  });

  it('fresh=false on a 1d candle 30 days old', () => {
    const now = 1_700_000_000;
    // 40 daily bars whose last bar lands 30 days before `now`. The
    // 1d freshness window is 25h, so this is well past stale.
    const staleCandles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: now - 30 * 86400 - (39 - i) * 86400,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 0,
    }));
    const out = computeSignal('1d', staleCandles, now);
    expect(out.signal.fresh).toBe(false);
  });

  it('fresh=true on a recent 5m candle', () => {
    const now = 1_700_000_000;
    // 100 bars ending at `now` (≥ MIN_BARS['5m']); the last bar's age is 0,
    // well within the 30-minute 5m freshness window.
    const recentCandles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
      time: now - (99 - i) * 60,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 0,
    }));
    const out = computeSignal('5m', recentCandles, now);
    expect(out.signal.fresh).toBe(true);
  });
});

describe('aggregateMood', () => {
  it('all neutral → neutral side and 0/N bullish summary', () => {
    const v = aggregateMood([
      snap('5m', 'neutral'),
      snap('5m', 'neutral'),
      snap('15m', 'neutral'),
    ]);
    expect(v.side).toBe('neutral');
    expect(v.bullishCount).toBe(0);
    expect(v.summary).toBe('0/3 bullish');
  });

  it('a 1d sell outweighs a 5m buy when computing the side', () => {
    const v = aggregateMood([
      snap('5m', 'buy'),
      snap('1d', 'sell'),
    ]);
    // weightedBull = 0.75 (5m), weightedBear = 2.5 (1d) → bearish
    expect(v.side).toBe('bearish');
    expect(v.weightedBull).toBe(0.75);
    expect(v.weightedBear).toBe(2.5);
  });

  it('summary uses raw counts, not weighted sums', () => {
    const v = aggregateMood([
      snap('5m', 'buy'),
      snap('5m', 'buy'),
      snap('15m', 'sell'),
      snap('1h', 'neutral'),
    ]);
    expect(v.bullishCount).toBe(2);
    expect(v.bearishCount).toBe(1);
    expect(v.neutralCount).toBe(1);
    expect(v.summary).toBe('2/4 bullish');
  });
});
