import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import type { CustomIndicatorConfig } from '../indicatorFramework';
import { CUSTOM_INDICATORS } from '../customIndicatorsLibrary';
import { IncrementalIndicatorEngine } from '../incrementalIndicatorEngine';

const makeCandles = (count: number): Candle[] => Array.from({ length: count }, (_, i) => {
  const close = 100 + Math.sin(i / 4) * 3 + i * 0.08;
  return { time: 1_700_000_000 + i * 60, open: close - 0.3, high: close + 0.7, low: close - 0.8, close, volume: 100 + i * 2 };
});

function def(id: string) {
  const value = CUSTOM_INDICATORS.find(item => item.id === id);
  if (!value) throw new Error(`missing indicator ${id}`);
  return value;
}

function expectParity(a: ReturnType<NonNullable<typeof CUSTOM_INDICATORS[number]['compute']>>, b: ReturnType<NonNullable<typeof CUSTOM_INDICATORS[number]['compute']>>) {
  expect(a.plots.length).toBe(b.plots.length);
  a.plots.forEach((plot, plotIndex) => {
    expect(plot.id).toBe(b.plots[plotIndex].id);
    expect(plot.data.length).toBe(b.plots[plotIndex].data.length);
    plot.data.forEach((value, index) => {
      const other = b.plots[plotIndex].data[index];
      if (typeof value === 'number' && typeof other === 'number') expect(value).toBeCloseTo(other, 10);
      else expect(value).toEqual(other);
    });
  });
  expect(a.signals).toEqual(b.signals);
}

describe('incremental indicator parity', () => {
  for (const id of ['sma', 'obv', 'vwap', 'atr']) {
    it(`${id} matches full compute for initialization, forming updates, appends, and rebuild`, () => {
      const indicator = def(id);
      expect(indicator.incremental).toBeDefined();
      const config = { id, settings: undefined };
      const engine = new IncrementalIndicatorEngine({ compute: indicator.compute, incremental: indicator.incremental });
      let history = makeCandles(80);
      expectParity(engine.update(history, { config, identity: `${id}:a` }), indicator.compute(history, config));

      for (let i = 0; i < 5; i += 1) {
        const forming = { ...history.at(-1)!, close: history.at(-1)!.close + i * 0.11, high: history.at(-1)!.high + i * 0.11 };
        const candidate = [...history.slice(0, -1), forming];
        expectParity(engine.update(candidate, { config, identity: `${id}:a` }), indicator.compute(candidate, config));
      }
      history = [...history.slice(0, -1), { ...history.at(-1)!, close: history.at(-1)!.close + 0.44 }];
      const added = { ...makeCandles(1), time: history.at(-1)!.time + 60 } as unknown as Candle;
      added.open = history.at(-1)!.close; added.high = added.open + 1; added.low = added.open - 1; added.close = added.open + 0.2; added.volume = 180;
      history = [...history, added];
      expectParity(engine.update(history, { config, identity: `${id}:a` }), indicator.compute(history, config));

      const prepended = [{ ...history[0], time: history[0].time - 60 }, ...history];
      expectParity(engine.update(prepended, { config, identity: `${id}:a` }), indicator.compute(prepended, config));
    });
  }

  it('keeps recursive ATR/OBV parity over a long sequence without drift', () => {
    for (const id of ['atr', 'obv']) {
      const indicator = def(id);
      const engine = new IncrementalIndicatorEngine({ compute: indicator.compute, incremental: indicator.incremental });
      let history = makeCandles(2500);
      engine.update(history, { config: { id }, identity: `${id}:long` });
      for (let i = 0; i < 40; i += 1) {
        const bar = { ...history.at(-1)!, close: history.at(-1)!.close + Math.sin(i) * 0.03, high: history.at(-1)!.high + 0.02 };
        history = [...history.slice(0, -1), bar];
        expectParity(engine.update(history, { config: { id }, identity: `${id}:long` }), indicator.compute(history, { id }));
        const next = { ...bar, time: bar.time + 60, open: bar.close, high: bar.close + 0.4, low: bar.close - 0.4, close: bar.close + 0.1, volume: bar.volume + 1 };
        history = [...history, next];
        expectParity(engine.update(history, { config: { id }, identity: `${id}:long` }), indicator.compute(history, { id }));
      }
    }
  }, 30_000);

  it('structural settings and replay resets use the authoritative full path', () => {
    const indicator = def('sma');
    const engine = new IncrementalIndicatorEngine({ compute: indicator.compute, incremental: indicator.incremental });
    const history = makeCandles(40);
    const configA = { id: 'sma', settings: { inputs: { length: 9, source: 'close' }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
    const configB = { id: 'sma', settings: { inputs: { length: 20, source: 'close' }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
    expectParity(engine.update(history, { config: configA, identity: 'replay-a' }), indicator.compute(history, configA));
    expectParity(engine.update(history, { config: configB, identity: 'replay-b' }), indicator.compute(history, configB));
    expectParity(engine.update(history.slice(0, 12), { config: configB, identity: 'replay-b' }), indicator.compute(history.slice(0, 12), configB));
  });
});
