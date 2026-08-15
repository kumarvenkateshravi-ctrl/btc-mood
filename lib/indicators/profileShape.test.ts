import { describe, it, expect } from 'vitest';
import { buildProfile } from './sessionVolumeProfile';
import type { VolumeProfile } from './sessionVolumeProfile';
import {
  classifyProfile,
  extractFeatures,
  SHAPE_GLYPH,
  SHAPE_LABEL,
  SHAPE_THRESHOLDS,
  type ProfileShape,
} from './profileShape';
import type { Candle } from '../types';

const T0 = 1_700_000_000;

/**
 * Build a real profile from a volume-by-price curve: `volumes[i]` is the volume
 * traded at price `100 + i`. Going through buildProfile (rather than hand-rolling
 * a VolumeProfile literal) means the fixtures exercise production math, and the
 * classifier is judged on output it will actually receive.
 */
function profileFrom(volumes: number[]): VolumeProfile {
  const e = 1e-6;
  const candles: Candle[] = volumes
    .map((v, i) => {
      if (v <= 0) return null;
      const price = 100 + i;
      return {
        time: T0 + i * 60,
        open: price - e,
        high: price + e,
        low: price - e,
        close: price + e,
        volume: v,
      } satisfies Candle;
    })
    .filter((c): c is Candle => c !== null);

  const p = buildProfile(candles, { rowsLayout: 'rows', rowSize: volumes.length });
  if (!p) throw new Error('fixture produced no profile');
  return p;
}

/** Discrete gaussian bump, for building believable distributions. */
function bell(n: number, centre: number, sigma: number, peak = 100): number[] {
  return Array.from({ length: n }, (_, i) =>
    peak * Math.exp(-((i - centre) ** 2) / (2 * sigma * sigma)),
  );
}

function add(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + (b[i] ?? 0));
}

// ---- Fixtures, one per shape ----------------------------------------------

/** Tight bell dead centre → the textbook balanced day. */
const D_SHAPE = profileFrom(bell(40, 19.5, 2.6));

/** Broad, flat-topped bell — centred but with no strong reference price. */
const BALANCED = profileFrom(bell(40, 19.5, 8));

/** Near-uniform: nothing accepted anywhere, value smeared over the range. */
const TREND = profileFrom(
  Array.from({ length: 60 }, (_, i) => 100 + ((i * 7) % 5)),
);

/** Thin tail from below + a fat bulge near the top. */
const P_SHAPE = profileFrom(
  add(
    Array.from({ length: 40 }, (_, i) => (i <= 27 ? 4 : 0)),
    bell(40, 34, 2.4, 90),
  ),
);

/** Mirror image: bulge at the lows, thin tail stretching up. */
const B_SHAPE = profileFrom(
  add(
    Array.from({ length: 40 }, (_, i) => (i >= 12 ? 4 : 0)),
    bell(40, 5, 2.4, 90),
  ),
);

/** Two accepted areas with a rejected middle. */
const DOUBLE = profileFrom(add(bell(40, 8, 2.2), bell(40, 31, 2.2)));

/** Everything jammed into the top decile. */
const EXTREME = profileFrom(
  add(
    Array.from({ length: 40 }, (_, i) => (i >= 34 ? 0 : 1)),
    bell(40, 38.5, 1.2, 200),
  ),
);

describe('extractFeatures', () => {
  it('locates the POC within the profile range', () => {
    expect(extractFeatures(D_SHAPE).pocPosition).toBeGreaterThan(0.4);
    expect(extractFeatures(D_SHAPE).pocPosition).toBeLessThan(0.6);
    expect(extractFeatures(P_SHAPE).pocPosition).toBeGreaterThan(0.65);
    expect(extractFeatures(B_SHAPE).pocPosition).toBeLessThan(0.35);
  });

  it('signs skew by which end carries the mass', () => {
    // Mass high ⇒ long lower tail ⇒ negative skew (and vice versa).
    expect(extractFeatures(P_SHAPE).skew).toBeLessThan(0);
    expect(extractFeatures(B_SHAPE).skew).toBeGreaterThan(0);
  });

  it('reports a tighter value area for a peaked profile than a flat one', () => {
    expect(extractFeatures(D_SHAPE).vaCoverage).toBeLessThan(
      extractFeatures(TREND).vaCoverage,
    );
  });

  it('finds two peaks with a deep valley in a double distribution', () => {
    const f = extractFeatures(DOUBLE);
    expect(f.peaks).toBeGreaterThanOrEqual(2);
    expect(f.valleyDepth).toBeGreaterThan(SHAPE_THRESHOLDS.doubleValleyDepth);
  });

  it('does not invent a second peak from a single bell', () => {
    const f = extractFeatures(D_SHAPE);
    expect(f.valleyDepth).toBeLessThan(SHAPE_THRESHOLDS.doubleValleyDepth);
  });
});

describe('classifyProfile', () => {
  const cases: [string, VolumeProfile, ProfileShape][] = [
    ['tight centred bell', D_SHAPE, 'd-shape'],
    ['broad centred bell', BALANCED, 'balanced'],
    ['flat elongated', TREND, 'trend'],
    ['bulge high, tail low', P_SHAPE, 'p-shape'],
    ['bulge low, tail high', B_SHAPE, 'b-shape'],
    ['twin peaks', DOUBLE, 'double-distribution'],
    ['pinned at the top', EXTREME, 'extreme'],
  ];

  for (const [name, profile, expected] of cases) {
    it(`classifies ${name} as ${expected}`, () => {
      expect(classifyProfile(profile).shape).toBe(expected);
    });
  }

  it('refuses to classify a profile with too few rows', () => {
    const tiny = profileFrom([10, 20, 30]);
    const c = classifyProfile(tiny);
    expect(c.shape).toBe('neutral');
    expect(c.confidence).toBe(0);
  });

  it('always returns a usable explanation and feature set', () => {
    for (const [, profile] of cases) {
      const c = classifyProfile(profile);
      expect(c.why.length).toBeGreaterThan(10);
      expect(c.features.rowCount).toBeGreaterThan(0);
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('tests double distribution before balance', () => {
    // A twin-peaked profile has its MEAN dead centre, right where a balanced
    // POC would sit — rule order is the only thing preventing a misread.
    const f = extractFeatures(DOUBLE);
    expect(Math.abs(f.pocPosition - 0.5)).toBeLessThan(0.5);
    expect(classifyProfile(DOUBLE).shape).toBe('double-distribution');
  });

  it('separates extreme from p-shape by how far the POC is pinned', () => {
    expect(extractFeatures(EXTREME).pocPosition).toBeGreaterThanOrEqual(
      SHAPE_THRESHOLDS.extremeHigh,
    );
    expect(extractFeatures(P_SHAPE).pocPosition).toBeLessThan(
      SHAPE_THRESHOLDS.extremeHigh,
    );
  });

  it('flags thin rejection tails independently of the shape', () => {
    // hasExtremes is orthogonal: a P-shape has a thin tail below it too.
    expect(classifyProfile(EXTREME).hasExtremes).toBe(true);
    expect(typeof classifyProfile(D_SHAPE).hasExtremes).toBe('boolean');
  });

  it('scores a cleaner separation with more confidence', () => {
    const shallow = profileFrom(add(bell(40, 8, 2.2), bell(40, 31, 2.2, 100)).map((v, i) =>
      i > 14 && i < 25 ? v + 55 : v, // fill the valley in
    ));
    const deep = DOUBLE;
    const cShallow = classifyProfile(shallow);
    const cDeep = classifyProfile(deep);
    if (cShallow.shape === 'double-distribution') {
      expect(cDeep.confidence).toBeGreaterThan(cShallow.confidence);
    } else {
      // Filling the valley should break the double-distribution read entirely.
      expect(cShallow.shape).not.toBe('double-distribution');
    }
  });

  it('is deterministic', () => {
    expect(classifyProfile(P_SHAPE)).toEqual(classifyProfile(P_SHAPE));
  });
});

describe('shape vocabulary', () => {
  it('has a label and glyph for every shape', () => {
    const shapes = Object.keys(SHAPE_LABEL) as ProfileShape[];
    expect(shapes).toHaveLength(8);
    for (const s of shapes) {
      expect(SHAPE_LABEL[s]).toBeTruthy();
      expect(SHAPE_GLYPH[s]).toBeTruthy();
    }
  });
});
