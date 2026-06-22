// One-call golden test for a library-backed or ported indicator. Keeps each
// indicator's *.golden.test.ts to a few lines. See
// lib/indicators/squeezeMomentum.golden.test.ts for the explicit long form and
// docs/PORTING_PINESCRIPT.md for the workflow.
//
// Record / refresh the fixture: UPDATE_GOLDEN=1 npx vitest run <name>.golden

import { it, expect } from 'vitest';
import type { Candle } from '../types';
import type { IndicatorResult, CustomIndicatorConfig } from '../indicatorFramework';
import { makeDeterministicCandles } from './syntheticCandles';
import {
  compareIndicator,
  loadFixture,
  saveFixture,
  buildSnapshotFixture,
  fixtureExists,
  formatGoldenReport,
} from './goldenMaster';

export interface GoldenTestOptions {
  name: string;
  compute: (candles: Candle[], config?: CustomIndicatorConfig) => IndicatorResult;
  params: Record<string, unknown>;
  candleCount?: number;
  seed?: number;
}

export function defineGoldenTest(opts: GoldenTestOptions): void {
  it(`${opts.name} matches the committed golden fixture`, () => {
    const cfg = opts.params as unknown as CustomIndicatorConfig;

    if (process.env.UPDATE_GOLDEN === '1' || !fixtureExists(opts.name)) {
      const candles = makeDeterministicCandles(opts.candleCount ?? 150, opts.seed ?? 7);
      saveFixture(
        opts.name,
        buildSnapshotFixture({
          indicator: opts.name,
          params: opts.params,
          candles,
          result: opts.compute(candles, cfg),
        }),
      );
    }

    const fixture = loadFixture(opts.name);
    const result = opts.compute(
      fixture.candles,
      fixture.params as unknown as CustomIndicatorConfig,
    );
    const report = compareIndicator(result, fixture);

    expect(report.ok, formatGoldenReport(report)).toBe(true);
    expect(report.checked).toBeGreaterThan(0);
  });
}
