import { describe, it, expect } from 'vitest';
import { computeDsmart, DSMART_DEFAULTS } from './dsmartLine';
import type { Candle } from '@/lib/types';

// Brick-like fixtures: monotone bodies of size 1 (what toRenko emits).
function bricks(dirs: number[], start = 100): Candle[] {
  let close = start;
  return dirs.map((d, i) => {
    const open = close;
    close = open + d;
    return { time: i + 1, open, close, high: Math.max(open, close), low: Math.min(open, close), volume: 0 };
  });
}
const rep = (d: number, n: number) => new Array(n).fill(d);

describe('computeDsmart', () => {
  it('steady uptrend: bullish regime, ratcheting Walking Line, Running above Walking, no P', () => {
    const r = computeDsmart(bricks(rep(1, 40)));
    expect(r.regime[39]).toBe(1);
    // ratchet: walk never decreases while bullish
    for (let i = 1; i < 40; i++) expect(r.walk[i]!).toBeGreaterThanOrEqual(r.walk[i - 1]!);
    // running is the aggressive (closer to price) edge of a bullish cloud
    expect(r.run[39]!).toBeGreaterThan(r.walk[39]!);
    expect(r.events.filter((e) => e.type === 'pullback')).toEqual([]);
    // clean run → offset contracts → cloud narrower late than early
    expect(r.cloudWidth[39]!).toBeLessThanOrEqual(r.cloudWidth[5]!);
  });

  it('pullback then resumption prints exactly one P at the pullback brick', () => {
    // 10-up leg, 2-down pullback, resume up
    const dirs = [...rep(1, 10), -1, -1, ...rep(1, 5)];
    const r = computeDsmart(bricks(dirs));
    const ps = r.events.filter((e) => e.type === 'pullback');
    expect(ps).toEqual([{ type: 'pullback', direction: 'bullish', barIndex: 11 }]);
    // regime never flipped
    expect(r.regime.every((x) => x === 1)).toBe(true);
  });

  it('alternating chop prints no P (trend-leg requirement) and widens the cloud', () => {
    // pure alternation: every "leg" is 1 brick, so the trend-leg gate blocks P
    const chop = computeDsmart(bricks([1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1]));
    expect(chop.events.filter((e) => e.type === 'pullback')).toEqual([]);
    // the whipsaw-reduction promise: widened offsets keep the regime stable
    // through pure alternation instead of flipping every bar
    expect(new Set(chop.regime.filter((x) => x !== 0)).size).toBe(1);
    // cloud edges never invert (Running = price-side edge of the cloud)
    for (let i = 0; i < 16; i++) {
      if (chop.regime[i] === 1) expect(chop.run[i]!).toBeGreaterThanOrEqual(chop.walk[i]!);
    }
  });

  it('strong reversal flips the Walking regime', () => {
    const r = computeDsmart(bricks([...rep(1, 15), ...rep(-1, 12)]));
    expect(r.regime[10]).toBe(1);
    expect(r.regime[26]).toBe(-1);
    // after the flip, walking sits above price (bearish trail)
    const last = r.walk[26]!;
    expect(last).toBeGreaterThan(100 + 15 - 12);
  });

  it('stretched climb then down brick prints a bearish star', () => {
    // long run → close far above SMA(20) → disparity beyond threshold at flip
    const r = computeDsmart(bricks([...rep(1, 30), -1, -1]), { ...DSMART_DEFAULTS, dispThreshold: 0.02 });
    const stars = r.events.filter((e) => e.type === 'star');
    expect(stars.length).toBeGreaterThanOrEqual(1);
    expect(stars[0]).toMatchObject({ direction: 'bearish', barIndex: 30 });
  });

  it('continuation arrows fire on Donchian transitions, not every bar', () => {
    // up leg → pause (down/up chop below highs) → new highs again
    const dirs = [...rep(1, 12), -1, -1, 1, -1, ...rep(1, 6)];
    const r = computeDsmart(bricks(dirs));
    const arrows = r.events.filter((e) => e.type === 'arrow' && e.direction === 'bullish');
    // fires when the upper band STARTS rising again, once per transition
    expect(arrows.length).toBeGreaterThanOrEqual(1);
    const idx = arrows.map((a) => a.barIndex);
    expect(new Set(idx).size).toBe(idx.length);
    // strictly fewer arrows than up-bars (transition-only)
    expect(arrows.length).toBeLessThan(dirs.filter((d) => d === 1).length);
  });

  it('is deterministic and safe on empty input', () => {
    expect(computeDsmart([])).toMatchObject({ walk: [], events: [], brickUnit: 0 });
    const fixture = bricks([...rep(1, 8), -1, ...rep(1, 4), ...rep(-1, 6)]);
    const a = computeDsmart(fixture);
    const b = computeDsmart(fixture);
    expect(a).toEqual(b);
  });

  it('works on real candle shapes (non-unit bodies, wicks)', () => {
    const candles: Candle[] = [];
    let close = 100;
    for (let i = 0; i < 120; i++) {
      const drift = i < 60 ? 0.8 : -0.6;
      const open = close;
      close = open + drift + Math.sin(i * 1.7) * 0.4;
      candles.push({
        time: i + 1,
        open,
        close,
        high: Math.max(open, close) + 0.3,
        low: Math.min(open, close) - 0.3,
        volume: 1,
      });
    }
    const r = computeDsmart(candles);
    expect(r.regime[50]).toBe(1);
    expect(r.regime[119]).toBe(-1);
    expect(r.walk.every((v, i) => v == null || Number.isFinite(v!) || i < 0)).toBe(true);
    expect(r.brickUnit).toBeGreaterThan(0);
  });
});
