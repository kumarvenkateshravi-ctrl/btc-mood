import { describe, it, expect } from 'vitest';
import {
  autoTickSize,
  buildProfile,
  buildSessionProfiles,
  computeSessionVolumeProfile,
  groupIntoSessions,
  MAX_ROWS_PER_PROFILE,
} from './sessionVolumeProfile';
import type { Candle } from '../types';
import type { CustomIndicatorConfig } from '../indicatorFramework';

const DAY = 86_400;
const T0 = 1_700_000_000; // a fixed Tue 14 Nov 2023 (UTC) anchor

function svpConfig(
  inputs: Record<string, unknown>,
  styles: NonNullable<CustomIndicatorConfig['settings']>['styles'] = {},
): CustomIndicatorConfig {
  return { id: 'session_volume_profile', settings: { inputs, styles, visibility: {} } };
}

/**
 * A bar sitting essentially at one price. The span is tiny so its volume lands
 * in a single row, which makes POC/value-area assertions exact.
 */
function bar(
  price: number,
  volume: number,
  dir: 'up' | 'down' = 'up',
  time = T0,
): Candle {
  const e = 1e-6;
  return dir === 'up'
    ? { time, open: price - e, high: price + e, low: price - e, close: price + e, volume }
    : { time, open: price + e, high: price + e, low: price - e, close: price - e, volume };
}

describe('autoTickSize', () => {
  it('scales with price magnitude', () => {
    expect(autoTickSize(60_000)).toBe(0.1);
    expect(autoTickSize(250)).toBe(0.01);
    expect(autoTickSize(5)).toBe(0.001);
    expect(autoTickSize(0.5)).toBe(0.0001);
  });

  it('never returns zero for degenerate input', () => {
    expect(autoTickSize(0)).toBeGreaterThan(0);
    expect(autoTickSize(NaN)).toBeGreaterThan(0);
  });
});

describe('buildProfile', () => {
  it('returns null when there is nothing to profile', () => {
    expect(buildProfile([])).toBeNull();
    expect(buildProfile([bar(100, 0)])).toBeNull();
  });

  it('puts the POC on the heaviest price', () => {
    const candles = [
      bar(100, 10),
      bar(101, 10),
      bar(102, 500), // the fat one
      bar(103, 10),
      bar(104, 10),
    ];
    const p = buildProfile(candles, { rowsLayout: 'rows', rowSize: 5 })!;
    expect(p).not.toBeNull();
    expect(p.poc).toBeGreaterThan(101.5);
    expect(p.poc).toBeLessThan(102.5);
    expect(p.maxRowVolume).toBeCloseTo(500, 0);
  });

  it('conserves total volume across the rows', () => {
    const candles = [bar(100, 10), bar(105, 25), bar(110, 65)];
    const p = buildProfile(candles, { rowsLayout: 'rows', rowSize: 20 })!;
    const summed = p.rows.reduce((a, r) => a + r.total, 0);
    expect(summed).toBeCloseTo(100, 6);
    expect(p.totalVolume).toBeCloseTo(100, 6);
  });

  it('splits volume into up and down by candle direction', () => {
    const candles = [
      bar(100, 30, 'up'),
      bar(101, 70, 'down'),
    ];
    const p = buildProfile(candles, { rowsLayout: 'rows', rowSize: 10 })!;
    const up = p.rows.reduce((a, r) => a + r.up, 0);
    const down = p.rows.reduce((a, r) => a + r.down, 0);
    expect(up).toBeCloseTo(30, 6);
    expect(down).toBeCloseTo(70, 6);
    // delta is signed and mirrors the split
    const delta = p.rows.reduce((a, r) => a + r.delta, 0);
    expect(delta).toBeCloseTo(-40, 6);
  });

  it('builds a value area that contains the POC and reaches the target volume', () => {
    // A clean bell so the value area is unambiguous.
    const candles = [
      bar(100, 5), bar(101, 15), bar(102, 30),
      bar(103, 100), // POC
      bar(104, 30), bar(105, 15), bar(106, 5),
    ];
    const p = buildProfile(candles, { rowsLayout: 'rows', rowSize: 7, valueAreaVolume: 70 })!;

    expect(p.val).toBeLessThanOrEqual(p.poc);
    expect(p.vah).toBeGreaterThanOrEqual(p.poc);

    const inVa = p.rows.filter((r) => r.inValueArea).reduce((a, r) => a + r.total, 0);
    expect(inVa / p.totalVolume).toBeGreaterThanOrEqual(0.7);
  });

  it('widens the value area as the target percentage grows', () => {
    const candles = Array.from({ length: 21 }, (_, i) =>
      bar(100 + i, 100 - Math.abs(10 - i) * 8),
    );
    const narrow = buildProfile(candles, { rowsLayout: 'rows', rowSize: 21, valueAreaVolume: 50 })!;
    const wide = buildProfile(candles, { rowsLayout: 'rows', rowSize: 21, valueAreaVolume: 90 })!;
    expect(wide.vah - wide.val).toBeGreaterThan(narrow.vah - narrow.val);
  });

  it('handles a flat session as a single row', () => {
    // Genuinely zero-range: every OHLC value identical, so there is no price
    // span to bucket. `bar()` deliberately carries a hair of span, so this
    // case has to be built by hand.
    const flat: Candle[] = [
      { time: T0, open: 100, high: 100, low: 100, close: 100, volume: 10 },
      { time: T0 + 60, open: 100, high: 100, low: 100, close: 100, volume: 20 },
    ];
    const p = buildProfile(flat, { rowsLayout: 'rows', rowSize: 20 })!;
    expect(p.rows).toHaveLength(1);
    expect(p.poc).toBeCloseTo(100, 6);
    expect(p.totalVolume).toBeCloseTo(30, 6);
    expect(p.rows[0].inValueArea).toBe(true);
  });

  it('honours the "number of rows" layout', () => {
    const candles = Array.from({ length: 30 }, (_, i) => bar(100 + i, 10));
    const p = buildProfile(candles, { rowsLayout: 'rows', rowSize: 12 })!;
    expect(p.rows).toHaveLength(12);
  });

  it('derives the row count from tick size in the "ticks per row" layout', () => {
    // range 100 → 110 with tickSize 0.1 = 100 ticks; 10 ticks/row → 10 rows.
    const candles = [bar(100, 10), bar(110, 10)];
    const p = buildProfile(candles, {
      rowsLayout: 'ticks',
      rowSize: 10,
      tickSize: 0.1,
    })!;
    expect(p.rows.length).toBeGreaterThanOrEqual(10);
    expect(p.rows.length).toBeLessThanOrEqual(11);
  });

  it('caps runaway row counts', () => {
    const candles = [bar(100, 10), bar(100_000, 10)];
    const p = buildProfile(candles, {
      rowsLayout: 'ticks',
      rowSize: 1,
      tickSize: 0.01,
    })!;
    expect(p.rows.length).toBeLessThanOrEqual(MAX_ROWS_PER_PROFILE);
  });

  it('spreads a wide candle across the rows it spans', () => {
    // One tall candle covering 100→110 should touch many rows, not just one.
    const candles: Candle[] = [
      { time: T0, open: 100, high: 110, low: 100, close: 110, volume: 100 },
    ];
    const p = buildProfile(candles, { rowsLayout: 'rows', rowSize: 10 })!;
    const touched = p.rows.filter((r) => r.total > 0).length;
    expect(touched).toBe(10);
    expect(p.rows.reduce((a, r) => a + r.total, 0)).toBeCloseTo(100, 6);
  });
});

describe('groupIntoSessions', () => {
  const threeDays: Candle[] = [
    bar(100, 10, 'up', T0),
    bar(101, 10, 'up', T0 + 3600),
    bar(102, 10, 'up', T0 + DAY),
    bar(103, 10, 'up', T0 + DAY + 3600),
    bar(104, 10, 'up', T0 + 2 * DAY),
  ];

  it('splits on UTC day boundaries in daily mode', () => {
    const s = groupIntoSessions(threeDays, { mode: 'daily' });
    expect(s).toHaveLength(3);
    expect(s[0].candles).toHaveLength(2);
    expect(s[2].candles).toHaveLength(1);
  });

  it('collapses everything into one session in visible mode', () => {
    const s = groupIntoSessions(threeDays, { mode: 'visible' });
    expect(s).toHaveLength(1);
    expect(s[0].candles).toHaveLength(5);
    expect(s[0].startTime).toBe(T0);
  });

  it('groups a whole week together in weekly mode', () => {
    const s = groupIntoSessions(threeDays, { mode: 'weekly' });
    expect(s).toHaveLength(1);
  });

  it('starts a new bucket when the week rolls over', () => {
    const acrossWeeks = [
      bar(100, 10, 'up', T0),
      bar(101, 10, 'up', T0 + 8 * DAY),
    ];
    expect(groupIntoSessions(acrossWeeks, { mode: 'weekly' })).toHaveLength(2);
  });

  it('splits on fixed intraday boundaries', () => {
    const utcMidnight = Math.floor(T0 / DAY) * DAY;
    const c = (minute: number) => bar(100, 10, 'up', utcMidnight + minute * 60);

    // 00:05, 00:20, 00:35 → one 15m bucket each; 30m merges the first two.
    const candles = [c(5), c(20), c(35)];
    expect(groupIntoSessions(candles, { mode: '15m' })).toHaveLength(3);
    expect(groupIntoSessions(candles, { mode: '30m' })).toHaveLength(2);
    expect(groupIntoSessions(candles, { mode: '1h' })).toHaveLength(1);
  });

  it('splits on the 4h boundary', () => {
    const utcMidnight = Math.floor(T0 / DAY) * DAY;
    const candles = [
      bar(100, 10, 'up', utcMidnight + 1 * 3600), // 01:00 → bucket 0
      bar(101, 10, 'up', utcMidnight + 3 * 3600), // 03:00 → bucket 0
      bar(102, 10, 'up', utcMidnight + 5 * 3600), // 05:00 → bucket 1
    ];
    const s = groupIntoSessions(candles, { mode: '4h' });
    expect(s).toHaveLength(2);
    expect(s[0].candles).toHaveLength(2);
  });

  it('buckets months on the calendar, not a fixed length', () => {
    // Feb 2024 (29 days) → Mar → Apr. A fixed 30-day divisor would drift and
    // merge or split these incorrectly; calendar bucketing must not.
    const feb = Date.UTC(2024, 1, 10) / 1000;
    const mar = Date.UTC(2024, 2, 10) / 1000;
    const apr = Date.UTC(2024, 3, 10) / 1000;
    const s = groupIntoSessions(
      [bar(100, 10, 'up', feb), bar(101, 10, 'up', mar), bar(102, 10, 'up', apr)],
      { mode: 'monthly' },
    );
    expect(s).toHaveLength(3);
  });

  it('keeps a whole month in one session', () => {
    const early = Date.UTC(2024, 4, 1) / 1000;
    const late = Date.UTC(2024, 4, 31) / 1000;
    expect(
      groupIntoSessions([bar(100, 10, 'up', early), bar(101, 10, 'up', late)], {
        mode: 'monthly',
      }),
    ).toHaveLength(1);
  });

  it('rolls the month bucket across a year boundary', () => {
    const dec = Date.UTC(2024, 11, 15) / 1000;
    const jan = Date.UTC(2025, 0, 15) / 1000;
    expect(
      groupIntoSessions([bar(100, 10, 'up', dec), bar(101, 10, 'up', jan)], {
        mode: 'monthly',
      }),
    ).toHaveLength(2);
  });

  it('keeps only candles inside a custom window', () => {
    const utcMidnight = Math.floor(T0 / DAY) * DAY;
    const candles = [
      bar(100, 10, 'up', utcMidnight + 1 * 3600), // 01:00 — outside
      bar(101, 10, 'up', utcMidnight + 10 * 3600), // 10:00 — inside
      bar(102, 10, 'up', utcMidnight + 12 * 3600), // 12:00 — inside
      bar(103, 10, 'up', utcMidnight + 20 * 3600), // 20:00 — outside
    ];
    const s = groupIntoSessions(candles, {
      mode: 'custom',
      customStartMin: 9 * 60,
      customEndMin: 16 * 60,
    });
    expect(s).toHaveLength(1);
    expect(s[0].candles).toHaveLength(2);
  });

  it('keeps an overnight custom window as one session', () => {
    const utcMidnight = Math.floor(T0 / DAY) * DAY;
    const candles = [
      bar(100, 10, 'up', utcMidnight + 23 * 3600), // 23:00 day 0
      bar(101, 10, 'up', utcMidnight + DAY + 1 * 3600), // 01:00 day 1
    ];
    const s = groupIntoSessions(candles, {
      mode: 'custom',
      customStartMin: 22 * 60,
      customEndMin: 4 * 60, // wraps midnight
    });
    expect(s).toHaveLength(1);
    expect(s[0].candles).toHaveLength(2);
  });

  it('returns nothing for an empty input', () => {
    expect(groupIntoSessions([], { mode: 'daily' })).toEqual([]);
  });
});

describe('buildSessionProfiles', () => {
  it('produces one profile per session and drops empty ones', () => {
    const candles = [
      bar(100, 10, 'up', T0),
      bar(101, 20, 'up', T0 + 3600),
      bar(200, 30, 'up', T0 + DAY),
    ];
    const profiles = buildSessionProfiles(candles, { mode: 'daily' });
    expect(profiles).toHaveLength(2);
    expect(profiles[0].totalVolume).toBeCloseTo(30, 6);
    expect(profiles[1].totalVolume).toBeCloseTo(30, 6);
  });
});

describe('POC-only display mode', () => {
  const candles = [
    bar(100, 10, 'up', T0),
    bar(101, 40, 'up', T0 + 60),
  ];

  it('keeps the complete profile display enabled by default', () => {
    const result = computeSessionVolumeProfile(candles);
    expect(result.profileStyle?.showProfileBoxes).toBe(true);
    expect(result.profileStyle?.showVah).toBe(true);
    expect(result.profileStyle?.showVal).toBe(true);
    expect(result.profileStyle?.showShapeLabel).toBe(true);
  });

  it('hides histogram-related elements but preserves the POC setting', () => {
    const result = computeSessionVolumeProfile(candles, svpConfig(
      { showProfileBoxes: false, showValues: true, showShapeLabel: true },
      {
        poc: { color: '#f0b90b', thickness: 1, lineStyle: 'solid', display: true },
        vah: { color: '#787b86', thickness: 1, lineStyle: 'dashed', display: true },
        val: { color: '#787b86', thickness: 1, lineStyle: 'dashed', display: true },
      },
    ));

    expect(result.profileStyle?.showProfileBoxes).toBe(false);
    expect(result.profileStyle?.showValues).toBe(false);
    expect(result.profileStyle?.showVah).toBe(false);
    expect(result.profileStyle?.showVal).toBe(false);
    expect(result.profileStyle?.showShapeLabel).toBe(false);
    expect(result.profileStyle?.showPoc).toBe(true);
  });
});

describe('in-session historical POC overlays', () => {
  const candles = [
    bar(100, 10, 'up', T0),
    bar(101, 40, 'up', T0 + 60),
    bar(200, 10, 'up', T0 + DAY),
    bar(201, 50, 'up', T0 + DAY + 60),
  ];

  it('adds daily POCs without boxes, value-area levels, labels, or future extensions', () => {
    const result = computeSessionVolumeProfile(candles, svpConfig({ sessions: 'visible', showDailyPocs: true }));

    const dailyProfiles = buildSessionProfiles(candles, { mode: 'daily' });
    const pocOnly = result.profiles?.filter((profile) => profile.showRows === false) ?? [];

    expect(pocOnly).toHaveLength(dailyProfiles.length);
    expect(pocOnly.map((profile) => profile.poc)).toEqual(dailyProfiles.map((profile) => profile.poc));
    expect(pocOnly.every((profile) =>
      profile.showVah === false &&
      profile.showVal === false &&
      profile.showShapeLabel === false &&
      profile.pocExtendTo === undefined,
    )).toBe(true);
  });

  it('does not duplicate a POC timeframe already selected for the full profile', () => {
    const result = computeSessionVolumeProfile(candles, svpConfig({ sessions: 'daily', showDailyPocs: true }));


    expect(result.profiles?.some((profile) => profile.showRows === false)).toBe(false);
  });
});
describe('multi-timeframe POC toggles', () => {
  it('adds weekly, daily, and 4-hour POCs independently', () => {
    const candles = [
      bar(100, 10, 'up', T0),
      bar(101, 40, 'up', T0 + 60),
      bar(200, 10, 'up', T0 + DAY),
      bar(201, 50, 'up', T0 + DAY + 60),
    ];
    const result = computeSessionVolumeProfile(candles, svpConfig({
      sessions: 'visible',
      showWeeklyPocs: true,
      showDailyPocs: true,
      show4hPocs: true,
    }));
    const expectedCount =
      buildSessionProfiles(candles, { mode: 'weekly' }).length +
      buildSessionProfiles(candles, { mode: 'daily' }).length +
      buildSessionProfiles(candles, { mode: '4h' }).length;

    expect(result.profiles?.filter((profile) => profile.showRows === false)).toHaveLength(expectedCount);
  });
});
describe('timeframe-specific POC styles', () => {
  const candles = [
    bar(100, 10, 'up', T0),
    bar(101, 40, 'up', T0 + 60),
    bar(200, 10, 'up', T0 + DAY),
    bar(201, 50, 'up', T0 + DAY + 60),
  ];

  it('uses editable colors for weekly, daily, and 4-hour POCs', () => {
    const result = computeSessionVolumeProfile(candles, svpConfig(
      {
        sessions: 'visible',
        showWeeklyPocs: true,
        showDailyPocs: true,
        show4hPocs: true,
      },
      {
        weeklyPoc: { color: '#7c3aed', thickness: 1, lineStyle: 'solid', display: true },
        dailyPoc: { color: '#f0b90b', thickness: 1, lineStyle: 'solid', display: true },
        fourHourPoc: { color: '#06b6d4', thickness: 1, lineStyle: 'solid', display: true },
      },
    ));
    const colors = new Set(
      result.profiles
        ?.filter((profile) => profile.showRows === false)
        .map((profile) => profile.pocColor),
    );

    expect(colors).toEqual(new Set(['#7c3aed', '#f0b90b', '#06b6d4']));
  });

  it('uses the weekly POC style for a weekly main profile', () => {
    const result = computeSessionVolumeProfile(candles, svpConfig({ sessions: 'weekly' }));

    expect(result.profiles?.every((profile) => profile.pocColor === '#a855f7')).toBe(true);
  });
});