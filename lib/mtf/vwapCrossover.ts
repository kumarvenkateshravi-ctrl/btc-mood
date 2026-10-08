import { TIMEFRAMES, type Candle, type Timeframe } from '../types';
import { anchoredVwap } from '../indicators/maFvg/anchoredVwap';
import { vwapPeriodKey } from '../indicators/vwapAnchor';

export type VwapRelationship = 'above' | 'below' | 'equal' | 'unavailable';
export type VwapCrossDirection = 'bullish' | 'bearish' | 'none';

export interface DailyWeeklyVwapCross {
  daily: number | null;
  weekly: number | null;
  relationship: VwapRelationship;
  spreadPct: number | null;
  lastCross: VwapCrossDirection;
  lastCrossTime: number | null;
  barsSinceCross: number | null;
}

export type DailyWeeklyVwapCrossByTimeframe = Readonly<Record<Timeframe, DailyWeeklyVwapCross | null>>;

export interface PriceWeeklyVwapCross {
  price: number | null;
  weekly: number | null;
  relationship: VwapRelationship;
  spreadPct: number | null;
  lastCross: VwapCrossDirection;
  lastCrossTime: number | null;
  barsSinceCross: number | null;
}

export type PriceWeeklyVwapCrossByTimeframe = Readonly<Record<Timeframe, PriceWeeklyVwapCross | null>>;

const EMPTY: DailyWeeklyVwapCross = {
  daily: null,
  weekly: null,
  relationship: 'unavailable',
  spreadPct: null,
  lastCross: 'none',
  lastCrossTime: null,
  barsSinceCross: null,
};

const EMPTY_PRICE_WEEKLY: PriceWeeklyVwapCross = {
  price: null,
  weekly: null,
  relationship: 'unavailable',
  spreadPct: null,
  lastCross: 'none',
  lastCrossTime: null,
  barsSinceCross: null,
};

function comparison(daily: number | null, weekly: number | null): -1 | 0 | 1 | null {
  if (daily == null || weekly == null || !Number.isFinite(daily) || !Number.isFinite(weekly)) return null;
  return daily > weekly ? 1 : daily < weekly ? -1 : 0;
}

/**
 * Daily-versus-weekly anchored VWAP state, calculated from one chronological
 * intraday series. The VWAP core is shared with the chart indicators so both
 * surfaces reset at the same UTC session and Monday-week boundaries.
 */
export function computeDailyWeeklyVwapCross(candles: Candle[]): DailyWeeklyVwapCross {
  if (candles.length === 0) return EMPTY;

  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
  const { vwap: dailySeries } = anchoredVwap(candles, hlc3, 'session');
  const { vwap: weeklySeries } = anchoredVwap(candles, hlc3, 'week');

  let latestIndex = -1;
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    if (comparison(dailySeries[i], weeklySeries[i]) !== null) {
      latestIndex = i;
      break;
    }
  }
  if (latestIndex < 0) return EMPTY;

  let priorSign: -1 | 1 | null = null;
  let lastCross: VwapCrossDirection = 'none';
  let lastCrossIndex: number | null = null;
  for (let i = 0; i <= latestIndex; i += 1) {
    const sign = comparison(dailySeries[i], weeklySeries[i]);
    if (sign == null || sign === 0) continue;
    if (priorSign != null && sign !== priorSign) {
      lastCross = sign > 0 ? 'bullish' : 'bearish';
      lastCrossIndex = i;
    }
    priorSign = sign;
  }

  const daily = dailySeries[latestIndex];
  const weekly = weeklySeries[latestIndex];
  const sign = comparison(daily, weekly);
  const relationship: VwapRelationship = sign === 1 ? 'above' : sign === -1 ? 'below' : 'equal';
  const spreadPct = weekly && daily != null ? ((daily - weekly) / weekly) * 100 : null;

  return {
    daily,
    weekly,
    relationship,
    spreadPct,
    lastCross,
    lastCrossTime: lastCrossIndex == null ? null : candles[lastCrossIndex].time,
    barsSinceCross: lastCrossIndex == null ? null : latestIndex - lastCrossIndex,
  };
}

/**
 * Calculates the last confirmed Session/Weekly VWAP cross. Market data keeps
 * the live candle at the end of each series, so it is removed before the
 * crossover is evaluated to prevent intrabar signals from flickering.
 */
export function computeClosedDailyWeeklyVwapCross(candles: readonly Candle[]): DailyWeeklyVwapCross {
  if (candles.length < 2) return EMPTY;
  return computeDailyWeeklyVwapCross(candles.slice(0, -1));
}

/** Builds the shared six-timeframe VWAP crossover row used by both dashboards. */
export function computeClosedDailyWeeklyVwapCrossesByTimeframe(
  candlesByTimeframe: Partial<Record<Timeframe, readonly Candle[]>>,
): DailyWeeklyVwapCrossByTimeframe {
  return Object.freeze(TIMEFRAMES.reduce((crosses, timeframe) => {
    const candles = candlesByTimeframe[timeframe] ?? [];
    crosses[timeframe] = candles.length < 2 ? null : computeClosedDailyWeeklyVwapCross(candles);
    return crosses;
  }, {} as Record<Timeframe, DailyWeeklyVwapCross | null>));
}

/**
 * Latest close versus the week-anchored VWAP, plus the most recent confirmed
 * cross during the current UTC week. A new weekly anchor starts a fresh
 * comparison so the VWAP reset itself is never reported as a price cross.
 */
export function computePriceWeeklyVwapCross(candles: Candle[]): PriceWeeklyVwapCross {
  if (candles.length === 0) return EMPTY_PRICE_WEEKLY;

  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
  const { vwap: weeklySeries } = anchoredVwap(candles, hlc3, 'week');

  let latestIndex = -1;
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    if (comparison(candles[i].close, weeklySeries[i]) !== null) {
      latestIndex = i;
      break;
    }
  }
  if (latestIndex < 0) return EMPTY_PRICE_WEEKLY;

  let priorSign: -1 | 1 | null = null;
  let priorWeek: number | null = null;
  let lastCross: VwapCrossDirection = 'none';
  let lastCrossIndex: number | null = null;

  for (let i = 0; i <= latestIndex; i += 1) {
    const week = vwapPeriodKey(candles[i].time, 'week');
    if (week !== priorWeek) {
      priorWeek = week;
      priorSign = null;
      lastCross = 'none';
      lastCrossIndex = null;
    }

    const sign = comparison(candles[i].close, weeklySeries[i]);
    if (sign == null || sign === 0) continue;
    if (priorSign != null && sign !== priorSign) {
      lastCross = sign > 0 ? 'bullish' : 'bearish';
      lastCrossIndex = i;
    }
    priorSign = sign;
  }

  const price = candles[latestIndex].close;
  const weekly = weeklySeries[latestIndex];
  const sign = comparison(price, weekly);
  const relationship: VwapRelationship = sign === 1 ? 'above' : sign === -1 ? 'below' : 'equal';
  const spreadPct = weekly && Number.isFinite(price) ? ((price - weekly) / weekly) * 100 : null;

  return {
    price,
    weekly,
    relationship,
    spreadPct,
    lastCross,
    lastCrossTime: lastCrossIndex == null ? null : candles[lastCrossIndex].time,
    barsSinceCross: lastCrossIndex == null ? null : latestIndex - lastCrossIndex,
  };
}

/** Excludes the live forming candle before evaluating price versus Weekly VWAP. */
export function computeClosedPriceWeeklyVwapCross(candles: readonly Candle[]): PriceWeeklyVwapCross {
  if (candles.length < 2) return EMPTY_PRICE_WEEKLY;
  return computePriceWeeklyVwapCross(candles.slice(0, -1));
}

/** Builds the confirmed price/Weekly-VWAP state shown in the MTF matrix. */
export function computeClosedPriceWeeklyVwapCrossesByTimeframe(
  candlesByTimeframe: Partial<Record<Timeframe, readonly Candle[]>>,
): PriceWeeklyVwapCrossByTimeframe {
  return Object.freeze(TIMEFRAMES.reduce((crosses, timeframe) => {
    const candles = candlesByTimeframe[timeframe] ?? [];
    crosses[timeframe] = candles.length < 2 ? null : computeClosedPriceWeeklyVwapCross(candles);
    return crosses;
  }, {} as Record<Timeframe, PriceWeeklyVwapCross | null>));
}
