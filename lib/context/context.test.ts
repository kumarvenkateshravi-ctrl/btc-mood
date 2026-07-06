import { describe, it, expect } from 'vitest';
import { blendScores, conflictScore, decayToward50, biasOf, alignmentScore, directionAdjust } from './scoringEngine';
import { CONTEXT_PRODUCERS } from './indicatorScores';
import { structureScore } from './subEngines';
import { buildMarketContext } from './marketContext';
import { decide, gradeOf } from './decisionEngine';
import { DEFAULT_CONTEXT_CONFIG, DEFAULT_DECISION_CONFIG, type MarketContext } from './types';
import type { VdSignal } from '../indicators/vdEngine';
import type { Candle, Timeframe } from '../types';

const bar = (time: number, close: number, volume = 100, spread = 1): Candle =>
  ({ time, open: close - 0.2, high: close + spread / 2, low: close - spread / 2, close, volume } as Candle);

/** Trend bars close near their extreme (like real trend candles), so the
 *  buy/sell delta estimator sees directional volume. */
function trendBars(n: number, step: number, start = 100, tfSec = 3600): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const open = p;
    p += step;
    const close = p;
    out.push({
      time: 1_600_000_000 + i * tfSec,
      open,
      high: Math.max(open, close) + 0.1,
      low: Math.min(open, close) - 0.1,
      close,
      volume: 100,
    } as Candle);
  }
  return out;
}

describe('scoringEngine', () => {
  it('blend is weight-normalized; empty → 50', () => {
    expect(blendScores([{ score: 80, weight: 1 }, { score: 40, weight: 3 }])).toBeCloseTo(50, 6);
    expect(blendScores([])).toBe(50);
  });
  it('conflict: agreement → 0, full split → 100', () => {
    expect(conflictScore([{ score: 70, weight: 1 }, { score: 70, weight: 1 }], 70)).toBe(0);
    expect(conflictScore([{ score: 0, weight: 1 }, { score: 100, weight: 1 }], 50)).toBe(100);
  });
  it('decay halves the deviation each half-life', () => {
    expect(decayToward50(80, 10, 10)).toBeCloseTo(65, 6);
    expect(decayToward50(80, 0, 10)).toBe(80);
  });
  it('bias respects the neutral band', () => {
    expect(biasOf(56, 8)).toBe('neutral');
    expect(biasOf(60, 8)).toBe('bullish');
    expect(biasOf(40, 8)).toBe('bearish');
  });
  it('alignment: 1d 55 + 4h 82 with default TF weights → 67.3', () => {
    const s: Partial<Record<Timeframe, number>> = { '4h': 82, '1d': 55 };
    expect(alignmentScore(s, DEFAULT_CONTEXT_CONFIG.tfWeights, ['4h', '1d'])).toBeCloseTo(67.27, 1);
  });
  it('direction adjust mirrors for sells', () => {
    expect(directionAdjust(80, 'sell')).toBe(20);
    expect(directionAdjust(80, 'buy')).toBe(80);
  });
});

describe('indicator producers (fixed roster)', () => {
  const up = trendBars(80, 1);
  const down = trendBars(80, -1, 300);
  it('uptrend reads bullish across the roster', () => {
    for (const key of ['ema', 'supertrend', 'macd', 'rsi', 'adx', 'obv', 'volume'] as const) {
      const s = CONTEXT_PRODUCERS[key](up, '1h');
      expect(s.score, key).toBeGreaterThan(55);
      expect(s.state, key).toBe('bullish');
    }
  });
  it('downtrend reads bearish across the roster', () => {
    for (const key of ['ema', 'supertrend', 'macd', 'rsi', 'adx', 'obv', 'volume'] as const) {
      const s = CONTEXT_PRODUCERS[key](down, '1h');
      expect(s.score, key).toBeLessThan(45);
      expect(s.state, key).toBe('bearish');
    }
  });
  it('warm-up yields neutral with reduced confidence', () => {
    const s = CONTEXT_PRODUCERS.macd(trendBars(10, 1), '1h');
    expect(s.score).toBe(50);
    expect(s.confidence).toBeLessThan(1);
  });
});

describe('subEngines', () => {
  it('structure: HH+HL → 100, LH+LL → 0', () => {
    expect(structureScore(trendBars(40, 1))).toBe(100);
    expect(structureScore(trendBars(40, -1, 300))).toBe(0);
  });
});

describe('buildMarketContext', () => {
  const byTf: Partial<Record<Timeframe, Candle[]>> = {
    '1h': trendBars(81, 1),
    '4h': trendBars(81, 1, 100, 14400),
    '1d': trendBars(81, 1, 100, 86400),
  };
  it('uptrending TFs → bullish overall bias with HTF agreement', () => {
    const ctx = buildMarketContext(byTf);
    expect(ctx.overallBias).toBe('bullish');
    expect(ctx.htfAgreement).toBeGreaterThan(55);
    expect(ctx.contextScore).toBeGreaterThan(58);
    expect(ctx.confirmations.length).toBeGreaterThan(0);
    expect(ctx.perTf['5m']).toBeNull(); // missing TF contributes nothing
  });
  it('caches on the closed-bar signature; the forming bar is ignored', () => {
    const a = buildMarketContext(byTf);
    const mutated: typeof byTf = {
      ...byTf,
      '1h': [...byTf['1h']!.slice(0, -1), bar(9_999_999_999, 1)], // wild forming bar
    };
    const b = buildMarketContext(mutated);
    expect(b).toBe(a); // same object → cache hit, forming bar irrelevant
  });
});

describe('decisionEngine', () => {
  const sig = (over: Partial<VdSignal>): VdSignal => ({
    side: 'buy', zoneId: 'D:demand:0', tf: 'D', index: 50,
    entry: 103, stopLoss: 100, tp1: 108, tp2: 110, tp3: 113,
    riskReward: 1.7, swept: true, confidence: 80,
    ...over,
  });
  const ctx: MarketContext = {
    perTf: {}, overallBias: 'bullish',
    contextScore: 80, trendScore: 70, momentumScore: 60, volumeScore: 60,
    htfAgreement: 70, conflictScore: 20, confidence: 75,
    confirmations: ['4h EMA9 > EMA21', '1d Price above Supertrend'],
    warnings: [], asOfTime: 0,
  };

  it('hand-computed decision score: 75.8 → grade A, medium risk', () => {
    const { decisions, rejections } = decide([sig({})], ctx, DEFAULT_DECISION_CONFIG, () => 2);
    expect(rejections).toHaveLength(0);
    expect(decisions).toHaveLength(1);
    const d = decisions[0];
    // zoneW = 0.20+0.25·0.8 = 0.40; k = 0.60/75; slComponent 50; risk (50+80)/2=65
    // 0.40·80 + k·(30·80+15·70+10·60+10·60+5·65+5·100) = 32 + 43.8 = 75.8
    expect(d.decisionScore).toBeCloseTo(75.8, 5);
    expect(d.grade).toBe('A');
    expect(d.riskProfile).toBe('medium');
    expect(d.reasons.join(' ')).toContain('Liquidity sweep');
  });

  it('sell against a bullish context is rejected with explained gates', () => {
    const { decisions, rejections } = decide([sig({ side: 'sell' })], ctx, DEFAULT_DECISION_CONFIG, () => 2);
    expect(decisions).toHaveLength(0);
    expect(rejections).toHaveLength(1);
    const gates = rejections[0].failedGates.join(' | ');
    expect(gates).toMatch(/higher-TF agreement/);
    expect(gates).toMatch(/bias is bullish/);
  });

  it('buy against a bearish bias is rejected', () => {
    const bearish = { ...ctx, overallBias: 'bearish' as const, contextScore: 30, htfAgreement: 60 };
    const { rejections } = decide([sig({})], bearish, DEFAULT_DECISION_CONFIG, () => 2);
    expect(rejections[0].failedGates.join(' ')).toMatch(/bias is bearish/);
  });

  it('degrades gracefully without context (neutral 50s, gates skipped, warned)', () => {
    const { decisions } = decide([sig({ confidence: 90 })], null);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decisionScore).toBeCloseTo(68.9, 1);
    expect(decisions[0].warnings).toContain('Market context unavailable');
  });

  it('grade boundaries', () => {
    expect(gradeOf(85)).toBe('A+');
    expect(gradeOf(75)).toBe('A');
    expect(gradeOf(65)).toBe('B');
    expect(gradeOf(55)).toBe('C');
    expect(gradeOf(54.9)).toBe('D');
  });
});
