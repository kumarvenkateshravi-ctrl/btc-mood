// Shared plumbing for library-backed (`indicatorts`) indicator ports.
//
// indicatorts returns plain `number[]` that is often SHORTER than the input
// (warm-up bars trimmed). Our framework expects every plot array to map 1:1
// with candles, with the warm-up padded by `null`. `alignRight` does that — the
// same right-align convention used by lib/indicators.ts and pad() in
// lib/indicatorCompute.ts.

import type { Candle } from '../types';
import type { CustomIndicatorConfig, SignalSide } from '../indicatorFramework';

/** Right-align a (possibly shorter) series to length `n`, padding warm-up with null. */
export function alignRight(values: number[], n: number): (number | null)[] {
  const out = new Array<number | null>(n).fill(null);
  const offset = n - values.length;
  for (let i = 0; i < values.length; i++) {
    const idx = i + offset;
    if (idx >= 0) out[idx] = values[i];
  }
  return out;
}

/** Column extractors — indicatorts takes parallel number[] arrays. */
export const cols = {
  open: (c: Candle[]) => c.map((x) => x.open),
  high: (c: Candle[]) => c.map((x) => x.high),
  low: (c: Candle[]) => c.map((x) => x.low),
  close: (c: Candle[]) => c.map((x) => x.close),
  volume: (c: Candle[]) => c.map((x) => x.volume),
};

export const neutralSignals = (n: number): SignalSide[] =>
  new Array<SignalSide>(n).fill('neutral');

/**
 * Resolve an indicator's inputs from two sources, over its declared defaults:
 *   1. the settings modal (`config.settings.inputs`)
 *   2. direct fields on the config object (programmatic calls + golden tests)
 * Only keys the indicator declares in `defaults` are read, so unrelated config
 * fields (`id`, `settings`) are ignored.
 */
export function resolveInputs<T extends object>(
  config: CustomIndicatorConfig | undefined,
  defaults: T,
): T {
  const merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  const direct = config as Record<string, unknown> | undefined;
  if (direct) {
    for (const k of Object.keys(merged)) {
      if (direct[k] !== undefined) merged[k] = direct[k];
    }
  }
  const fromSettings = config?.settings?.inputs;
  if (fromSettings) {
    for (const k of Object.keys(merged)) {
      if (fromSettings[k] !== undefined) merged[k] = fromSettings[k];
    }
  }
  return merged as T;
}
