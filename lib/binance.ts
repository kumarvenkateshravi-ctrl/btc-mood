import type { Candle } from './types';

export function synthCandles(count = 500, seed = 42): Candle[] {
  // Deterministic random walk so SSR + client agree on shape.
  let state = seed;
  const rand = () => {
    // Mulberry32
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const candles: Candle[] = [];
  let price = 65000;
  const now = Math.floor(Date.now() / 1000);
  const interval = 60; // 1m bars

  for (let i = count - 1; i >= 0; i--) {
    const time = now - i * interval;
    const drift = (rand() - 0.5) * 80; // ~$40 std
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + rand() * 30;
    const low = Math.min(open, close) - rand() * 30;
    const volume = 50 + rand() * 200;
    candles.push({ time, open, high, low, close, volume });
    price = close;
  }
  return candles;
}
