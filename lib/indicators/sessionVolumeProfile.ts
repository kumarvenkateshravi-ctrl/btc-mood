// Session Volume Profile (SVP HD) — pure computation.
//
// A volume profile is a *price-indexed* histogram: rows are price buckets and
// each bar's length is the volume traded in that bucket. This is orthogonal to
// every other indicator in the app (which are time-indexed, 1:1 with candles),
// so nothing here returns IndicatorPlot data — the primitive draws it.
//
// Data tier: volume is distributed across each candle's own high→low range in
// proportion to the overlap with each row ("Tier A", see the plan). The seam for
// true lower-timeframe data is `buildProfile(bars, ...)` — swap the bars for
// sub-timeframe bars and every downstream consumer sharpens for free.

import type { Candle } from '../types';
import type {
  CustomIndicatorConfig,
  IndicatorResult,
  VolumeProfileRender,
  VolumeProfileStyle,
} from '../indicatorFramework';
import { classifyProfile, SHAPE_GLYPH, SHAPE_LABEL } from './profileShape';

// ---- Public types ----------------------------------------------------------

export type SessionMode =
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'visible'
  | 'custom';
export type VolumeMode = 'total' | 'updown' | 'delta';
export type RowsLayout = 'rows' | 'ticks';

export interface ProfileRow {
  /** Bucket bounds (price). */
  low: number;
  high: number;
  mid: number;
  /** Volume in this bucket. `total === up + down`. */
  total: number;
  up: number;
  down: number;
  /** Signed: up − down. Drives the Delta volume mode. */
  delta: number;
  /** True when the row is inside the value area. */
  inValueArea: boolean;
}

export interface VolumeProfile {
  /** Session bounds, in candle time (seconds). */
  startTime: number;
  endTime: number;
  /** Price extent covered by the rows. */
  low: number;
  high: number;
  rows: ProfileRow[];
  /** Point of Control — the price of the highest-volume row. */
  poc: number;
  pocIndex: number;
  /** Value Area High / Low. */
  vah: number;
  val: number;
  totalVolume: number;
  /** Volume of the fattest row — the histogram's scale reference. */
  maxRowVolume: number;
}

export interface ProfileOptions {
  /** 'rows' → rowSize is a row COUNT. 'ticks' → rowSize is ticks per row. */
  rowsLayout: RowsLayout;
  rowSize: number;
  /** Percentage of session volume inside the value area (TradingView: 70). */
  valueAreaVolume: number;
  /** Minimum price increment. Auto-derived from price magnitude when omitted. */
  tickSize?: number;
}

export interface SessionOptions {
  mode: SessionMode;
  /** Custom mode: minutes-from-midnight window, and the tz offset to apply. */
  customStartMin?: number;
  customEndMin?: number;
  tzOffsetMin?: number;
}

/** One session's worth of candles, with its resolved bounds. */
export interface SessionSlice {
  startTime: number;
  endTime: number;
  candles: Candle[];
}

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_WEEK = 604_800;
/** Unix epoch (Thu 1 Jan 1970) → the preceding Monday, for ISO-week bucketing. */
const EPOCH_TO_MONDAY = 259_200;

/** Hard ceiling per profile. TradingView caps *total* histogram rows near 6,000;
 *  this keeps any single session sane regardless of the user's row settings. */
export const MAX_ROWS_PER_PROFILE = 500;

const DEFAULT_PROFILE_OPTIONS: ProfileOptions = {
  rowsLayout: 'rows',
  rowSize: 24,
  valueAreaVolume: 70,
};

// ---- Session grouping ------------------------------------------------------

/**
 * Split candles into sessions.
 *
 * `daily`  — one profile per UTC day (the crypto analogue of TradingView's "All")
 * `weekly` — one profile per ISO week (Monday-anchored)
 * `visible`— a single profile over every candle passed in
 * `custom` — a user-defined intraday window, repeated per day
 *
 * Candles must be time-ascending. Sessions are returned in the same order.
 */
export function groupIntoSessions(
  candles: Candle[],
  opts: SessionOptions,
): SessionSlice[] {
  if (candles.length === 0) return [];

  if (opts.mode === 'visible') {
    return [
      {
        startTime: candles[0].time,
        endTime: candles[candles.length - 1].time,
        candles: candles.slice(),
      },
    ];
  }

  if (opts.mode === 'custom') {
    return groupCustom(candles, opts);
  }

  const bucketOf = bucketerFor(opts.mode);

  const out: SessionSlice[] = [];
  let currentBucket: number | null = null;
  let bucketCandles: Candle[] = [];

  for (const c of candles) {
    const b = bucketOf(c.time);
    if (currentBucket === null) {
      currentBucket = b;
    } else if (b !== currentBucket) {
      out.push(sliceOf(bucketCandles));
      bucketCandles = [];
      currentBucket = b;
    }
    bucketCandles.push(c);
  }
  if (bucketCandles.length > 0) out.push(sliceOf(bucketCandles));

  return out;
}

function groupCustom(candles: Candle[], opts: SessionOptions): SessionSlice[] {
  const tz = opts.tzOffsetMin ?? 0;
  const startMin = opts.customStartMin ?? 0;
  const endMin = opts.customEndMin ?? 24 * 60;
  // A window that wraps past midnight (e.g. 22:00 → 04:00) is treated as
  // belonging to the day it STARTED on, so an overnight session stays one
  // profile instead of splitting at 00:00.
  const wraps = endMin <= startMin;

  const byDay = new Map<number, Candle[]>();
  for (const c of candles) {
    const local = c.time + tz * 60;
    const minuteOfDay = Math.floor((local % SECONDS_PER_DAY) / 60);
    const inWindow = wraps
      ? minuteOfDay >= startMin || minuteOfDay < endMin
      : minuteOfDay >= startMin && minuteOfDay < endMin;
    if (!inWindow) continue;

    // Pre-midnight portion of a wrapping window keys to its own day; the
    // post-midnight portion keys back to the previous day.
    let day = Math.floor(local / SECONDS_PER_DAY);
    if (wraps && minuteOfDay < endMin) day -= 1;

    const bucket = byDay.get(day);
    if (bucket) bucket.push(c);
    else byDay.set(day, [c]);
  }

  return [...byDay.keys()]
    .sort((a, b) => a - b)
    .map((k) => sliceOf(byDay.get(k)!));
}

/** Fixed-length intraday session lengths, in seconds. */
const INTRADAY_SECONDS: Partial<Record<SessionMode, number>> = {
  '15m': 900,
  '30m': 1_800,
  '1h': 3_600,
  '4h': 14_400,
};

/**
 * Map a candle time to its session bucket index. Consecutive candles sharing a
 * bucket form one profile.
 *
 * Intraday, daily and weekly are fixed-length, so integer division works.
 * MONTHLY is not — months run 28–31 days, so a fixed divisor would drift out of
 * alignment within a year. It buckets on the calendar instead.
 */
function bucketerFor(mode: SessionMode): (t: number) => number {
  const fixed = INTRADAY_SECONDS[mode];
  if (fixed != null) return (t: number) => Math.floor(t / fixed);

  if (mode === 'weekly') {
    return (t: number) => Math.floor((t + EPOCH_TO_MONDAY) / SECONDS_PER_WEEK);
  }

  if (mode === 'monthly') {
    return (t: number) => {
      const d = new Date(t * 1000);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    };
  }

  // 'daily' and any future fallthrough.
  return (t: number) => Math.floor(t / SECONDS_PER_DAY);
}

function sliceOf(candles: Candle[]): SessionSlice {
  return {
    startTime: candles[0].time,
    endTime: candles[candles.length - 1].time,
    candles,
  };
}

// ---- Profile construction --------------------------------------------------

/**
 * Derive a sane tick size from price magnitude when the caller doesn't pin one.
 * BTC at ~60,000 → 0.1; a sub-dollar alt → 0.0001.
 */
export function autoTickSize(price: number): number {
  const p = Math.abs(price);
  if (!Number.isFinite(p) || p <= 0) return 0.01;
  if (p >= 10_000) return 0.1;
  if (p >= 100) return 0.01;
  if (p >= 1) return 0.001;
  return 0.0001;
}

/**
 * Build one volume profile from a session's candles.
 *
 * Volume is spread across each candle's high→low range weighted by how much of
 * the candle overlaps each row, then attributed to `up` or `down` by the
 * candle's own direction (close >= open). Returns null when there is nothing
 * meaningful to draw.
 */
export function buildProfile(
  candles: Candle[],
  options: Partial<ProfileOptions> = {},
): VolumeProfile | null {
  const opts: ProfileOptions = { ...DEFAULT_PROFILE_OPTIONS, ...options };
  if (candles.length === 0) return null;

  let low = Infinity;
  let high = -Infinity;
  let totalVolume = 0;
  for (const c of candles) {
    if (c.low < low) low = c.low;
    if (c.high > high) high = c.high;
    totalVolume += c.volume;
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || totalVolume <= 0) {
    return null;
  }

  const tickSize = opts.tickSize ?? autoTickSize(high);
  const range = high - low;

  // A session that never moved (all candles at one price) still deserves a
  // single row rather than a divide-by-zero.
  if (range <= 0) {
    const row: ProfileRow = {
      low,
      high,
      mid: low,
      total: totalVolume,
      up: totalVolume,
      down: 0,
      delta: totalVolume,
      inValueArea: true,
    };
    return {
      startTime: candles[0].time,
      endTime: candles[candles.length - 1].time,
      low,
      high,
      rows: [row],
      poc: low,
      pocIndex: 0,
      vah: high,
      val: low,
      totalVolume,
      maxRowVolume: totalVolume,
    };
  }

  const rowCount = resolveRowCount(range, tickSize, opts);
  const rowHeight = range / rowCount;

  const rows: ProfileRow[] = Array.from({ length: rowCount }, (_, i) => {
    const rLow = low + i * rowHeight;
    return {
      low: rLow,
      high: rLow + rowHeight,
      mid: rLow + rowHeight / 2,
      total: 0,
      up: 0,
      down: 0,
      delta: 0,
      inValueArea: false,
    };
  });

  // Distribute each candle's volume across the rows it spans.
  for (const c of candles) {
    if (c.volume <= 0) continue;
    const isUp = c.close >= c.open;
    const span = c.high - c.low;

    if (span <= 0) {
      const idx = clampIndex(Math.floor((c.low - low) / rowHeight), rowCount);
      addVolume(rows[idx], c.volume, isUp);
      continue;
    }

    const firstIdx = clampIndex(Math.floor((c.low - low) / rowHeight), rowCount);
    const lastIdx = clampIndex(Math.floor((c.high - low) / rowHeight), rowCount);

    for (let i = firstIdx; i <= lastIdx; i++) {
      const overlap =
        Math.min(c.high, rows[i].high) - Math.max(c.low, rows[i].low);
      if (overlap <= 0) continue;
      addVolume(rows[i], c.volume * (overlap / span), isUp);
    }
  }

  // POC — the fattest row. Ties resolve to the lower price, matching the
  // convention of taking the first occurrence.
  let pocIndex = 0;
  let maxRowVolume = rows[0].total;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].total > maxRowVolume) {
      maxRowVolume = rows[i].total;
      pocIndex = i;
    }
  }

  const { valIndex, vahIndex } = walkValueArea(
    rows,
    pocIndex,
    totalVolume,
    opts.valueAreaVolume,
  );
  for (let i = valIndex; i <= vahIndex; i++) rows[i].inValueArea = true;

  return {
    startTime: candles[0].time,
    endTime: candles[candles.length - 1].time,
    low,
    high,
    rows,
    poc: rows[pocIndex].mid,
    pocIndex,
    vah: rows[vahIndex].high,
    val: rows[valIndex].low,
    totalVolume,
    maxRowVolume,
  };
}

function addVolume(row: ProfileRow, vol: number, isUp: boolean): void {
  row.total += vol;
  if (isUp) row.up += vol;
  else row.down += vol;
  row.delta = row.up - row.down;
}

function clampIndex(i: number, count: number): number {
  if (i < 0) return 0;
  if (i > count - 1) return count - 1;
  return i;
}

/**
 * Resolve the row count from the two TradingView layout modes.
 *
 * 'rows'  — rowSize IS the count.
 * 'ticks' — rowSize is ticks per row, so the count falls out of the range.
 */
function resolveRowCount(
  range: number,
  tickSize: number,
  opts: ProfileOptions,
): number {
  if (opts.rowsLayout === 'ticks') {
    const ticksPerRow = Math.max(1, Math.round(opts.rowSize));
    const count = Math.ceil(range / (tickSize * ticksPerRow));
    return Math.min(MAX_ROWS_PER_PROFILE, Math.max(1, count));
  }
  const count = Math.round(opts.rowSize);
  return Math.min(MAX_ROWS_PER_PROFILE, Math.max(1, count));
}

/**
 * Expand outward from the POC, always taking the fatter neighbour, until the
 * accumulated volume reaches the value-area target. Returns the inclusive row
 * index bounds of the value area.
 */
function walkValueArea(
  rows: ProfileRow[],
  pocIndex: number,
  totalVolume: number,
  valueAreaPct: number,
): { valIndex: number; vahIndex: number } {
  const target = totalVolume * (clamp(valueAreaPct, 0, 100) / 100);
  let lo = pocIndex;
  let hi = pocIndex;
  let acc = rows[pocIndex].total;

  while (acc < target && (lo > 0 || hi < rows.length - 1)) {
    const below = lo > 0 ? rows[lo - 1].total : -1;
    const above = hi < rows.length - 1 ? rows[hi + 1].total : -1;
    if (below < 0 && above < 0) break;
    // Ties expand upward — an arbitrary but deterministic choice, so the same
    // input always yields the same value area.
    if (above >= below) {
      hi += 1;
      acc += rows[hi].total;
    } else {
      lo -= 1;
      acc += rows[lo].total;
    }
  }

  return { valIndex: lo, vahIndex: hi };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- Top-level convenience -------------------------------------------------

/** Group into sessions and build a profile for each. Empty sessions are dropped. */
export function buildSessionProfiles(
  candles: Candle[],
  sessionOpts: SessionOptions,
  profileOpts: Partial<ProfileOptions> = {},
): VolumeProfile[] {
  return groupIntoSessions(candles, sessionOpts)
    .map((s) => buildProfile(s.candles, profileOpts))
    .filter((p): p is VolumeProfile => p !== null);
}

/**
 * First candle after `afterTime` whose range contains `price` — TradingView's
 * "Extend … Right" stops the line where a later bar crosses it. `null` means
 * the level was never revisited, so the caller runs the line to the pane edge.
 */
export function levelCrossTime(
  candles: Candle[],
  afterTime: number,
  price: number,
): number | null {
  for (const c of candles) {
    if (c.time <= afterTime) continue;
    if (c.low <= price && price <= c.high) return c.time;
  }
  return null;
}

// ---- Indicator adapter -----------------------------------------------------

/** How many sessions we will draw. Beyond this the chart is unreadable anyway,
 *  and the row budget (see MAX_ROWS_PER_PROFILE) starts to bite. */
const MAX_PROFILES = 60;

const DEFAULTS = {
  sessions: 'daily',
  customStartHour: 9,
  customEndHour: 16,
  volume: 'updown',
  valueAreaVolume: 70,
  rowsLayout: 'rows',
  rowSize: 24,
  widthPct: 30,
  placement: 'left',
  showValues: false,
  showProfileBoxes: true,
  showWeeklyPocs: false,
  showDailyPocs: false,
  show4hPocs: false,
  extendPoc: false,
  extendVah: false,
  extendVal: false,
  showShapeLabel: true,
} as const;

// The value area is the SAME hue as the base bars, only more opaque. A separate
// hue reads as a different measurement; opacity reads as emphasis, which is what
// the value area actually is — the densest 70% of the same volume.
const STYLE_DEFAULTS: Record<string, string> = {
  upVolume: 'rgba(8, 153, 129, 0.50)',
  downVolume: 'rgba(242, 54, 69, 0.50)',
  valueAreaUp: 'rgba(8, 153, 129, 0.92)',
  valueAreaDown: 'rgba(242, 54, 69, 0.92)',
  poc: '#f0b90b',
  weeklyPoc: '#a855f7',
  dailyPoc: '#f0b90b',
  fourHourPoc: '#00bcd4',
  vah: '#787b86',
  val: '#787b86',
};

function pocStyleIdFor(mode: SessionMode): 'poc' | 'weeklyPoc' | 'dailyPoc' | 'fourHourPoc' {
  if (mode === 'weekly') return 'weeklyPoc';
  if (mode === 'daily') return 'dailyPoc';
  if (mode === '4h') return 'fourHourPoc';
  return 'poc';
}

/**
 * CustomIndicatorDef entry point. Returns no plots — a volume profile is
 * price-indexed, so it travels in `profiles` and is drawn by
 * SessionVolumeProfilePrimitive. Times stay in RAW candle time; the chart
 * wiring shifts them into chart time.
 */
export function computeSessionVolumeProfile(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const inputs = config?.settings?.inputs ?? {};
  const styles = config?.settings?.styles ?? {};

  const num = (id: keyof typeof DEFAULTS, fallback: number): number => {
    const v = Number(inputs[id]);
    return Number.isFinite(v) ? v : fallback;
  };
  const str = (id: keyof typeof DEFAULTS, fallback: string): string =>
    typeof inputs[id] === 'string' ? (inputs[id] as string) : fallback;
  const bool = (id: keyof typeof DEFAULTS, fallback: boolean): boolean =>
    typeof inputs[id] === 'boolean' ? (inputs[id] as boolean) : fallback;
  const color = (id: string): string => styles[id]?.color || STYLE_DEFAULTS[id];
  const shown = (id: string): boolean => styles[id]?.display !== false;

  const empty: IndicatorResult = { plots: [], signals: [] };
  if (candles.length === 0) return empty;

  const mode = str('sessions', DEFAULTS.sessions) as SessionMode;
  const profiles = buildSessionProfiles(
    candles,
    {
      mode,
      customStartMin: num('customStartHour', DEFAULTS.customStartHour) * 60,
      customEndMin: num('customEndHour', DEFAULTS.customEndHour) * 60,
    },
    {
      rowsLayout: str('rowsLayout', DEFAULTS.rowsLayout) as RowsLayout,
      rowSize: num('rowSize', DEFAULTS.rowSize),
      valueAreaVolume: num('valueAreaVolume', DEFAULTS.valueAreaVolume),
    },
  );
  if (profiles.length === 0) return empty;

  // Keep the most recent N — sessions scroll off to the left anyway.
  const recent = profiles.slice(-MAX_PROFILES);

  const extendPoc = bool('extendPoc', DEFAULTS.extendPoc);
  const extendVah = bool('extendVah', DEFAULTS.extendVah);
  const extendVal = bool('extendVal', DEFAULTS.extendVal);
  const showProfileBoxes = bool('showProfileBoxes', DEFAULTS.showProfileBoxes);

  const mainPocStyleId = pocStyleIdFor(mode);
  const rendered: VolumeProfileRender[] = recent.map((p) => {
    const cls = classifyProfile(p);
    return {
      startTime: p.startTime,
      endTime: p.endTime,
      low: p.low,
      high: p.high,
      rows: p.rows,
      poc: p.poc,
      vah: p.vah,
      val: p.val,
      totalVolume: p.totalVolume,
      maxRowVolume: p.maxRowVolume,
      pocColor: color(mainPocStyleId),
      showPoc: shown(mainPocStyleId),
      pocExtendTo: extendPoc ? levelCrossTime(candles, p.endTime, p.poc) : undefined,
      vahExtendTo: extendVah ? levelCrossTime(candles, p.endTime, p.vah) : undefined,
      valExtendTo: extendVal ? levelCrossTime(candles, p.endTime, p.val) : undefined,
      shapeGlyph: SHAPE_GLYPH[cls.shape],
      shapeLabel: SHAPE_LABEL[cls.shape],
      confidence: cls.confidence,
    };
  });

  const additionalPocModes: [SessionMode, boolean][] = [
    ['weekly', bool('showWeeklyPocs', DEFAULTS.showWeeklyPocs)],
    ['daily', bool('showDailyPocs', DEFAULTS.showDailyPocs)],
    ['4h', bool('show4hPocs', DEFAULTS.show4hPocs)],
  ];
  const pocOnlyProfiles: VolumeProfileRender[] = additionalPocModes.flatMap(([pocMode, enabled]) => {
    if (!enabled || pocMode === mode) return [];
    const pocStyleId = pocStyleIdFor(pocMode);
    return buildSessionProfiles(
      candles,
      { mode: pocMode },
      {
        rowsLayout: str('rowsLayout', DEFAULTS.rowsLayout) as RowsLayout,
        rowSize: num('rowSize', DEFAULTS.rowSize),
        valueAreaVolume: num('valueAreaVolume', DEFAULTS.valueAreaVolume),
      },
    ).slice(-MAX_PROFILES).map((p) => ({
      startTime: p.startTime,
      endTime: p.endTime,
      low: p.low,
      high: p.high,
      rows: [],
      poc: p.poc,
      vah: p.vah,
      val: p.val,
      totalVolume: p.totalVolume,
      maxRowVolume: p.maxRowVolume,
      pocColor: color(pocStyleId),
      showPoc: shown(pocStyleId),
      showRows: false,
      showVah: false,
      showVal: false,
      showShapeLabel: false,
    }));
  });

  const profileStyle: VolumeProfileStyle = {
    volumeMode: str('volume', DEFAULTS.volume) as VolumeMode,
    placement: str('placement', DEFAULTS.placement) as 'left' | 'right',
    showProfileBoxes,
    widthPct: num('widthPct', DEFAULTS.widthPct),
    showValues: showProfileBoxes && bool('showValues', DEFAULTS.showValues),
    upColor: color('upVolume'),
    downColor: color('downVolume'),
    vaUpColor: color('valueAreaUp'),
    vaDownColor: color('valueAreaDown'),
    pocColor: color('poc'),
    vahColor: color('vah'),
    valColor: color('val'),
    showPoc: shown('poc'),
    showVah: showProfileBoxes && shown('vah'),
    showVal: showProfileBoxes && shown('val'),
    extendPoc,
    extendVah,
    extendVal,
    showShapeLabel: showProfileBoxes && bool('showShapeLabel', DEFAULTS.showShapeLabel),
    shapeLabelBg: 'rgba(0, 0, 0, 0.55)',
    shapeLabelInk: '#e9eef7',
  };

  return {
    plots: [],
    signals: candles.map(() => 'neutral'),
    profiles: [...rendered, ...pocOnlyProfiles],
    profileStyle,
  };
}
