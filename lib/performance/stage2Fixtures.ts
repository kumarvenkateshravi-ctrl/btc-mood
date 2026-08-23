import { TIMEFRAMES, type Candle, type Timeframe } from '../types';

/** Fixed sizes shared by every Stage 2 baseline run. */
export const BASELINE_DATASET_SIZES = {
  small: 2_048,
  medium: 20_000,
  deep: 50_000,
} as const;

export type BaselineScale = keyof typeof BASELINE_DATASET_SIZES;

/** The approved scenario names are intentionally stable for later comparisons. */
export const BASELINE_SCENARIOS = [
  'forming-live-tick',
  'closed-bar-update',
  'history-prepend',
  'replay-step',
  'indicator-toggle',
  'timeframe-switch',
  'visible-range-pan',
  'indicator-computation',
  'indicator-setData',
  'svp-poc',
  'heikin-ashi',
  'renko',
  'paper-noop-reconciliation',
  'day-separator-pan',
] as const;

export type BaselineScenario = (typeof BASELINE_SCENARIOS)[number];

export type BaselineStack = 'light' | 'heavy';

/**
 * Deterministic pseudo-random walk. It is deliberately independent of wall
 * clock, exchange data, and Math.random so later tasks compare identical bars.
 */
function nextRandom(state: { value: number }): number {
  state.value = (state.value * 1_664_525 + 1_013_904_223) >>> 0;
  return state.value / 0x1_0000_0000;
}

export function createBaselineCandles(count: number, seed = 0x5eed): Candle[] {
  const random = { value: seed >>> 0 };
  const out: Candle[] = [];
  let close = 50_000;
  const start = 1_700_000_000;

  for (let i = 0; i < count; i++) {
    const drift = (nextRandom(random) - 0.5) * 160;
    const open = close;
    close = Math.max(100, close + drift);
    const spread = 20 + nextRandom(random) * 140;
    const high = Math.max(open, close) + spread;
    const low = Math.min(open, close) - spread * (0.7 + nextRandom(random) * 0.6);
    out.push({
      time: start + i * 300,
      open,
      high,
      low,
      close,
      volume: 50 + nextRandom(random) * 950,
    });
  }
  return out;
}

export function createBaselineTimeframes(
  count: number,
  seed = 0x5eed,
): Record<Timeframe, Candle[]> {
  return Object.fromEntries(
    TIMEFRAMES.map((tf, i) => [tf, createBaselineCandles(count, seed + i * 97)]),
  ) as Record<Timeframe, Candle[]>;
}
