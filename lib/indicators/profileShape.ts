// Profile Shape Classification — the analytical layer TradingView doesn't have.
//
// A volume profile tells you *where* trade happened. Its SHAPE tells you what
// kind of auction produced it: balance, a failed probe, a liquidation, a trend
// that found two separate areas of acceptance. This module turns the geometry
// into a label, a confidence, and a sentence.
//
// Design: an ordered decision cascade (first match wins) over explicit features,
// NOT a black box. Every branch is independently testable and every threshold
// lives in SHAPE_THRESHOLDS so it can be tuned without touching logic.

import type { VolumeProfile } from './sessionVolumeProfile';

// ---- Public types ----------------------------------------------------------

export type ProfileShape =
  | 'double-distribution'
  | 'trend'
  | 'extreme'
  | 'p-shape'
  | 'b-shape'
  | 'd-shape'
  | 'balanced'
  | 'neutral';

export interface ShapeFeatures {
  /** Where the POC sits in the profile's price range. 0 = low, 1 = high. */
  pocPosition: number;
  /** (VAH − VAL) / range. Low = concentrated, high = spread out. */
  vaCoverage: number;
  /** Fattest row as a share of total volume. Low = elongated/thin. */
  maxRowShare: number;
  /** Volume-weighted 3rd standardized moment. Negative = mass sits high. */
  skew: number;
  /** Volume-weighted 4th standardized moment. High = tight peak. */
  kurtosis: number;
  /** Count of prominent peaks after smoothing. */
  peaks: number;
  /** Separation quality between the two fattest peaks. 0..1, higher = deeper. */
  valleyDepth: number;
  /** Share of volume in the outer 10% of rows (both ends). */
  tailShare: number;
  /** Number of rows — guards against classifying noise. */
  rowCount: number;
}

export interface ProfileClassification {
  shape: ProfileShape;
  /** 0..1 — margin to the nearest competing threshold. Low = borderline. */
  confidence: number;
  features: ShapeFeatures;
  /** Orthogonal to `shape`: thin single-print tails indicating rejection. */
  hasExtremes: boolean;
  /** Human sentence, for narration and reports. */
  why: string;
}

/** Tunable in one place. Snapshot-testable; never inlined into the cascade. */
export const SHAPE_THRESHOLDS = {
  /** Below this many rows we refuse to classify. */
  minRows: 8,
  /** Double distribution: peak count and how deep the valley between them is. */
  doubleValleyDepth: 0.55,
  /** Peaks below this share of the tallest are noise, not distributions. */
  peakNoiseFloor: 0.15,
  /** Trend: no row dominates, and value spreads across most of the range.
   *  Note the coverage bound sits just BELOW 0.70: a perfectly flat profile's
   *  value area covers ~70% of its range by definition (that's what a 70%
   *  value area means), so a 0.72 bound could never catch a true trend day. */
  trendMaxRowShare: 0.06,
  trendVaCoverage: 0.68,
  /** Extreme: POC pinned in an outer decile. */
  extremeLow: 0.1,
  extremeHigh: 0.9,
  /** Extreme needs some concentration, else it's just a thin noisy profile. */
  extremeMinRowShare: 0.08,
  /** P / b: POC displaced toward one end, with matching asymmetry. */
  pPocPosition: 0.65,
  bPocPosition: 0.35,
  skewMagnitude: 0.35,
  /** D vs Balanced: both centred, separated by how tightly value clusters.
   *  Deliberately NOT kurtosis — a normal distribution's kurtosis is exactly
   *  3.0, so any threshold near it puts every bell-shaped profile on a knife
   *  edge. Measured value-area coverage separates the two by ~3x
   *  (tight bell ≈ 0.15, broad bell ≈ 0.43), which is stable under noise.
   *  Kurtosis stays in ShapeFeatures as a diagnostic for reports. */
  centeredTight: 0.12,
  centeredLoose: 0.18,
  dVaCoverage: 0.32,
  /** hasExtremes: outer-decile rows this far below average volume = thin tails. */
  thinTailRatio: 0.2,
} as const;

export const SHAPE_LABEL: Record<ProfileShape, string> = {
  'double-distribution': 'Double Distribution',
  trend: 'Trend',
  extreme: 'Extreme',
  'p-shape': 'P Shape',
  'b-shape': 'b Shape',
  'd-shape': 'D Shape',
  balanced: 'Balanced',
  neutral: 'Neutral',
};

/** Compact glyph for dense UI (chart label, matrix cell). */
export const SHAPE_GLYPH: Record<ProfileShape, string> = {
  'double-distribution': 'DD',
  trend: 'TR',
  extreme: 'EX',
  'p-shape': 'P',
  'b-shape': 'b',
  'd-shape': 'D',
  balanced: 'BAL',
  neutral: '—',
};

// ---- Feature extraction ----------------------------------------------------

/** Derive every classification feature from a built profile. */
export function extractFeatures(profile: VolumeProfile): ShapeFeatures {
  const { rows, totalVolume, low, high } = profile;
  const range = high - low;
  const rowCount = rows.length;

  const empty: ShapeFeatures = {
    pocPosition: 0.5,
    vaCoverage: 0,
    maxRowShare: 0,
    skew: 0,
    kurtosis: 0,
    peaks: 0,
    valleyDepth: 0,
    tailShare: 0,
    rowCount,
  };
  if (rowCount === 0 || totalVolume <= 0 || range <= 0) return empty;

  const pocPosition = clamp01((profile.poc - low) / range);
  const vaCoverage = clamp01((profile.vah - profile.val) / range);
  const maxRowShare = profile.maxRowVolume / totalVolume;

  // Volume-weighted moments over normalized price position.
  const positions = rows.map((r) => (r.mid - low) / range);
  const weights = rows.map((r) => r.total);

  let mean = 0;
  for (let i = 0; i < rowCount; i++) mean += positions[i] * weights[i];
  mean /= totalVolume;

  let variance = 0;
  for (let i = 0; i < rowCount; i++) {
    variance += weights[i] * (positions[i] - mean) ** 2;
  }
  variance /= totalVolume;
  const sd = Math.sqrt(variance);

  let skew = 0;
  let kurtosis = 0;
  if (sd > 1e-9) {
    for (let i = 0; i < rowCount; i++) {
      const z = (positions[i] - mean) / sd;
      skew += weights[i] * z ** 3;
      kurtosis += weights[i] * z ** 4;
    }
    skew /= totalVolume;
    kurtosis /= totalVolume;
  }

  const { peaks, valleyDepth } = analyzePeaks(rows.map((r) => r.total));

  // Outer-decile volume share (both ends combined).
  const edge = Math.max(1, Math.round(rowCount * 0.1));
  let tailVolume = 0;
  for (let i = 0; i < edge; i++) tailVolume += rows[i].total;
  for (let i = rowCount - edge; i < rowCount; i++) tailVolume += rows[i].total;
  const tailShare = tailVolume / totalVolume;

  return {
    pocPosition,
    vaCoverage,
    maxRowShare,
    skew,
    kurtosis,
    peaks,
    valleyDepth,
    tailShare,
    rowCount,
  };
}

/**
 * Smooth, then find prominent peaks and measure the valley between the two
 * fattest. Smoothing first is what stops a single noisy row from faking a
 * second distribution.
 */
function analyzePeaks(volumes: number[]): { peaks: number; valleyDepth: number } {
  const n = volumes.length;
  if (n < 3) return { peaks: n > 0 ? 1 : 0, valleyDepth: 0 };

  // 3-row moving average.
  const smooth: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = volumes[Math.max(0, i - 1)];
    const b = volumes[i];
    const c = volumes[Math.min(n - 1, i + 1)];
    smooth[i] = (a + b + c) / 3;
  }

  const max = Math.max(...smooth);
  if (max <= 0) return { peaks: 0, valleyDepth: 0 };
  const floor = max * SHAPE_THRESHOLDS.peakNoiseFloor;

  // Interior local maxima above the noise floor.
  const maxima: { index: number; value: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (smooth[i] >= floor && smooth[i] > smooth[i - 1] && smooth[i] >= smooth[i + 1]) {
      maxima.push({ index: i, value: smooth[i] });
    }
  }
  if (maxima.length === 0) return { peaks: 0, valleyDepth: 0 };
  if (maxima.length === 1) return { peaks: 1, valleyDepth: 0 };

  // Valley between the two tallest peaks.
  const sorted = [...maxima].sort((a, b) => b.value - a.value);
  const [p1, p2] = sorted;
  const lo = Math.min(p1.index, p2.index);
  const hi = Math.max(p1.index, p2.index);
  let valley = Infinity;
  for (let i = lo; i <= hi; i++) valley = Math.min(valley, smooth[i]);

  const shallower = Math.min(p1.value, p2.value);
  const valleyDepth = shallower > 0 ? clamp01(1 - valley / shallower) : 0;

  return { peaks: maxima.length, valleyDepth };
}

// ---- Classification cascade ------------------------------------------------

/**
 * Classify a profile's shape.
 *
 * Rule order matters. Double Distribution is tested first because a two-peaked
 * profile otherwise masquerades as Balanced — its mean sits in the middle of
 * the valley, right where a centred POC would be.
 */
export function classifyProfile(profile: VolumeProfile): ProfileClassification {
  const f = extractFeatures(profile);
  const T = SHAPE_THRESHOLDS;
  const hasExtremes = detectExtremes(profile);

  // 0 — not enough structure to say anything honest.
  if (f.rowCount < T.minRows || profile.totalVolume <= 0) {
    return {
      shape: 'neutral',
      confidence: 0,
      features: f,
      hasExtremes,
      why: 'Not enough data in this session to classify the profile.',
    };
  }

  // 1 — Double Distribution: two accepted areas split by a rejected middle.
  if (f.peaks >= 2 && f.valleyDepth >= T.doubleValleyDepth) {
    return done(
      'double-distribution',
      margin(f.valleyDepth, T.doubleValleyDepth, 1),
      f,
      hasExtremes,
      'Two separate areas of acceptance with a rejected middle — price found value twice. The thin zone between them tends to reject on re-test.',
    );
  }

  // 2 — Trend: nothing dominates, value smeared across the range.
  if (f.maxRowShare < T.trendMaxRowShare && f.vaCoverage > T.trendVaCoverage) {
    return done(
      'trend',
      Math.min(
        margin(T.trendMaxRowShare, f.maxRowShare, T.trendMaxRowShare),
        margin(f.vaCoverage, T.trendVaCoverage, 1),
      ),
      f,
      hasExtremes,
      'Elongated profile with no dominant price — one-way auction, little acceptance anywhere.',
    );
  }

  // 3 — Extreme: POC pinned at an outer decile, beyond even P/b displacement.
  const atTop = f.pocPosition >= T.extremeHigh;
  const atBottom = f.pocPosition <= T.extremeLow;
  if ((atTop || atBottom) && f.maxRowShare >= T.extremeMinRowShare) {
    return done(
      'extreme',
      margin(
        atTop ? f.pocPosition : 1 - f.pocPosition,
        T.extremeHigh,
        1,
      ),
      f,
      hasExtremes,
      atTop
        ? 'Volume pinned at the very top of the range — aggressive buying with no acceptance below.'
        : 'Volume pinned at the very bottom of the range — aggressive selling with no acceptance above.',
    );
  }

  // 4 — P: bulge high, thin tail below (mass high ⇒ negative skew).
  if (f.pocPosition >= T.pPocPosition && f.skew < -T.skewMagnitude) {
    return done(
      'p-shape',
      Math.min(
        margin(f.pocPosition, T.pPocPosition, 1),
        margin(-f.skew, T.skewMagnitude, 1.5),
      ),
      f,
      hasExtremes,
      'P-shape — buyers drove price up and value built at the highs. Typically short covering; watch for exhaustion rather than continuation.',
    );
  }

  // 5 — b: bulge low, thin tail above.
  if (f.pocPosition <= T.bPocPosition && f.skew > T.skewMagnitude) {
    return done(
      'b-shape',
      Math.min(
        margin(1 - f.pocPosition, 1 - T.bPocPosition, 1),
        margin(f.skew, T.skewMagnitude, 1.5),
      ),
      f,
      hasExtremes,
      'b-shape — sellers drove price down and value built at the lows. Typically long liquidation; sellers in control into the close.',
    );
  }

  // 6 — D: centred with value tightly clustered — the textbook bell.
  const offCentre = Math.abs(f.pocPosition - 0.5);
  if (offCentre <= T.centeredTight && f.vaCoverage <= T.dVaCoverage) {
    return done(
      'd-shape',
      Math.min(
        margin(T.centeredTight, offCentre, T.centeredTight),
        margin(T.dVaCoverage, f.vaCoverage, T.dVaCoverage),
      ),
      f,
      hasExtremes,
      'D-shape — a tight bell around a central price. Two-sided auction in clear balance.',
    );
  }

  // 7 — Balanced: centred but broad/flat.
  if (offCentre <= T.centeredLoose) {
    return done(
      'balanced',
      margin(T.centeredLoose, offCentre, T.centeredLoose),
      f,
      hasExtremes,
      'Balanced — value centred but spread out. Two-sided trade without a strong single reference price.',
    );
  }

  // 8 — nothing matched cleanly.
  return {
    shape: 'neutral',
    confidence: 0.2,
    features: f,
    hasExtremes,
    why: 'No clear profile shape — the session does not fit a standard distribution.',
  };
}

/**
 * Thin outer-decile rows relative to the average row = single-print style
 * rejection tails. Orthogonal to the shape: a P-shape can also have extremes.
 */
function detectExtremes(profile: VolumeProfile): boolean {
  const { rows, totalVolume } = profile;
  const n = rows.length;
  if (n < SHAPE_THRESHOLDS.minRows || totalVolume <= 0) return false;

  const avgRow = totalVolume / n;
  if (avgRow <= 0) return false;
  const edge = Math.max(1, Math.round(n * 0.1));

  const meanOf = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i++) s += rows[i].total;
    return s / Math.max(1, to - from);
  };

  const lowTail = meanOf(0, edge) / avgRow;
  const highTail = meanOf(n - edge, n) / avgRow;
  return (
    lowTail < SHAPE_THRESHOLDS.thinTailRatio ||
    highTail < SHAPE_THRESHOLDS.thinTailRatio
  );
}

function done(
  shape: ProfileShape,
  confidence: number,
  features: ShapeFeatures,
  hasExtremes: boolean,
  why: string,
): ProfileClassification {
  return { shape, confidence: clamp01(confidence), features, hasExtremes, why };
}

/**
 * How far past a threshold a value sits, normalized against the distance to
 * saturation. A value that only just clears its rule reports low confidence
 * rather than false certainty.
 */
function margin(value: number, threshold: number, saturateAt: number): number {
  const span = saturateAt - threshold;
  if (span <= 0) return value >= threshold ? 1 : 0;
  return clamp01((value - threshold) / span);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
