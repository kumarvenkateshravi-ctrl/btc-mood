import { describe, it, expect } from 'vitest';
import { buildNarration } from './narrate';
import type { MoodVerdict, TFSnapshot } from './signals';
import type { Signal, Timeframe } from './types';
import { TIMEFRAMES } from './types';

function snap(tf: Timeframe, side: Signal['side'], over = true): TFSnapshot {
  return {
    tf,
    signal: { side, source: 'ema+rsi', fresh: true },
    ema9: over ? 101 : 99,
    ema21: 100,
    rsi14: side === 'buy' ? 58 : side === 'sell' ? 38 : 50,
    regime: { label: 'calm', atrPct: 0.3 },
    confluenceScore: side === 'buy' ? 1 : side === 'sell' ? -1 : 0,
  };
}

function mood(partial: Partial<MoodVerdict>): MoodVerdict {
  const base: MoodVerdict = {
    side: 'neutral',
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    totalCount: 0,
    weightedBull: 0,
    weightedBear: 0,
    weightedNeut: 0,
    totalWeight: 0,
    summary: '',
  };
  return { ...base, ...partial };
}

function mapOf(sides: Partial<Record<Timeframe, Signal['side']>>) {
  const out = Object.fromEntries(TIMEFRAMES.map((tf) => [tf, null])) as Record<
    Timeframe,
    TFSnapshot | null
  >;
  for (const tf of TIMEFRAMES) {
    const s = sides[tf];
    if (s) out[tf] = snap(tf, s, s !== 'sell');
  }
  return out;
}

describe('buildNarration', () => {
  it('flags insufficient data when there are no snapshots', () => {
    const n = buildNarration(mood({}), mapOf({}), TIMEFRAMES);
    expect(n.insufficient).toBe(true);
    expect(n.headline).toMatch(/reading/i);
    expect(n.factors).toHaveLength(0);
  });

  it('reads a broad bullish verdict led by higher timeframes', () => {
    const snapshots = mapOf({
      '1m': 'buy',
      '5m': 'buy',
      '15m': 'buy',
      '1h': 'buy',
      '4h': 'buy',
      '1d': 'sell',
    });
    const n = buildNarration(
      mood({ side: 'bullish', bullishCount: 5, bearishCount: 1, neutralCount: 0, totalCount: 6 }),
      snapshots,
      TIMEFRAMES,
    );
    expect(n.side).toBe('bullish');
    expect(n.leaning).toBe(false);
    expect(n.headline).toMatch(/bullish/i);
    expect(n.summary).toMatch(/pointing up/i);
    expect(n.summary).toMatch(/5 of 6/);
    expect(n.factors).toHaveLength(6);
  });

  it('describes a neutral/mixed market', () => {
    const snapshots = mapOf({
      '1m': 'buy',
      '5m': 'sell',
      '15m': 'neutral',
      '1h': 'buy',
      '4h': 'sell',
      '1d': 'neutral',
    });
    const n = buildNarration(
      mood({ side: 'neutral', bullishCount: 2, bearishCount: 2, neutralCount: 2, totalCount: 6 }),
      snapshots,
      TIMEFRAMES,
    );
    expect(n.side).toBe('neutral');
    expect(n.headline).toMatch(/mixed/i);
  });

  it('marks a lower-timeframe-only move as leaning', () => {
    const snapshots = mapOf({ '1m': 'buy', '5m': 'buy', '15m': 'buy' });
    const n = buildNarration(
      mood({ side: 'neutral', bullishCount: 3, bearishCount: 0, neutralCount: 0, totalCount: 3 }),
      snapshots,
      TIMEFRAMES,
    );
    expect(n.side).toBe('bullish');
    expect(n.leaning).toBe(true);
    expect(n.headline).toMatch(/leaning bullish/i);
  });

  it('builds per-timeframe factor lines from the snapshot indicators', () => {
    const n = buildNarration(
      mood({ side: 'bullish', bullishCount: 1, bearishCount: 0, neutralCount: 0, totalCount: 1 }),
      mapOf({ '15m': 'buy' }),
      TIMEFRAMES,
    );
    expect(n.factors[0].text).toMatch(/EMA9 above EMA21/);
    expect(n.factors[0].text).toMatch(/RSI 58/);
    expect(n.factors[0].text).toMatch(/calm/);
  });

  it('is deterministic', () => {
    const args = [
      mood({ side: 'bearish', bullishCount: 1, bearishCount: 4, neutralCount: 1, totalCount: 6 }),
      mapOf({ '1m': 'sell', '5m': 'sell', '1h': 'sell', '4h': 'sell', '15m': 'buy', '1d': 'neutral' }),
      TIMEFRAMES,
    ] as const;
    expect(buildNarration(...args)).toEqual(buildNarration(...args));
  });
});
