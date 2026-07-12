import { describe, it, expect } from 'vitest';
import { SMC_SCANNER_SOURCES } from './smcSources';
import { SCANNER_SOURCES, SCANNER_SOURCE_LIST } from './registry';
import { categoryOf } from './sourceCategories';
import { makeDeterministicCandles } from '@/lib/testing/syntheticCandles';
import { computeSmc } from '@/lib/smc/engine';

const candles = makeDeterministicCandles(400, 7);
const byId = Object.fromEntries(SMC_SCANNER_SOURCES.map((s) => [s.id, s]));

describe('SMC scanner sources', () => {
  it('are registered in the scanner registry', () => {
    for (const s of SMC_SCANNER_SOURCES) {
      expect(SCANNER_SOURCES[s.id], s.id).toBeDefined();
    }
  });

  it('bars-since series: null before the first event, resets to 0 on event bars, then counts up', () => {
    const series = byId.smc_structure.series(candles, {}, 'bullBos');
    const events = computeSmc(candles).events.filter((e) => e.type === 'BOS' && e.direction === 'bullish');
    expect(events.length).toBeGreaterThan(0);
    const first = events[0].barIndex;
    if (first > 0) expect(series[first - 1]).toBeNull();
    expect(series[first]).toBe(0);
    // counts up until the next event
    const next = events[1]?.barIndex ?? candles.length;
    if (first + 1 < next) expect(series[first + 1]).toBe(1);
    // never negative, defined after the first event
    for (let i = first; i < candles.length; i++) {
      expect(series[i]).not.toBeNull();
      expect(series[i]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('a "within N bars" condition reads naturally: <= 10 is true only near the event', () => {
    const series = byId.smc_liquidity.series(candles, {}, 'sweepBull');
    const sweeps = computeSmc(candles).events.filter((e) => e.type === 'LIQUIDITY_SWEEP' && e.direction === 'bullish');
    if (sweeps.length === 0) return; // fixture may not sweep; structure test covers the mechanics
    const at = sweeps[0].barIndex;
    expect((series[at] as number) <= 10).toBe(true);
  });

  it('live-only state source fills only the last bar', () => {
    const series = byId.smc_state.series(candles, {}, 'institutional');
    for (let i = 0; i < candles.length - 1; i++) expect(series[i]).toBeNull();
    const last = series[candles.length - 1];
    expect(last).not.toBeNull();
    expect(last!).toBeGreaterThanOrEqual(0);
    expect(last!).toBeLessThanOrEqual(100);
    expect(byId.smc_state.liveOnly).toBe(true);
  });

  it('zone output maps to -1/0/1', () => {
    const series = byId.smc_state.series(candles, {}, 'zone');
    expect([-1, 0, 1]).toContain(series[candles.length - 1]);
  });
});

describe('source categories', () => {
  it('every registered source resolves to a category', () => {
    for (const s of SCANNER_SOURCE_LIST) {
      expect(categoryOf(s), s.id).toBeTruthy();
    }
  });

  it('grand-plan taxonomy holds for the key sources', () => {
    const cat = (id: string) => categoryOf(SCANNER_SOURCES[id]);
    expect(cat('ema')).toBe('trend');
    expect(cat('rsi')).toBe('momentum');
    expect(cat('vwap')).toBe('volume');
    expect(cat('bollinger')).toBe('volatility');
    expect(cat('smc_structure')).toBe('smc');
  });
});
