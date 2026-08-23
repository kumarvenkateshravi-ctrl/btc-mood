import type { Candle } from './types';

export interface DaySeparator {
  /** Source candle index where the new UTC day begins. */
  index: number;
  /** Unshifted source timestamp, matching the chart data path. */
  time: number;
  /** UTC day number (`Math.floor(time / 86400)`). */
  day: number;
}

/** Builds the immutable boundary index once per structural candle-history change. */
export function buildDaySeparatorIndex(source: readonly Candle[]): DaySeparator[] {
  const boundaries: DaySeparator[] = [];
  const seenDays = new Set<number>();
  for (let index = 1; index < source.length; index++) {
    const current = source[index];
    const previous = source[index - 1];
    if (current == null || previous == null || !Number.isFinite(current.time) || !Number.isFinite(previous.time)) continue;
    const day = Math.floor(current.time / 86_400);
    const previousDay = Math.floor(previous.time / 86_400);
    if (day !== previousDay && !seenDays.has(day)) {
      seenDays.add(day);
      boundaries.push({ index, time: current.time, day });
    }
  }
  return boundaries;
}

function lowerBound(boundaries: readonly DaySeparator[], value: number): number {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (boundaries[middle].index < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(boundaries: readonly DaySeparator[], value: number): number {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (boundaries[middle].index <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Returns only boundaries whose candle indices intersect the visible range. */
export function updateDaySeparatorIndex(
  previousSource: readonly Candle[],
  nextSource: readonly Candle[],
  previousBoundaries: readonly DaySeparator[],
): DaySeparator[] {
  const samePrefix = nextSource.length === previousSource.length && nextSource.length > 0 &&
    nextSource[0] === previousSource[0] &&
    (nextSource.length === 1 || nextSource[nextSource.length - 2] === previousSource[previousSource.length - 2]);
  const appended = nextSource.length === previousSource.length + 1 && previousSource.length > 0 &&
    nextSource[0] === previousSource[0] && nextSource[previousSource.length - 1] === previousSource[previousSource.length - 1];
  if (!samePrefix && !appended) return buildDaySeparatorIndex(nextSource);

  const lastIndex = nextSource.length - 1;
  const boundaries = samePrefix
    ? previousBoundaries.filter((boundary) => boundary.index < lastIndex)
    : previousBoundaries.slice();
  if (lastIndex < 1) return boundaries;
  const current = nextSource[lastIndex];
  const previous = nextSource[lastIndex - 1];
  if (current == null || previous == null || !Number.isFinite(current.time) || !Number.isFinite(previous.time)) return boundaries;
  const day = Math.floor(current.time / 86_400);
  const previousDay = Math.floor(previous.time / 86_400);
  if (day !== previousDay && !boundaries.some((boundary) => boundary.day === day)) {
    boundaries.push({ index: lastIndex, time: current.time, day });
  }
  return boundaries;
}

export function selectVisibleDaySeparators(
  boundaries: readonly DaySeparator[],
  range: { from: number; to: number } | null,
): DaySeparator[] {
  if (!range || boundaries.length === 0 || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return [];
  const from = Math.floor(Math.min(range.from, range.to));
  const to = Math.ceil(Math.max(range.from, range.to));
  const start = lowerBound(boundaries, from);
  const end = upperBound(boundaries, to);
  return boundaries.slice(start, end);
}
