import { describe, it, expect } from 'vitest';
import { evaluateSmcScreener, ema, sma, rsi, adx, atrSeries } from './screener';
import type { Candle, Timeframe } from '@/lib/types';

// ---------------------------------------------------------------- fixtures

/** Monotonic HTF series (default rising) long enough for EMA200. */
function htf(n: number, dir: 1 | -1 = 1): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + dir * i * 0.1;
    return { time: i * 3600, open: p, high: p + 0.6, low: p - 0.4, close: p + dir * 0.1, volume: 5 };
  });
}

/**
 * 15m choreography (designed empirically against computeSmc):
 * rise → decline → double bottom (EQL pool) → sweep wick → rally with stair
 * pullbacks (bullish CHoCH@41 then BOS@54/@66, leaving a live strength-85
 * bullish OB at [102.6, 103.9]) → optional pullback toward the OB.
 */
function evalCandles({ withSweep = true, retest = true } = {}): Candle[] {
  const rows: Candle[] = [];
  let t = 0;
  const push = (o: number, h: number, l: number, c: number, v = 10) =>
    rows.push({ time: t++ * 900, open: o, high: h, low: l, close: c, volume: v });
  const flat = (px: number, k = 1) => {
    for (let i = 0; i < k; i++) push(px, px + 0.5, px - 0.5, px);
  };
  for (let i = 0; i < 12; i++) { const p = 100 + i; push(p, p + 1.2, p - 0.3, p + 1); }
  for (let i = 0; i < 12; i++) { const p = 112 - i; push(p, p + 0.3, p - 1.2, p - 1); }
  flat(100, 2);
  push(100, 100.4, 99.0, 99.5); // equal low #1
  flat(100.5, 2);
  push(101, 102.5, 100.4, 102); // separator high (flips the eq leg bearish)
  flat(101, 2);
  push(100.3, 100.4, 99.05, 99.6); // equal low #2 (high below flats so the low pivot fires)
  flat(100, 3);
  if (withSweep) push(100, 100.2, 98.2, 100.4, 30); // wick through 99, close back above
  else flat(100, 1);
  flat(100.5, 2);
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 7; i++) { const p = 100.5 + s * 3.5 + i * 0.9; push(p, p + 1.1, p - 0.2, p + 0.9, 15); }
    for (let i = 0; i < 5; i++) { const p = 106.8 + s * 3.5 - i * 0.8; push(p, p + 0.3, p - 1.0, p - 0.8); }
  }
  if (retest) {
    for (let i = 0; i < 5; i++) { const p = 113 - i * 1.2; push(p, p + 0.3, p - 0.4, p - 1.2); }
    flat(107.2, 2);
  } else {
    for (let i = 0; i < 4; i++) { const p = 113 + i; push(p, p + 1.2, p - 0.3, p + 1, 15); }
  }
  return rows;
}

function byTf(evalSeries: Candle[], htfDir: 1 | -1 = 1): Partial<Record<Timeframe, Candle[]>> {
  return { '1d': htf(260, htfDir), '4h': htf(260, htfDir), '1h': htf(260, htfDir), '15m': evalSeries };
}

// ---------------------------------------------------------------- scenarios

describe('evaluateSmcScreener', () => {
  it('full-confluence long: all hard gates pass, trade plan produced', () => {
    const r = evaluateSmcScreener(byTf(evalCandles()), '15m');
    expect(r.direction).toBe('long');
    expect(r.hardGates.map((g) => `${g.id}:${g.pass}`)).toEqual([
      'trend:true', 'structure:true', 'liquidity:true', 'orderBlock:true',
    ]);
    expect(r.blockingReason).toBeNull();
    expect(r.status).not.toBe('NO_TRADE');
    expect(r.tradePlan).not.toBeNull();
    const plan = r.tradePlan!;
    expect(plan.stop).toBeLessThan(plan.entry);
    expect(plan.target).toBeGreaterThan(plan.entry);
    expect(plan.rr).toBeGreaterThan(0);
    expect(plan.quality).toBeGreaterThanOrEqual(1);
    expect(r.narrative.some((s) => s.includes('CHoCH'))).toBe(true);
    expect(r.score).toBeGreaterThan(50);
    // Institutional Workflow: sweep→CHoCH→BOS→OB all done with timestamps
    const byId = Object.fromEntries(r.workflow.map((s) => [s.id, s]));
    expect(r.workflow.length).toBe(8);
    for (const id of ['trend', 'liquidity_building', 'sweep', 'choch', 'bos', 'orderBlock'] as const) {
      expect(byId[id].state).toBe('done');
    }
    expect(byId.bos.barsAgo).toBeGreaterThan(0);
    expect(r.invalidation.length).toBeGreaterThanOrEqual(2);
    expect(r.invalidation.some((s) => /Order Block is mitigated/.test(s))).toBe(true);
  });

  it('no sweep: NO_TRADE with the liquidity blocking reason, score still computed', () => {
    const r = evaluateSmcScreener(byTf(evalCandles({ withSweep: false })), '15m');
    expect(r.status).toBe('NO_TRADE');
    expect(r.blockingReason).toMatch(/liquidity sweep/i);
    expect(r.missing.some((m) => /liquidity swept/i.test(m))).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.tradePlan).toBeNull();
    // The journey pinpoints the sweep as the active stage (later stages may
    // already be done — markets don't follow a strict script).
    expect(r.workflow.find((s) => s.id === 'sweep')!.state).toBe('active');
    expect(r.currentPhase).toMatch(/sell-side liquidity sweep/i);
    expect(r.nextExpectedEvent).toMatch(/Sell-side Liquidity Sweep/);
  });

  it('status is independent of score: gates pass but price far from OB ⇒ WATCH', () => {
    const r = evaluateSmcScreener(byTf(evalCandles({ retest: false })), '15m');
    expect(r.hardGates.every((g) => g.pass)).toBe(true);
    expect(r.status).toBe('WATCH');
    expect(r.tradePlan).not.toBeNull();
    expect(r.missing[0]).toMatch(/revisit the Bullish Order Block/);
    expect(r.score).toBeGreaterThan(50);
    expect(r.workflow.find((s) => s.id === 'retest')!.state).toBe('active');
    expect(r.currentPhase).toBe('Waiting for Bullish Order Block Retest');
    expect(r.nextExpectedEvent).toBe('Bullish Order Block Retest');
  });

  it('bearish higher timeframe: never long', () => {
    const r = evaluateSmcScreener(byTf(evalCandles(), -1), '15m');
    expect(r.direction).not.toBe('long');
    expect(r.status).toBe('NO_TRADE'); // bullish LTF structure can't support a short
  });

  it('forceDirection evaluates the short case against a bullish market', () => {
    const r = evaluateSmcScreener(byTf(evalCandles()), '15m', { forceDirection: 'short' });
    expect(r.direction).toBe('short');
    // Bullish HTF opposes the forced short: trend gate must fail.
    expect(r.hardGates.find((g) => g.id === 'trend')!.pass).toBe(false);
    expect(r.status).toBe('NO_TRADE');
    // Labels flip to the forced direction.
    expect(r.workflow.find((s) => s.id === 'choch')!.label).toBe('Bearish CHoCH');
  });

  it('empty input: NO_TRADE without throwing', () => {
    const r = evaluateSmcScreener({}, '15m');
    expect(r.status).toBe('NO_TRADE');
    expect(r.direction).toBeNull();
    expect(r.workflow.length).toBe(8);
    expect(r.currentPhase).toBe('Establishing higher-timeframe trend');
    expect(r.invalidation).toEqual([]);
  });
});

// ---------------------------------------------------------------- helper math

describe('screener indicator helpers', () => {
  it('sma/ema basic values', () => {
    expect(sma([1, 2, 3, 4], 2)[3]).toBeCloseTo(3.5);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBeCloseTo(2); // seeded with SMA(3)
    expect(e[4]).toBeGreaterThan(e[2]);
  });

  it('rsi is 100 on a monotonic rise and <50 on a fall', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const dn = Array.from({ length: 40 }, (_, i) => 100 - i);
    expect(rsi(up)).toBe(100);
    expect(rsi(dn)).toBeLessThan(50);
  });

  it('adx is finite and elevated on a strong trend', () => {
    const trend = htf(120, 1);
    const v = adx(trend);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(20);
  });

  it('atrSeries converges to the constant bar range', () => {
    const flat = Array.from({ length: 60 }, (_, i) => ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
    const a = atrSeries(flat, 14);
    expect(a[59]).toBeCloseTo(2, 1);
  });
});
