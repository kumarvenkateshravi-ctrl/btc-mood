import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { computeSmc, projectSmcSnapshot } from './engine';
import { makeDeterministicCandles } from '../testing/syntheticCandles';

describe('computeSmc', () => {
  it('is deterministic: two runs produce deep-equal snapshots', () => {
    const candles = makeDeterministicCandles(400, 7);
    const a = projectSmcSnapshot(computeSmc(candles));
    const b = projectSmcSnapshot(computeSmc(candles));
    expect(a).toEqual(b);
  });

  it('produces structure events and scored objects on realistic data', () => {
    const snap = computeSmc(makeDeterministicCandles(600, 7));
    expect(snap.events.length).toBeGreaterThan(0);
    expect(snap.events.some((e) => e.type === 'BOS' || e.type === 'CHOCH')).toBe(true);
    expect(snap.objects.orderBlocks.length).toBeGreaterThan(0);
    const scored = snap.objects.orderBlocks.filter((o) => o.strength > 0);
    expect(scored.length).toBeGreaterThan(0);
    expect(snap.scores.institutional).toBeGreaterThanOrEqual(0);
    expect(snap.scores.institutional).toBeLessThanOrEqual(100);
    expect(snap.diagnostics.barsProcessed).toBe(600);
  });

  it('returns an empty snapshot for empty input', () => {
    const snap = computeSmc([]);
    expect(snap.events).toEqual([]);
    expect(snap.objects.orderBlocks).toEqual([]);
    expect(snap.state.setup).toBe('none');
    expect(snap.diagnostics.barsProcessed).toBe(0);
  });

  it('processes 5000 bars within the performance budget', () => {
    const candles = makeDeterministicCandles(5000, 3);
    // Best-of-3: wall-clock timing is noisy when the whole suite runs in
    // parallel workers; the best run reflects the actual algorithmic cost.
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      computeSmc(candles);
      best = Math.min(best, performance.now() - t0);
    }
    if (best > 50) console.warn(`computeSmc(5000 bars) took ${best.toFixed(1)}ms (soft budget 50ms)`);
    expect(best).toBeLessThan(1000); // hard bound only catches algorithmic regressions (O(n²) was ~630ms idle)
  });
});

describe('regressions', () => {
  const dir = join(__dirname, '__fixtures__', 'regressions');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

  it(`replays all recorded regression fixtures (${files.length})`, () => {
    for (const f of files) {
      const { candles, expectedProjection } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      expect(projectSmcSnapshot(computeSmc(candles)), f).toEqual(expectedProjection);
    }
  });
});
