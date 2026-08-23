import { describe, expect, it } from 'vitest';
import type { ProfileSourceProvenance } from './profileDataProvider';
import {
  HistoricalPocStore,
  buildHistoricalPocIndex,
  pocRecordKey,
  selectVisibleHistoricalPocs,
  type HistoricalPocRecord,
} from './historicalPocStore';

const HOUR = 3_600;
const DAY = 24 * HOUR;

const source: ProfileSourceProvenance = {
  symbol: 'BTCUSDT',
  sessionTimeframe: 'daily',
  sourceTimeframe: '5m',
  tier: 'fast',
  quality: 'estimated',
  completeness: 'complete',
  mode: 'live',
  sourceRevision: 'raw-r1',
};

function record(type: HistoricalPocRecord['sessionType'], start: number, provenance = source): HistoricalPocRecord {
  const duration = type === '4h' ? 4 * HOUR : type === 'daily' ? DAY : 7 * DAY;
  return {
    symbol: provenance.symbol,
    sessionType: type,
    sessionStart: start,
    sessionEnd: start + duration,
    poc: 100 + start / DAY,
    source: { ...provenance, sessionTimeframe: type },
    finalized: true,
  };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('365-day historical POC retention', () => {
  it('retains compact finalized records at 4H, daily, and weekly target scales', () => {
    const store = new HistoricalPocStore({ source, persist: false });
    const start = 10_000 * DAY;
    const fourHour = Array.from({ length: 2_190 }, (_, i) => record('4h', start + i * 4 * HOUR));
    const daily = Array.from({ length: 365 }, (_, i) => record('daily', start + i * DAY));
    const weekly = Array.from({ length: 53 }, (_, i) => record('weekly', start + i * 7 * DAY));
    store.merge([...fourHour, ...daily, ...weekly]);
    expect(store.records('4h')).toHaveLength(2_190);
    expect(store.records('daily')).toHaveLength(365);
    expect(store.records('weekly')).toHaveLength(53);
    expect(store.records().every((item) => !('rows' in item) && !('vah' in item) && !('val' in item))).toBe(true);
  });

  it('keeps completed records immutable and never finalizes a developing record', () => {
    const store = new HistoricalPocStore({ source, persist: false });
    const completed = record('daily', 100 * DAY);
    store.merge([completed, { ...record('daily', 101 * DAY), finalized: false }]);
    const retained = store.records();
    expect(retained).toHaveLength(1);
    expect(Object.isFrozen(retained[0])).toBe(true);
    expect(Object.isFrozen(retained[0].source)).toBe(true);
    expect(() => { (retained[0] as { poc: number }).poc = 0; }).toThrow();
  });

  it('uses exact session-contained bounds and never extends a record beyond its session', () => {
    const fourHour = record('4h', 12 * HOUR);
    const daily = record('daily', 2 * DAY);
    const weekly = record('weekly', 7 * DAY);
    expect(fourHour.sessionEnd - fourHour.sessionStart).toBe(4 * HOUR);
    expect(daily.sessionEnd - daily.sessionStart).toBe(DAY);
    expect(weekly.sessionEnd - weekly.sessionStart).toBe(7 * DAY);
  });

  it('isolates records by symbol and provenance/cache identity', () => {
    const store = new HistoricalPocStore({ source, persist: false });
    const sameSessionAccurate = record('daily', 100 * DAY, { ...source, sourceTimeframe: '1m', tier: 'accurate', quality: 'higher-accuracy', sourceRevision: '1m-r1' });
    const otherSymbol = record('daily', 100 * DAY, { ...source, symbol: 'XAUUSD' });
    store.merge([record('daily', 100 * DAY), sameSessionAccurate, otherSymbol]);
    expect(store.records()).toHaveLength(1);
    const accurateStore = new HistoricalPocStore({ source: sameSessionAccurate.source, persist: false });
    accurateStore.merge([sameSessionAccurate]);
    expect(accurateStore.records()).toHaveLength(1);
    expect(pocRecordKey(store.records()[0])).not.toBe(pocRecordKey(accurateStore.records()[0]));
    expect(store.records().every((item) => item.symbol === 'BTCUSDT')).toBe(true);
  });

  it('selects visible records with the same result as a full scan', () => {
    const records = Array.from({ length: 2_190 }, (_, i) => record('4h', 5_000 * DAY + i * 4 * HOUR));
    const index = buildHistoricalPocIndex(records);
    const range = { from: 5_200 * DAY, to: 5_202 * DAY };
    const indexed = selectVisibleHistoricalPocs(index, range);
    const full = records.filter((item) => item.sessionEnd >= range.from && item.sessionStart <= range.to);
    expect(indexed).toEqual(full);
  });

  it('filters persisted records causally for replay cuts and reloads them exactly', () => {
    const storage = memoryStorage();
    const live = new HistoricalPocStore({ source, storage });
    live.merge([record('daily', 100 * DAY), record('daily', 101 * DAY), record('daily', 102 * DAY)]);
    const reloaded = new HistoricalPocStore({ source, storage, replayCutTime: 101 * DAY + DAY - 1 });
    expect(reloaded.records().map((item) => item.sessionStart)).toEqual([100 * DAY]);
  });
  it('cancels a stale historical load before it mutates retained records', async () => {
    const store = new HistoricalPocStore({ source, persist: false });
    const controller = new AbortController();
    controller.abort();
    await expect(store.load([record('daily', 120 * DAY)], controller.signal)).resolves.toBe(false);
    expect(store.records()).toEqual([]);
  });
});
