// Golden-master regression gate for the composite Pine port.
//
// The committed fixture starts as a snapshot so the TypeScript wiring has a
// deterministic guard. Replace its source with `tradingview` after capturing
// the same OHLC/settings in TradingView, as required by docs/PORTING_PINESCRIPT.md.

import { describe, expect, it } from 'vitest';
import { computeRegressionGChannel } from './regressionGChannel';
import { makeDeterministicCandles } from '../testing/syntheticCandles';
import {
  buildSnapshotFixture,
  compareIndicator,
  fixtureExists,
  formatGoldenReport,
  loadFixture,
  saveFixture,
} from '../testing/goldenMaster';

const NAME = 'regressionGChannel';
const PARAMS = {
  id: 'regression_gchannel',
  source: 'close',
  filtType: 'SMA',
  windowType: 'Continuous',
  length: 200,
  interval: 'D',
  extendLines: false,
  showLine: true,
  lineWidth: 4,
  lineStyle: 'Solid',
  showTracer: true,
  gcShow: true,
  gcLength: 100,
  gcSource: 'close',
  gcShowCross: true,
  showFibLevels: true,
  showFibBands: true,
  fibLength: 265,
  fibOpacity: 92,
  dcLength: 40,
  showZoneFill: true,
  useAtrBuffer: true,
  atrLength: 14,
  atrMultiplier: 0.25,
  maLength: 20,
  maType: 'EMA',
  dispHigh: 5,
  dispLow: -5,
};

describe('regressionGChannel golden master', () => {
  it('matches the committed fixture', () => {
    if (process.env.UPDATE_GOLDEN === '1' || !fixtureExists(NAME)) {
      const candles = makeDeterministicCandles(320, 19);
      const result = computeRegressionGChannel(candles, { id: 'regression_gchannel', settings: { inputs: PARAMS, styles: {}, visibility: {} } });
      saveFixture(NAME, buildSnapshotFixture({
        indicator: NAME,
        params: PARAMS,
        candles,
        result,
        lastN: 60,
        note: 'SNAPSHOT baseline only. Upgrade to TradingView-captured values before treating this as source correctness.',
      }));
    }

    const fixture = loadFixture(NAME);
    const result = computeRegressionGChannel(fixture.candles, { id: 'regression_gchannel', settings: { inputs: fixture.params, styles: {}, visibility: {} } });
    const report = compareIndicator(result, fixture);
    expect(report.ok, formatGoldenReport(report)).toBe(true);
    expect(report.checked).toBeGreaterThan(0);
  });
});
