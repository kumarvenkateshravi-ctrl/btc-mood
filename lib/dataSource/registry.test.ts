// Tests for the data-source registry. The registry is the foundation
// for any new exchange / asset class — these tests pin down the
// contract so future sources can rely on it.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetDataSourceRegistry,
  registerDataSource,
  getDataSource,
  hasDataSource,
  listDataSources,
  listDataSourceMetas,
  defaultDataSource,
  setDefaultDataSourceId,
} from './registry';
import type { DataSource } from './types';
import type { Candle, Timeframe } from '../types';

function makeStubSource(id: string, exchange: string): DataSource {
  return {
    meta: {
      id,
      label: id,
      exchange,
      kind: 'crypto',
      suggestedSymbols: [{ symbol: `${id}-USDT`, label: `${id} / USDT` }],
    },
    fetchHistory: async (): Promise<Candle[]> => [],
    subscribe: (): (() => void) => () => {},
    supportsTimeframe: (tf: Timeframe) => tf === '1m',
  };
}

describe('dataSource registry', () => {
  beforeEach(() => {
    __resetDataSourceRegistry();
  });

  it('register then get returns the same instance', () => {
    const src = makeStubSource('test', 'test-exchange');
    registerDataSource(src);
    expect(getDataSource('test')).toBe(src);
  });

  it('getDataSource on unknown id throws with a helpful message', () => {
    expect(() => getDataSource('nope')).toThrow(/Unknown data source: nope/);
  });

  it('listDataSources returns every registered source', () => {
    const a = makeStubSource('alpha', 'a');
    const b = makeStubSource('bravo', 'b');
    registerDataSource(a);
    registerDataSource(b);
    const all = listDataSources();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.meta.id).sort()).toEqual(['alpha', 'bravo']);
  });

  it('listDataSourceMetas returns the meta slice', () => {
    registerDataSource(makeStubSource('x', 'xchange'));
    const metas = listDataSourceMetas();
    expect(metas).toHaveLength(1);
    expect(metas[0].exchange).toBe('xchange');
  });

  it('hasDataSource distinguishes registered from not', () => {
    registerDataSource(makeStubSource('known', 'k'));
    expect(hasDataSource('known')).toBe(true);
    expect(hasDataSource('unknown')).toBe(false);
  });

  it('re-registering the same id replaces, never duplicates', () => {
    const first = makeStubSource('dup', 'first');
    const second = makeStubSource('dup', 'second');
    registerDataSource(first);
    registerDataSource(second);
    expect(listDataSources()).toHaveLength(1);
    expect(getDataSource('dup')).toBe(second);
    expect(getDataSource('dup').meta.exchange).toBe('second');
  });

  it('defaultDataSource returns the source registered with the default id', () => {
    registerDataSource(makeStubSource('a', 'a'));
    registerDataSource(makeStubSource('b', 'b'));
    setDefaultDataSourceId('b');
    expect(defaultDataSource().meta.id).toBe('b');
  });

  it('defaultDataSource throws when no sources are registered', () => {
    expect(() => defaultDataSource()).toThrow(/No data sources registered/);
  });
});
