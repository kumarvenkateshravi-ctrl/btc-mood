import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { createDefaultRegistry } from './registry';
import {
  computeCategoryIntelligence, CATEGORY_CONTRIBUTORS, CATEGORY_SCHEMA_VERSION,
} from './categoryEngine';
import type { CategoryId } from './categoryTypes';

const series = (n: number, base: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return { time: i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 80 };
  });

const ALL: CategoryId[] = ['trend', 'momentum', 'volume', 'volatility', 'quality', 'participation'];
const engineFor = (c: Candle[]) => computeCategoryIntelligence(createDefaultRegistry().evaluate(c));

describe('computeCategoryIntelligence', () => {
  it('real M1 pipeline → all six categories, well-formed and traceable', () => {
    const res = engineFor(series(260, 100, 0.5));
    expect(res.schemaVersion).toBe(1);
    for (const id of ALL) {
      const cat = res.categories[id];
      expect(cat.id).toBe(id);
      expect(cat.contributors).toEqual(CATEGORY_CONTRIBUTORS[id]);
      expect(cat.score).toBeGreaterThanOrEqual(0);
      expect(cat.score).toBeLessThanOrEqual(100);
      expect(cat.confidence).toBeGreaterThanOrEqual(0);
      expect(cat.confidence).toBeLessThanOrEqual(100);
      expect(typeof cat.state).toBe('string');
      for (const s of [...cat.signals, ...cat.warnings]) {
        expect(s.category).toBe(id);
        expect(s.source.length).toBeGreaterThan(0);
      }
    }
  });

  it('non-directional categories keep score 50', () => {
    const res = engineFor(series(260, 100, 0.5));
    expect(res.categories.volatility.score).toBe(50);
    expect(res.categories.quality.score).toBe(50);
  });

  it('empty candles → every category hits the no-evidence invariant', () => {
    const res = engineFor([]);
    for (const id of ALL) {
      const cat = res.categories[id];
      expect(cat.confidence).toBe(50);
      expect(cat.strength).toBe(0);
      expect(cat.signals).toEqual([]);
      expect(cat.warnings).toEqual([]);
    }
  });

  it('is deterministic', () => {
    const c = series(120, 200, -0.5);
    expect(engineFor(c)).toEqual(engineFor(c));
  });

  it('schema version constant', () => {
    expect(CATEGORY_SCHEMA_VERSION).toBe(1);
  });
});
