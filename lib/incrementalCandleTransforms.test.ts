import { describe, expect, it } from 'vitest';
import { IncrementalHeikinAshi, IncrementalRenko } from './incrementalCandleTransforms';
import { toHeikinAshi } from './heikinAshi';
import { toRenko, type RenkoOptions } from './renko';
import type { Candle } from './types';

function candle(time: number, close: number): Candle {
  return {
    time,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  };
}

function history(closes: number[]): Candle[] {
  return closes.map((close, index) => candle(1_700_000_000 + index * 60, close));
}

function expectHeikinParity(transform: IncrementalHeikinAshi, candles: Candle[]) {
  expect(transform.update(candles)).toEqual(toHeikinAshi(candles));
}

function expectRenkoParity(transform: IncrementalRenko, candles: Candle[], options: RenkoOptions) {
  expect(transform.update(candles, options)).toEqual(toRenko(candles, options));
}

describe('IncrementalHeikinAshi', () => {
  it('matches the authoritative transform for forming updates, appends, and structural rebuilds', () => {
    const transform = new IncrementalHeikinAshi();
    const initial = history([100, 103, 101, 105]);
    expectHeikinParity(transform, initial);
    expect(transform.stats().lastOperation).toBe('initialize');

    const forming = [...initial.slice(0, -1), { ...initial.at(-1)!, close: 108, high: 109 }];
    expectHeikinParity(transform, forming);
    expect(transform.stats().lastOperation).toBe('updateLast');

    const formingAgain = [...forming.slice(0, -1), { ...forming.at(-1)!, close: 106, low: 99 }];
    expectHeikinParity(transform, formingAgain);
    expect(transform.stats().lastOperation).toBe('updateLast');

    const appended = [...formingAgain, candle(formingAgain.at(-1)!.time + 60, 111)];
    expectHeikinParity(transform, appended);
    expect(transform.stats().lastOperation).toBe('append');

    const multipleAppends = [...appended, candle(appended.at(-1)!.time + 60, 107)];
    expectHeikinParity(transform, multipleAppends);

    const prepended = [candle(initial[0].time - 60, 97), ...multipleAppends];
    expectHeikinParity(transform, prepended);
    expect(transform.stats().lastOperation).toBe('rebuild');

    const replayStep = prepended.slice(0, 4);
    expectHeikinParity(transform, replayStep);
    expect(transform.stats().lastOperation).toBe('rebuild');

    const replayRewind = prepended.slice(0, 2);
    expectHeikinParity(transform, replayRewind);
    expect(transform.stats().lastOperation).toBe('rebuild');
  });
});

describe('IncrementalRenko', () => {
  const fixed: RenkoOptions = { method: 'traditional', brickSize: 5 };

  it('matches fixed/traditional Renko for continuations, reversals, multiple bricks, and forming updates', () => {
    const transform = new IncrementalRenko();
    const initial = history([100, 110, 95]);
    expectRenkoParity(transform, initial, fixed);
    expect(transform.stats().lastOperation).toBe('initialize');

    const forming = [...initial.slice(0, -1), { ...initial.at(-1)!, close: 90, low: 89 }];
    expectRenkoParity(transform, forming, fixed);
    expect(transform.stats().lastOperation).toBe('updateLast');

    const formingAgain = [...forming.slice(0, -1), { ...forming.at(-1)!, close: 108, high: 109 }];
    expectRenkoParity(transform, formingAgain, fixed);
    expect(transform.stats().lastOperation).toBe('updateLast');

    const appended = [...formingAgain, candle(formingAgain.at(-1)!.time + 60, 140)];
    expectRenkoParity(transform, appended, fixed);
    expect(transform.stats().lastOperation).toBe('append');

    const prepended = [candle(initial[0].time - 60, 95), ...appended];
    expectRenkoParity(transform, prepended, fixed);
    expect(transform.stats().lastOperation).toBe('rebuild');

    expectRenkoParity(transform, prepended.slice(0, 3), fixed);
    expect(transform.stats().lastOperation).toBe('rebuild');
  });

  it('keeps ATR and percentage modes on the authoritative full-rebuild path', () => {
    const candles = history([100, 102, 98, 110, 104, 113, 101, 118, 107, 121, 109, 125, 112, 130, 115]);
    for (const options of [
      { method: 'atr', atrLength: 5 } as RenkoOptions,
      { method: 'percentage', percentage: 2 } as RenkoOptions,
    ]) {
      const transform = new IncrementalRenko();
      expectRenkoParity(transform, candles, options);
      expectRenkoParity(transform, [...candles.slice(0, -1), { ...candles.at(-1)!, close: 132 }], options);
      expect(transform.stats().lastOperation).toBe('rebuild');
    }
  });

  it('falls back to a full rebuild for malformed source histories and option changes', () => {
    const transform = new IncrementalRenko();
    const candles = history([100, 105, 110]);
    expectRenkoParity(transform, candles, fixed);
    const malformed = [...candles, { ...candle(candles.at(-1)!.time + 60, 112), close: Number.NaN }];
    expectRenkoParity(transform, malformed, fixed);
    expect(transform.stats().lastOperation).toBe('rebuild');
    expectRenkoParity(transform, candles, { method: 'traditional', brickSize: 2 });
    expect(transform.stats().lastOperation).toBe('rebuild');
  });
});
