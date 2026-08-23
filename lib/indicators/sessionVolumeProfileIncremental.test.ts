import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import type { CustomIndicatorConfig } from '../indicatorFramework';
import { IncrementalIndicatorEngine } from '../incrementalIndicatorEngine';
import { CUSTOM_INDICATORS } from '../customIndicatorsLibrary';
import { computeSessionVolumeProfile } from './sessionVolumeProfile';
import { SessionVolumeProfileCache } from './sessionVolumeProfileIncremental';

const DAY = 86_400;
const T0 = 1_700_000_000;

function candle(time: number, price: number, volume: number): Candle {
  return { time, open: price - 0.2, high: price + 0.5, low: price - 0.5, close: price + 0.2, volume };
}

function config(inputs: Record<string, unknown>, styles: Record<string, { color: string; thickness: number; lineStyle: string; display: boolean }> = {}): CustomIndicatorConfig {
  return { id: 'session_volume_profile', settings: { inputs, styles, visibility: {} } };
}

function profileSignature(result: ReturnType<typeof computeSessionVolumeProfile>) {
  return (result.profiles ?? []).map((profile) => ({
    startTime: profile.startTime,
    endTime: profile.endTime,
    poc: profile.poc,
    vah: profile.vah,
    val: profile.val,
    rows: profile.rows.map((row) => [row.low, row.high, row.total, row.up, row.down, row.inValueArea]),
    showRows: profile.showRows,
  }));
}

const indicator = CUSTOM_INDICATORS.find((item) => item.id === 'session_volume_profile')!;

describe('incremental session volume profile parity', () => {
  it('freezes completed profile results and keeps the active session separate', () => {
    const cache = new SessionVolumeProfileCache('BTCUSD|5m|immutable');
    const options = { rowsLayout: 'rows' as const, rowSize: 24, valueAreaVolume: 70 };
    const first = cache.provider([candle(T0, 100, 10), candle(T0 + DAY, 110, 20)], { mode: 'daily' }, options, false);
    expect(first).toHaveLength(2);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0].rows)).toBe(true);
    const next = cache.provider([candle(T0, 100, 10), candle(T0 + DAY, 110, 20), candle(T0 + 2 * DAY, 120, 30)], { mode: 'daily' }, options, false);
    expect(next[0]).toBe(first[0]);
    expect(cache.stats().cacheHits).toBeGreaterThan(0);
  });

  it('keeps completed daily sessions immutable while rebuilding only the developing session', () => {
    const cfg = config({ sessions: 'daily', showProfileBoxes: true });
    const engine = new IncrementalIndicatorEngine({ compute: indicator.compute, incremental: indicator.incremental });
    let history = [candle(T0 + 60, 100, 10), candle(T0 + 120, 101, 20), candle(T0 + DAY + 60, 110, 30)];
    const identity = 'BTCUSD|5m|svp-daily';
    expect(profileSignature(engine.update(history, { config: cfg, identity }))).toEqual(profileSignature(indicator.compute(history, cfg)));
    const statsAfterInit = engine.stats() as { cachedSessions: number; completedBuilds: number };
    expect(statsAfterInit?.cachedSessions).toBe(1);

    history = [...history.slice(0, -1), candle(T0 + DAY + 60, 112, 60)];
    expect(profileSignature(engine.update(history, { config: cfg, identity }))).toEqual(profileSignature(indicator.compute(history, cfg)));
    expect((engine.stats() as { completedBuilds: number }).completedBuilds).toBe(statsAfterInit.completedBuilds);

    history = [...history, candle(T0 + 2 * DAY + 60, 120, 40)];
    expect(profileSignature(engine.update(history, { config: cfg, identity }))).toEqual(profileSignature(indicator.compute(history, cfg)));
    expect((engine.stats() as { cachedSessions: number }).cachedSessions).toBe(2);
  });

  it('preserves exact POC/VAH/VAL parity across 4H, daily, and weekly boundaries', () => {
    const history = [
      candle(T0 + 60, 100, 10), candle(T0 + 3_600, 101, 20), candle(T0 + 14_400 + 60, 110, 40),
      candle(T0 + DAY + 60, 120, 15), candle(T0 + 3 * DAY + 60, 130, 50), candle(T0 + 8 * DAY + 60, 140, 80),
    ];
    const cfg = config({ sessions: 'visible', showWeeklyPocs: true, showDailyPocs: true, show4hPocs: true });
    const engine = new IncrementalIndicatorEngine({ compute: indicator.compute, incremental: indicator.incremental });
    const identity = 'BTCUSD|5m|svp-mtf';
    expect(profileSignature(engine.update(history, { config: cfg, identity }))).toEqual(profileSignature(indicator.compute(history, cfg)));
    const updated = [...history.slice(0, -1), candle(history.at(-1)!.time, 141, 120)];
    expect(profileSignature(engine.update(updated, { config: cfg, identity }))).toEqual(profileSignature(indicator.compute(updated, cfg)));
  });

  it('uses the POC-only path without materializing histogram rows or value area', () => {
    const cfg = config(
      { sessions: 'visible', showProfileBoxes: false, showDailyPocs: true, showWeeklyPocs: true, show4hPocs: true },
      {
        vah: { color: '#888', thickness: 1, lineStyle: 'dashed', display: false },
        val: { color: '#888', thickness: 1, lineStyle: 'dashed', display: false },
      },
    );
    const history = [candle(T0, 100, 10), candle(T0 + 60, 101, 50), candle(T0 + DAY, 120, 20)];
    const engine = new IncrementalIndicatorEngine({ compute: indicator.compute, incremental: indicator.incremental });
    const result = engine.update(history, { config: cfg, identity: 'BTCUSD|5m|svp-poc-only' });
    expect(profileSignature(result)).toEqual(profileSignature(indicator.compute(history, cfg)));
    expect(result.profiles?.every((profile) => profile.rows.length === 0)).toBe(true);
    expect(result.profileStyle?.showProfileBoxes).toBe(false);
  });

  it('falls back to a full rebuild on prepend, rewind, and settings identity changes', () => {
    const cfg = config({ sessions: 'daily', rowSize: 24 });
    const engine = new IncrementalIndicatorEngine({ compute: indicator.compute, incremental: indicator.incremental });
    const history = [candle(T0, 100, 10), candle(T0 + DAY, 110, 20), candle(T0 + 2 * DAY, 120, 30)];
    const identity = 'BTCUSD|5m|svp-reset-a';
    engine.update(history, { config: cfg, identity });
    const prepended = [candle(T0 - DAY, 90, 5), ...history];
    expect(profileSignature(engine.update(prepended, { config: cfg, identity }))).toEqual(profileSignature(indicator.compute(prepended, cfg)));
    expect(profileSignature(engine.update(prepended.slice(0, 2), { config: cfg, identity }))).toEqual(profileSignature(indicator.compute(prepended.slice(0, 2), cfg)));
    const changed = config({ sessions: 'daily', rowSize: 40 });
    expect(profileSignature(engine.update(prepended.slice(0, 2), { config: changed, identity: 'BTCUSD|5m|svp-reset-b' }))).toEqual(profileSignature(indicator.compute(prepended.slice(0, 2), changed)));
  });

  it('replay step and rewind remain deterministic against the immutable replay dataset', () => {
    const cfg = config({ sessions: 'daily', showDailyPocs: true });
    const fullHistory = Array.from({ length: 12 }, (_, i) => candle(T0 + i * 3_600, 100 + i, 10 + i));
    const engine = new IncrementalIndicatorEngine({ compute: indicator.compute, incremental: indicator.incremental });
    const identity = 'BTCUSD|5m|svp-replay';
    engine.update(fullHistory.slice(0, 8), { config: cfg, identity });
    const rewound = engine.update(fullHistory.slice(0, 5), { config: cfg, identity });
    expect(profileSignature(rewound)).toEqual(profileSignature(indicator.compute(fullHistory.slice(0, 5), cfg)));
    const forwardAgain = engine.update(fullHistory.slice(0, 8), { config: cfg, identity });
    expect(profileSignature(forwardAgain)).toEqual(profileSignature(indicator.compute(fullHistory.slice(0, 8), cfg)));
  });
});
