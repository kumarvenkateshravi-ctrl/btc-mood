import type { Candle, Timeframe } from '../types';
import type {
  CustomIndicatorConfig,
  IndicatorLineSegment,
  IndicatorPlot,
  IndicatorResult,
} from '../indicatorFramework';
import type { IndicatorEvaluationContext } from '../indicatorEvaluation';
import { neutralSignals, resolveInputs } from './itsTemplates';
import { periodKey, type HtfPeriod } from './htf';

interface PocMrpZoneInputs {
  show4hZones: boolean;
  showDailyZones: boolean;
  showWeeklyZones: boolean;
  showMrp: boolean;
  showWeeklyMrp: boolean;
  showWeeklyPoc: boolean;
  showDailyPoc: boolean;
  showFourHourPoc: boolean;
  showOneHourPoc: boolean;
  oneHourPocHistoryDays: number;
  pocLineWidth: number;
}

const DEFAULTS: PocMrpZoneInputs = {
  show4hZones: true,
  showDailyZones: true,
  showWeeklyZones: true,
  showMrp: true,
  showWeeklyMrp: true,
  showWeeklyPoc: true,
  showDailyPoc: true,
  showFourHourPoc: true,
  showOneHourPoc: true,
  oneHourPocHistoryDays: 3,
  pocLineWidth: 2,
};

const PERIOD_SECONDS: Record<'1H' | '4H' | 'D', number> = {
  '1H': 3600,
  '4H': 14400,
  D: 86400,
};
const PHI = 1.618034;
const SQRT_2 = Math.sqrt(2);

interface Bucket {
  key: number;
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Resampled {
  buckets: Bucket[];
  candleBucket: number[];
}

interface ZoneBounds {
  strongDemand: { lower: number; upper: number };
  weakDemand: { lower: number; upper: number };
  weakSupply: { lower: number; upper: number };
  strongSupply: { lower: number; upper: number };
}

function bucketStart(key: number, period: HtfPeriod): number {
  if (period === 'W') return (key * 7 - 3) * 86400;
  if (period === '1H' || period === '4H' || period === 'D') return key * PERIOD_SECONDS[period];
  return 0;
}

function resample(candles: Candle[], period: '1H' | '4H' | 'D' | 'W'): Resampled {
  const buckets: Bucket[] = [];
  const candleBucket = new Array<number>(candles.length);
  let current: Bucket | undefined;
  let currentIndex = -1;

  candles.forEach((candle, index) => {
    const key = periodKey(candle.time, period);
    if (!current || current.key !== key) {
      current = {
        key,
        startTime: bucketStart(key, period),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Math.max(0, candle.volume || 0),
      };
      buckets.push(current);
      currentIndex += 1;
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += Math.max(0, candle.volume || 0);
    }
    candleBucket[index] = currentIndex;
  });

  return { buckets, candleBucket };
}

/** TradingView ta.atr: true range followed by Wilder's RMA, SMA seeded. */
function atrByBucket(buckets: Bucket[], length: number): (number | null)[] {
  const out = new Array<number | null>(buckets.length).fill(null);
  if (length <= 0) return out;
  let seed = 0;
  let previous: number | null = null;
  for (let i = 0; i < buckets.length; i += 1) {
    const b = buckets[i];
    const priorClose = i > 0 ? buckets[i - 1].close : null;
    const tr = priorClose == null
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - priorClose), Math.abs(b.low - priorClose));
    if (i < length) seed += tr;
    if (i === length - 1) previous = seed / length;
    else if (i >= length && previous != null) previous = (previous * (length - 1) + tr) / length;
    if (previous != null && i >= length - 1) out[i] = previous;
  }
  return out;
}

function roundedBounds(
  open: number,
  sigma: number,
  weakDivisor: number,
  strongWidthDivisor: number,
  weakWidthDivisor: number,
): ZoneBounds | null {
  if (!Number.isFinite(open) || !Number.isFinite(sigma)) return null;
  const p = Math.round(open);
  const weakDistance = sigma / weakDivisor;
  const strongWidth = Math.round(sigma / strongWidthDivisor);
  const weakWidth = Math.round(sigma / weakWidthDivisor);
  return {
    strongDemand: {
      lower: Math.round(p - sigma - strongWidth / 2),
      upper: Math.round(p - sigma + strongWidth / 2),
    },
    weakDemand: {
      lower: Math.round(p - weakDistance - weakWidth / 2),
      upper: Math.round(p - weakDistance + weakWidth / 2),
    },
    weakSupply: {
      lower: Math.round(p + weakDistance - weakWidth / 2),
      upper: Math.round(p + weakDistance + weakWidth / 2),
    },
    strongSupply: {
      lower: Math.round(p + sigma - strongWidth / 2),
      upper: Math.round(p + sigma + strongWidth / 2),
    },
  };
}

function dailyBounds(open: number, priorAtr: number | null, priorClose: number | undefined): ZoneBounds | null {
  if (priorAtr == null || !priorClose) return null;
  const annualizedAtrPct = priorAtr / priorClose * Math.sqrt(252) * 100;
  const effectiveVolatility = 0.69 * annualizedAtrPct;
  const sigma = Math.round(open) * effectiveVolatility / (100 * Math.sqrt(252));
  return roundedBounds(open, sigma, 2 * SQRT_2, 4, 4 * PHI);
}

function weeklyBounds(open: number, priorAtr: number | null, priorClose: number | undefined): ZoneBounds | null {
  if (priorAtr == null || !priorClose) return null;
  const annualizedAtrPct = priorAtr / priorClose * Math.sqrt(52) * 100;
  const effectiveVolatility = 0.68 * annualizedAtrPct;
  const sigma = Math.round(open) * effectiveVolatility / (100 * Math.sqrt(252 / 5));
  return roundedBounds(open, sigma, 2 * SQRT_2, 4, 4 * PHI);
}

function fourHourBounds(open: number, priorAtr: number | null): ZoneBounds | null {
  if (priorAtr == null || !open) return null;
  const annualizedAtrPct = priorAtr / open * Math.sqrt(504) * 100;
  const effectiveVolatility = 0.92 * annualizedAtrPct;
  const sigma = Math.round(open) * effectiveVolatility / (100 * Math.sqrt(504));
  return roundedBounds(open, sigma, 2.77, 4.35, 5.1);
}

function timeframeSeconds(context: IndicatorEvaluationContext | undefined, candles: Candle[]): number {
  const fixed: Record<Timeframe, number> = {
    '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400,
  };
  if (context) return fixed[context.timeframe];
  if (candles.length < 2) return 300;
  return Math.max(1, candles[1].time - candles[0].time);
}

function developingMrp(candles: Candle[], weekly: boolean): (number | null)[] {
  const data = new Array<number | null>(candles.length).fill(null);
  let key: number | null = null;
  let priceVolume = 0;
  let volume = 0;
  candles.forEach((candle, index) => {
    const nextKey = periodKey(candle.time, weekly ? 'W' : 'D');
    if (nextKey !== key) {
      key = nextKey;
      priceVolume = 0;
      volume = 0;
    }
    const barVolume = Math.max(0, candle.volume || 0);
    priceVolume += ((candle.high + candle.low + candle.close) / 3) * barVolume;
    volume += barVolume;
    data[index] = volume > 0 ? priceVolume / volume : null;
  });
  return data;
}

function nativeDailyVwapAfterEachBucket(buckets: Bucket[]): (number | null)[] {
  const values = new Array<number | null>(buckets.length).fill(null);
  let day: number | null = null;
  let pv = 0;
  let volume = 0;
  buckets.forEach((bucket, index) => {
    const nextDay = periodKey(bucket.startTime, 'D');
    if (nextDay !== day) {
      day = nextDay;
      pv = 0;
      volume = 0;
    }
    pv += ((bucket.high + bucket.low + bucket.close) / 3) * bucket.volume;
    volume += bucket.volume;
    values[index] = volume > 0 ? pv / volume : null;
  });
  return values;
}

function pocSegments(
  resampled: Resampled,
  seconds: number,
  color: string,
  lineWidth: number,
  styleId: string,
  maximum?: number,
): IndicatorLineSegment[] {
  const completed = nativeDailyVwapAfterEachBucket(resampled.buckets);
  const segments: IndicatorLineSegment[] = [];
  for (let i = 1; i < resampled.buckets.length; i += 1) {
    const value = completed[i - 1];
    if (value == null) continue;
    const startTime = resampled.buckets[i].startTime;
    segments.push({
      id: `${styleId}-${resampled.buckets[i].key}`,
      styleId,
      startTime,
      endTime: startTime + seconds,
      startValue: value,
      endValue: value,
      color,
      lineWidth,
      lineStyle: 'solid',
    });
  }
  return maximum == null ? segments : segments.slice(-maximum);
}

type ZoneName = keyof ZoneBounds;

const ZONES: Array<{
  name: ZoneName;
  suffix: string;
  label: string;
}> = [
  { name: 'strongDemand', suffix: 'strong_demand', label: 'Strong Demand' },
  { name: 'weakDemand', suffix: 'weak_demand', label: 'Weak Demand' },
  { name: 'weakSupply', suffix: 'weak_supply', label: 'Weak Supply' },
  { name: 'strongSupply', suffix: 'strong_supply', label: 'Strong Supply' },
];

function appendZonePlots(
  plots: IndicatorPlot[],
  prefix: string,
  title: string,
  bounds: Array<ZoneBounds | null>,
  colors: Record<ZoneName, { line: string; fill: string }>,
) {
  for (const zone of ZONES) {
    const lower = bounds.map((value) => value?.[zone.name].lower ?? null);
    const upper = bounds.map((value) => value?.[zone.name].upper ?? null);
    const id = `${prefix}_${zone.suffix}`;
    plots.push({
      id: `${id}_background`,
      title: `${title} — ${zone.label} Background`,
      color: colors[zone.name].fill,
      type: 'band',
      data: bounds.map((value) => value ? value[zone.name] : null),
      axisLabel: false,
    });
    plots.push({
      id: `${id}_lower`,
      title: `${title} — ${zone.label} Lower`,
      color: colors[zone.name].line,
      type: 'line',
      lineType: 'withSteps',
      lineWidth: 1,
      data: lower,
      axisLabel: false,
    });
    plots.push({
      id: `${id}_upper`,
      title: `${title} — ${zone.label} Upper`,
      color: colors[zone.name].line,
      type: 'line',
      lineType: 'withSteps',
      lineWidth: 1,
      data: upper,
      axisLabel: false,
    });
  }
}

function zoneSeries(
  candles: Candle[],
  sampled: Resampled,
  atrLength: number,
  visible: boolean,
  calculate: (open: number, priorAtr: number | null, priorClose?: number) => ZoneBounds | null,
): Array<ZoneBounds | null> {
  if (!visible) return new Array(candles.length).fill(null);
  const atr = atrByBucket(sampled.buckets, atrLength);
  return candles.map((_, index) => {
    const bucketIndex = sampled.candleBucket[index];
    if (bucketIndex <= 0) return null;
    const bucket = sampled.buckets[bucketIndex];
    const previous = sampled.buckets[bucketIndex - 1];
    return calculate(bucket.open, atr[bucketIndex - 1], previous.close);
  });
}

function priorDailyTypical(candles: Candle[], daily: Resampled): (number | null)[] {
  return candles.map((_, index) => {
    const bucketIndex = daily.candleBucket[index];
    if (bucketIndex <= 0 || (index > 0 && daily.candleBucket[index - 1] !== bucketIndex)) return null;
    const previous = daily.buckets[bucketIndex - 1];
    return (previous.high + previous.low + previous.close) / 3;
  });
}

function weeklyOpen(candles: Candle[], weekly: Resampled): (number | null)[] {
  return candles.map((_, index) => {
    const bucketIndex = weekly.candleBucket[index];
    if (index > 0 && weekly.candleBucket[index - 1] !== bucketIndex) return null;
    return weekly.buckets[bucketIndex]?.open ?? null;
  });
}

export function computePocMrpZones(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  _computedSources?: Record<string, (number | null)[]>,
  context?: IndicatorEvaluationContext,
): IndicatorResult {
  const input = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  if (n === 0) return { plots: [], signals: [] };

  const chartSeconds = timeframeSeconds(context, candles);
  const supportsFourHour = chartSeconds <= PERIOD_SECONDS['4H'];
  const supportsOneHour = chartSeconds <= PERIOD_SECONDS['1H'];
  const oneHour = resample(candles, '1H');
  const fourHour = resample(candles, '4H');
  const daily = resample(candles, 'D');
  const weekly = resample(candles, 'W');

  const plots: IndicatorPlot[] = [];
  if (input.showMrp) plots.push({
    id: 'mrp', title: 'MRP', color: '#0B46F0', type: 'line', lineWidth: 2,
    data: developingMrp(candles, false),
  });
  if (input.showWeeklyMrp) plots.push({
    id: 'weekly_mrp', title: 'W MRP', color: '#C57A00', type: 'line', lineWidth: 1,
    data: developingMrp(candles, true),
  });
  if (input.showWeeklyPoc) plots.push({
    id: 'weekly_poc', title: 'Weekly POC', color: '#F59E0B', type: 'line', lineWidth: input.pocLineWidth,
    data: weeklyOpen(candles, weekly), axisLabel: false,
  });
  if (input.showDailyPoc) plots.push({
    id: 'daily_poc', title: 'Daily POC', color: '#14532D', type: 'line', lineWidth: input.pocLineWidth,
    data: priorDailyTypical(candles, daily), axisLabel: false,
  });

  const h4Bounds = zoneSeries(
    candles,
    fourHour,
    20,
    input.show4hZones && supportsFourHour,
    (open, atr) => fourHourBounds(open, atr),
  );
  const dayBounds = zoneSeries(candles, daily, 20, input.showDailyZones, dailyBounds);
  const weekBounds = zoneSeries(candles, weekly, 5, input.showWeeklyZones, weeklyBounds);

  appendZonePlots(plots, 'h4', '4H', h4Bounds, {
    strongDemand: { line: '#388E3C', fill: 'rgba(56,142,60,0.25)' },
    weakDemand: { line: '#76B852', fill: 'rgba(118,184,82,0.18)' },
    weakSupply: { line: '#FB8C00', fill: 'rgba(251,140,0,0.18)' },
    strongSupply: { line: '#E53935', fill: 'rgba(229,57,53,0.25)' },
  });
  appendZonePlots(plots, 'daily', 'Daily', dayBounds, {
    strongDemand: { line: '#00838F', fill: 'rgba(0,131,143,0.25)' },
    weakDemand: { line: '#00BCD4', fill: 'rgba(0,188,212,0.18)' },
    weakSupply: { line: '#E91E63', fill: 'rgba(233,30,99,0.18)' },
    strongSupply: { line: '#AD1457', fill: 'rgba(173,20,87,0.25)' },
  });
  appendZonePlots(plots, 'weekly', 'Weekly', weekBounds, {
    strongDemand: { line: '#1565C0', fill: 'rgba(21,101,192,0.25)' },
    weakDemand: { line: '#42A5F5', fill: 'rgba(66,165,245,0.18)' },
    weakSupply: { line: '#AB47BC', fill: 'rgba(171,71,188,0.18)' },
    strongSupply: { line: '#6A1B9A', fill: 'rgba(106,27,154,0.25)' },
  });

  const lineSegments: IndicatorLineSegment[] = [];
  if (input.showOneHourPoc && supportsOneHour) {
    lineSegments.push(...pocSegments(
      oneHour,
      PERIOD_SECONDS['1H'],
      '#A855F7',
      input.pocLineWidth,
      'one_hour_poc',
      Math.max(1, Math.round(input.oneHourPocHistoryDays)) * 24,
    ));
  }
  if (input.showFourHourPoc && supportsFourHour) {
    lineSegments.push(...pocSegments(
      fourHour,
      PERIOD_SECONDS['4H'],
      '#22D3EE',
      input.pocLineWidth,
      'four_hour_poc',
      500,
    ));
  }

  return { plots, lineSegments, signals: neutralSignals(n) };
}
