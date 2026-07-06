// Technical Scanner — Series Cache (Rule 2: one source of truth). Everything
// reads from here; nothing recalculates. Keys include a closed-bar signature,
// so intrabar ticks are O(1) and only a bar close triggers real work
// (the platform-wide perf lesson).

import type { Candle, Timeframe } from '../types';
import { SCANNER_SOURCES } from './registry';
import type { Series, SeriesRef } from './types';

const _cache = new Map<string, Series>();
const CAP = 64;

const closedSig = (candles: Candle[]): string => {
  const n = candles.length;
  return `${n}|${n > 0 ? candles[0].time : 0}|${n > 1 ? candles[n - 2].time : 0}`;
};

export function getSeries(ref: SeriesRef, tf: Timeframe, candles: Candle[]): Series {
  const source = SCANNER_SOURCES[ref.source];
  if (!source) return new Array(candles.length).fill(null);
  const key = `${ref.source}|${ref.output}|${JSON.stringify(ref.params ?? {})}|${tf}|${closedSig(candles)}`;
  const hit = _cache.get(key);
  if (hit) return hit;
  const series = source.series(candles, ref.params ?? {}, ref.output);
  if (_cache.size >= CAP) _cache.clear();
  _cache.set(key, series);
  return series;
}

/** Test-only. */
export function __clearSeriesCacheForTest(): void {
  _cache.clear();
}
