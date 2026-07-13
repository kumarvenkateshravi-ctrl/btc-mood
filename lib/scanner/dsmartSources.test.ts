import { describe, it, expect } from 'vitest';
import { DSMART_SCANNER_SOURCES } from './dsmartSources';
import { SCANNER_SOURCES } from './registry';
import { categoryOf } from './sourceCategories';
import { parseCondition } from './dsl';
import { computeDsmart } from '@/lib/indicators/dsmartLine';
import { makeDeterministicCandles } from '@/lib/testing/syntheticCandles';

const candles = makeDeterministicCandles(400, 7);
const byId = Object.fromEntries(DSMART_SCANNER_SOURCES.map((s) => [s.id, s]));

describe('D Smart scanner sources', () => {
  it('are registered and categorized as trend', () => {
    for (const s of DSMART_SCANNER_SOURCES) {
      expect(SCANNER_SOURCES[s.id], s.id).toBeDefined();
      expect(categoryOf(s)).toBe('trend');
    }
  });

  it('bars-since pullback series resets at each P event', () => {
    const events = computeDsmart(candles).events.filter((e) => e.type === 'pullback' && e.direction === 'bullish');
    const series = byId.dsmart_signal.series(candles, {}, 'pullbackBull');
    expect(events.length).toBeGreaterThan(0);
    const first = events[0].barIndex;
    if (first > 0) expect(series[first - 1]).toBeNull();
    expect(series[first]).toBe(0);
  });

  it('state series are full-history per-bar values (not live-only)', () => {
    expect(byId.dsmart_state.liveOnly).toBeUndefined();
    const regime = byId.dsmart_state.series(candles, {}, 'regime');
    const defined = regime.filter((v) => v != null);
    expect(defined.length).toBeGreaterThan(candles.length / 2);
    for (const v of defined) expect([-1, 1]).toContain(v);
    const inCloud = byId.dsmart_state.series(candles, {}, 'inCloud');
    for (const v of inCloud) if (v != null) expect([0, 1]).toContain(v);
  });

  it('DSL shorthand parses: regime, cloud, p', () => {
    expect(parseCondition('dsmart regime > 0 on 1h')).toMatchObject({
      ok: true,
      condition: { left: { source: 'dsmart_state', output: 'regime' }, op: 'gt', right: 0, tf: '1h' },
    });
    expect(parseCondition('dsmart cloud < 1')).toMatchObject({
      ok: true,
      condition: { left: { output: 'inCloud' }, op: 'lt' },
    });
    expect(parseCondition('dsmart p <= 5')).toMatchObject({
      ok: true,
      condition: { left: { source: 'dsmart_signal', output: 'pullbackBull' }, op: 'lte', right: 5 },
    });
  });
});
