// Volatility regime: returns a 0..1 number for the recent realized
// volatility of a candle series. Used by the chart's regime wash.
//
// We compute a 14-bar log-return standard deviation, then squash it
// into [0, 1] using a sigmoid-like mapping calibrated for BTC's
// typical 1h vol range. 0 = very calm, 1 = very hot.

const WINDOW = 14;
const SCALE = 0.012; // 1.2% per-bar log-return stddev → 0.5

export function regimeScore(candles: { close: number }[]): number {
  if (candles.length < WINDOW + 1) return 0.15; // default cool
  let sum = 0;
  let sum2 = 0;
  for (let i = candles.length - WINDOW; i < candles.length; i++) {
    const a = candles[i - 1].close;
    const b = candles[i].close;
    if (a <= 0 || b <= 0) continue;
    const r = Math.log(b / a);
    sum += r;
    sum2 += r * r;
  }
  const n = WINDOW;
  const mean = sum / n;
  const variance = Math.max(0, sum2 / n - mean * mean);
  const std = Math.sqrt(variance);
  // Logistic: small std → ~0, large std → ~1. Centered at SCALE.
  const x = std / SCALE;
  return 1 / (1 + Math.exp(-x + 2.5));
}
