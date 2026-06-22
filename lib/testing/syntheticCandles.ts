// Deterministic synthetic candles for tests and snapshot baselines.
//
// Seeded so a fixture generated today regenerates identically tomorrow. The
// price path moves through a quiet regime then an expansion so volatility /
// squeeze-style indicators have something real to react to.

import type { Candle } from '../types';

/** mulberry32 — tiny deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate `n` deterministic candles. The series spends its first third in a
 * tight range (low volatility), then trends up with widening range — useful
 * for exercising Bollinger/Keltner/squeeze logic.
 */
export function makeDeterministicCandles(n: number, seed = 1): Candle[] {
  const rnd = mulberry32(seed);
  const candles: Candle[] = [];
  let price = 100;
  const start = 1_700_000_000; // fixed epoch so `time` is stable

  for (let i = 0; i < n; i++) {
    const phase = i / n;
    // Volatility regime: calm early, expanding later.
    const vol = phase < 0.34 ? 0.15 : 0.15 + (phase - 0.34) * 4;
    // Drift: flat early, upward in the expansion.
    const drift = phase < 0.34 ? 0 : 0.35;

    const open = price;
    const shock = (rnd() - 0.5) * 2 * vol;
    const close = Math.max(1, open + drift + shock);
    const wickUp = rnd() * vol;
    const wickDn = rnd() * vol;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDn;
    const volume = 1000 + Math.floor(rnd() * 500);

    candles.push({
      time: start + i * 60,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }

  return candles;
}
