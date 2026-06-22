// Golden-master test for the Squeeze Momentum [LazyBear] port.
//
// This is the template every PineScript port should copy. It pins the
// indicator's output to a committed fixture so a future edit that changes a
// value fails loudly.
//
// Record / refresh the fixture:
//   UPDATE_GOLDEN=1 npx vitest run squeezeMomentum.golden
//
// IMPORTANT: the committed fixture is currently a `source: 'snapshot'`
// baseline — it locks current behavior but does NOT prove the port matches
// TradingView. To upgrade it to a TRUE golden master, capture the indicator's
// plotted values from TradingView for these exact candles and set
// source: 'tradingview'. See docs/PORTING_PINESCRIPT.md.

import { describe, it, expect } from 'vitest';
import { computeSqueezeMomentum, type SqueezeMomentumConfig } from './squeezeMomentum';
import { makeDeterministicCandles } from '../testing/syntheticCandles';
import {
  compareIndicator,
  loadFixture,
  saveFixture,
  buildSnapshotFixture,
  fixtureExists,
  formatGoldenReport,
} from '../testing/goldenMaster';

const NAME = 'squeezeMomentum';
const PARAMS: SqueezeMomentumConfig = {
  id: NAME,
  bbLength: 20,
  bbMult: 2.0,
  kcLength: 20,
  kcMult: 1.5,
  useTrueRange: true,
};

describe('squeezeMomentum golden master', () => {
  it('matches the committed fixture', () => {
    // Record mode: (re)generate the baseline from the current implementation.
    if (process.env.UPDATE_GOLDEN === '1' || !fixtureExists(NAME)) {
      const candles = makeDeterministicCandles(150, 7);
      const result = computeSqueezeMomentum(candles, PARAMS);
      saveFixture(
        NAME,
        buildSnapshotFixture({
          indicator: NAME,
          params: PARAMS as unknown as Record<string, unknown>,
          candles,
          result,
        }),
      );
    }

    const fixture = loadFixture(NAME);
    const result = computeSqueezeMomentum(
      fixture.candles,
      fixture.params as unknown as SqueezeMomentumConfig,
    );
    const report = compareIndicator(result, fixture);

    expect(report.ok, formatGoldenReport(report)).toBe(true);
    expect(report.checked).toBeGreaterThan(0);
  });
});
