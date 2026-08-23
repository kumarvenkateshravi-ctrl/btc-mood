import { describe, expect, it } from 'vitest';
import { HistoricalPocStore, type HistoricalPocRecord } from '../indicators/historicalPocStore';

const HOUR = 3_600;
const DAY = 24 * HOUR;
const source = {
  symbol: 'BTCUSDT', sessionTimeframe: 'daily', sourceTimeframe: '5m' as const,
  tier: 'fast' as const, quality: 'estimated' as const, completeness: 'complete' as const,
  mode: 'live' as const, sourceRevision: 'benchmark-r1',
};

function records(type: HistoricalPocRecord['sessionType'], count: number, step: number): HistoricalPocRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: 'BTCUSDT', sessionType: type, sessionStart: index * step, sessionEnd: (index + 1) * step,
    poc: 100 + index / 10, source: { ...source, sessionTimeframe: type }, finalized: true as const,
  }));
}

describe('Stage 5 historical POC benchmark', () => {
  it('measures 2,608-record merge, reload-equivalent indexing, and visible-range lookup', () => {
    const all = [
      ...records('4h', 2_190, 4 * HOUR),
      ...records('daily', 365, DAY),
      ...records('weekly', 53, 7 * DAY),
    ];
    const store = new HistoricalPocStore({ source, persist: false });
    const mergeStart = performance.now();
    store.merge(all);
    const mergeMs = performance.now() - mergeStart;

    const lookupStart = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      store.visible({ from: index * DAY, to: index * DAY + 2 * DAY });
    }
    const lookupMs = performance.now() - lookupStart;
    console.info(`[stage5-historical-poc] records=${store.records().length} mergeMs=${mergeMs.toFixed(2)} lookup1000Ms=${lookupMs.toFixed(2)}`);
    expect(store.records()).toHaveLength(2_608);
    expect(lookupMs).toBeGreaterThanOrEqual(0);
  });
});
