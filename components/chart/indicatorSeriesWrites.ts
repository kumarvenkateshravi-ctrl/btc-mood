export interface IndicatorSeriesLike<T> {
  setData(data: T[]): void;
  update(data: T): void;
}

export interface IndicatorSeriesSnapshot {
  raw: readonly unknown[];
  /** Last point actually accepted by the series, including across null gaps. */
  lastPoint: { time: number } | null;
}

export interface IndicatorSeriesWriteArgs<T> {
  series: IndicatorSeriesLike<T>;
  raw: readonly unknown[];
  candles: readonly unknown[];
  /** A context/structure transition can never safely use a tail delta. */
  structural: boolean;
  format(value: unknown, index: number): T | null;
  timeOf(point: T): number;
  equalPoint?(a: T, b: T): boolean;
}

export interface IndicatorSeriesWriteResult {
  snapshot: IndicatorSeriesSnapshot;
  wrote: 'full' | 'tail' | 'none';
}

export type TailMutation = 'full' | 'updateLast' | 'append' | 'none';

export function classifyTailMutation(previous: readonly unknown[] | undefined, next: readonly unknown[], structural: boolean): TailMutation {
  if (structural || !previous) return 'full';
  if (previous === next) return 'none';
  if (next.length === previous.length && samePrefix(previous, next, Math.max(0, next.length - 1))) return 'updateLast';
  if (next.length === previous.length + 1 && samePrefix(previous, next, previous.length)) return 'append';
  return 'full';
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  return aKeys.length === bKeys.length && aKeys.every((key) => Object.is(aRecord[key], bRecord[key]));
}

function samePoint<T>(a: T, b: T, equalPoint: ((a: T, b: T) => boolean) | undefined): boolean {
  return equalPoint ? equalPoint(a, b) : sameValue(a, b);
}

function samePrefix(previous: readonly unknown[], next: readonly unknown[], count: number): boolean {
  if (count < 0 || previous.length < count || next.length < count) return false;
  for (let index = 0; index < count; index++) {
    if (!sameValue(previous[index], next[index])) return false;
  }
  return true;
}

function formatAll<T>(raw: readonly unknown[], format: (value: unknown, index: number) => T | null, timeOf: (point: T) => number): T[] {
  const out: T[] = [];
  let lastTime = -Infinity;
  for (let index = 0; index < raw.length; index++) {
    const point = format(raw[index], index);
    if (point == null) continue;
    const time = timeOf(point);
    if (!Number.isFinite(time) || time <= lastTime) continue;
    lastTime = time;
    out.push(point);
  }
  return out;
}

function snapshotFor<T>(raw: readonly unknown[], formatted: readonly T[], timeOf: (point: T) => number): IndicatorSeriesSnapshot {
  const last = formatted.at(-1);
  return { raw, lastPoint: last ? { time: timeOf(last) } : null };
}

/**
 * Writes a complete indicator series only when the source context or history
 * changed. Otherwise it verifies that historical plot values are identical and
 * uses LWC's tail update for a forming candle or a one-bar append.
 */
export function writeIndicatorSeries<T>(
  args: IndicatorSeriesWriteArgs<T>,
  previous?: IndicatorSeriesSnapshot,
): IndicatorSeriesWriteResult {
  const full = (): IndicatorSeriesWriteResult => {
    const formatted = formatAll(args.raw, args.format, args.timeOf);
    args.series.setData(formatted);
    return { snapshot: snapshotFor(args.raw, formatted, args.timeOf), wrote: 'full' };
  };

  if (!previous || args.structural) return full();
  if (previous.raw === args.raw) return { snapshot: previous, wrote: 'none' };

  const sameLength = args.raw.length === previous.raw.length;
  const appended = args.raw.length === previous.raw.length + 1;
  const historicalCount = sameLength ? Math.max(0, args.raw.length - 1) : previous.raw.length;
  if ((!sameLength && !appended) || args.candles.length !== args.raw.length || !samePrefix(previous.raw, args.raw, historicalCount)) {
    return full();
  }

  const index = args.raw.length - 1;
  const nextPoint = args.format(args.raw[index], index);
  const previousTail = previous.raw.length > 0
    ? args.format(previous.raw[previous.raw.length - 1], previous.raw.length - 1)
    : null;

  // A disappearing forming value would require removing an existing series
  // point; LWC's update() cannot do that, so retain the full path.
  if (sameLength && previousTail != null && nextPoint == null) return full();
  if (nextPoint == null) return { snapshot: { raw: args.raw, lastPoint: previous.lastPoint }, wrote: 'none' };

  const nextTime = args.timeOf(nextPoint);
  if (!Number.isFinite(nextTime)) return full();
  if (sameLength && previousTail != null && previous.lastPoint?.time !== nextTime) return full();
  if (appended && previous.lastPoint != null && nextTime <= previous.lastPoint.time) return full();
  if (previousTail != null && samePoint(previousTail, nextPoint, args.equalPoint)) {
    return { snapshot: { raw: args.raw, lastPoint: previous.lastPoint }, wrote: 'none' };
  }

  args.series.update(nextPoint);
  return { snapshot: { raw: args.raw, lastPoint: { time: nextTime } }, wrote: 'tail' };
}
