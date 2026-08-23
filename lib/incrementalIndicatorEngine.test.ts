import { describe, expect, it } from 'vitest';
import type { Candle } from './types';
import type { IndicatorResult } from './indicatorFramework';
import { IncrementalIndicatorEngine, type IncrementalIndicatorFactory } from './incrementalIndicatorEngine';

const candles = (count: number, offset = 0): Candle[] => Array.from({ length: count }, (_, i) => {
  const close = 100 + offset + i * 0.7 + Math.sin(i / 3);
  return {
    time: 1_700_000_000 + (offset + i) * 60,
    open: close - 0.4,
    high: close + 0.8,
    low: close - 0.9,
    close,
    volume: 10 + i,
  };
});

const resultFor = (history: Candle[]): IndicatorResult => ({
  plots: [{ id: 'close', title: 'Close', color: '#fff', type: 'line', data: history.map(c => c.close) }],
  signals: history.map(() => 'neutral'),
});

const testFactory: IncrementalIndicatorFactory = ({ compute }) => {
  let history: Candle[] = [];
  const rebuild = (next: Candle[]) => {
    history = next.slice();
    return compute(history);
  };
  return {
    initialize: rebuild,
    rebuild,
    updateLast: (bar) => rebuild([...history.slice(0, -1), bar]),
    append: (bar) => rebuild([...history, bar]),
  };
};

describe('IncrementalIndicatorEngine', () => {
  it('uses initialize, updateLast, append, and rebuild for the matching history shape', () => {
    const calls: string[] = [];
    const factory: IncrementalIndicatorFactory = ({ compute }) => {
      let history: Candle[] = [];
      const make = (name: string, next: Candle[]) => {
        calls.push(name);
        history = next.slice();
        return compute(history);
      };
      return {
        initialize: next => make('initialize', next),
        updateLast: bar => make('updateLast', [...history.slice(0, -1), bar]),
        append: bar => make('append', [...history, bar]),
        rebuild: next => make('rebuild', next),
      };
    };
    const engine = new IncrementalIndicatorEngine({ compute: resultFor, incremental: factory });
    const initial = candles(5);
    engine.update(initial);
    engine.update([...initial.slice(0, -1), { ...initial[4], close: 111 }]);
    const closed = { ...initial[4], close: 111 };
    engine.update([...initial.slice(0, -1), closed, candles(1, 5)[0]]);
    engine.update([...initial.slice(0, -1), closed, candles(1, 5)[0], candles(1, 6)[0]]);
    engine.update(candles(7, -2));
    expect(calls).toEqual(['initialize', 'updateLast', 'append', 'append', 'rebuild']);
  });

  it('rebuilds on settings/source identity changes and on replay rewinds', () => {
    const calls: string[] = [];
    const factory: IncrementalIndicatorFactory = ({ compute }) => {
      let history: Candle[] = [];
      const make = (name: string, next: Candle[]) => {
        calls.push(name);
        history = next.slice();
        return compute(history);
      };
      return {
        initialize: next => make('initialize', next),
        updateLast: bar => make('updateLast', [...history.slice(0, -1), bar]),
        append: bar => make('append', [...history, bar]),
        rebuild: next => make('rebuild', next),
      };
    };
    const engine = new IncrementalIndicatorEngine({ compute: resultFor, incremental: factory });
    const history = candles(4);
    engine.update(history, { identity: 'settings-a' });
    engine.update(history, { identity: 'settings-b' });
    engine.update(history.slice(0, 2), { identity: 'settings-b' });
    expect(calls).toEqual(['initialize', 'initialize', 'rebuild']);
  });

  it('keeps the full compute function as the authoritative fallback', () => {
    let fullCalls = 0;
    const compute = (history: Candle[]) => {
      fullCalls += 1;
      return resultFor(history);
    };
    const engine = new IncrementalIndicatorEngine({ compute });
    expect(engine.update(candles(3)).plots[0].data).toHaveLength(3);
    expect(fullCalls).toBe(1);
  });
});

describe('incremental parity fixtures', () => {
  it('preserves the same output as a full rebuild across forming and closed updates', () => {
    const full = (history: Candle[]) => resultFor(history);
    const engine = new IncrementalIndicatorEngine({ compute: full, incremental: testFactory });
    let history = candles(20);
    engine.update(history);
    for (let i = 0; i < 4; i += 1) {
      const forming = { ...history.at(-1)!, close: history.at(-1)!.close + i * 0.2 };
      const incremental = engine.update([...history.slice(0, -1), forming]);
      expect(incremental).toEqual(full([...history.slice(0, -1), forming]));
    }
    history = [...history, candles(1, 20)[0]];
    expect(engine.update(history)).toEqual(full(history));
  });
});
