import { computeFvgDomain, type FvgDomainObject, type FvgPolicy } from '../fvg/domain';
import { TIMEFRAMES, type Candle, type Timeframe } from '../types';

export interface ActiveFvgCounts {
  bullish: number;
  bearish: number;
  total: number;
}

export type ActiveTodayFvgCounts = ActiveFvgCounts;
export type ActiveFvgCountsByTimeframe = Readonly<Record<Timeframe, ActiveFvgCounts | null>>;

const EMPTY_COUNTS: ActiveFvgCounts = { bullish: 0, bearish: 0, total: 0 };

const dayStartUtc = (time: number): number => Math.floor(time / 86_400) * 86_400;

const policyFor = (timeframe: Timeframe): FvgPolicy => ({
  source: 'raw',
  sourceTimeframe: timeframe,
  requireClosedBars: true,
  threshold: { method: 'none', value: 0 },
  mitigation: 'close',
  partialFill: 'track',
  maxAgeBars: 500,
  maxHistory: 500,
});

function activeGaps(candles: readonly Candle[], timeframe: Timeframe): FvgDomainObject[] {
  if (candles.length < 4) return [];
  return computeFvgDomain([...candles], policyFor(timeframe), { hasFormingBar: true })
    .filter((gap) => gap.active);
}

function countsOf(gaps: readonly FvgDomainObject[]): ActiveFvgCounts {
  let bullish = 0;
  let bearish = 0;
  for (const gap of gaps) {
    if (gap.direction === 'bullish') bullish += 1;
    else bearish += 1;
  }
  return { bullish, bearish, total: bullish + bearish };
}

/**
 * Counts active, unmitigated FVGs in the existing 500-bar analytical window.
 * The current forming candle is excluded from both formation and mitigation.
 */
export function countActiveFvgs(candles: readonly Candle[], timeframe: Timeframe): ActiveFvgCounts {
  return countsOf(activeGaps(candles, timeframe));
}

/**
 * Counts FVGs created on the latest closed candle's UTC day that have not
 * been fully mitigated. The current forming candle is deliberately excluded
 * so an unconfirmed gap is never displayed as active.
 */
export function countActiveTodayFvgs(candles: readonly Candle[], timeframe: Timeframe): ActiveTodayFvgCounts {
  if (candles.length < 4) return { ...EMPTY_COUNTS };

  const lastClosed = candles[candles.length - 2];
  if (!lastClosed) return { ...EMPTY_COUNTS };

  const dayStart = dayStartUtc(lastClosed.time);
  return countsOf(activeGaps(candles, timeframe).filter((gap) => gap.createdTime >= dayStart));
}

/** Builds the display-only six-timeframe active-today FVG row used by both MTF dashboards. */
export function countActiveTodayFvgsByTimeframe(
  candlesByTimeframe: Partial<Record<Timeframe, readonly Candle[]>>,
): ActiveFvgCountsByTimeframe {
  return Object.freeze(TIMEFRAMES.reduce((counts, timeframe) => {
    const candles = candlesByTimeframe[timeframe] ?? [];
    counts[timeframe] = candles.length < 4 ? null : countActiveTodayFvgs(candles, timeframe);
    return counts;
  }, {} as Record<Timeframe, ActiveFvgCounts | null>));
}
