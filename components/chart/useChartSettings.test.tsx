// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_CHART_SETTINGS,
  __TEST_STORAGE_KEY,
  migrateChartSettings,
} from './useChartSettings';

beforeEach(() => {
  window.localStorage.clear();
});

describe('migrateChartSettings', () => {
  it('returns empty object on garbage input', () => {
    expect(migrateChartSettings(null)).toEqual({});
    expect(migrateChartSettings(undefined)).toEqual({});
    expect(migrateChartSettings('nope')).toEqual({});
    expect(migrateChartSettings(42)).toEqual({});
    expect(migrateChartSettings([1, 2, 3])).toEqual({});
  });

  it('drops unknown keys and accepts known ones', () => {
    const out = migrateChartSettings({
      scaleMode: 'log',
      invertScale: true,
      activePriceScaleId: 'left',
      madeUpKey: 'whatever',
    });
    expect(out).toEqual({ scaleMode: 'log', invertScale: true, activePriceScaleId: 'left' });
  });

  it('rejects invalid enum values', () => {
    expect(migrateChartSettings({ scaleMode: 'weird' as unknown as 'log' })).toEqual({});
    expect(migrateChartSettings({ activePriceScaleId: 'center' as unknown as 'left' })).toEqual({});
    expect(migrateChartSettings({ invertScale: 'yes' as unknown as boolean })).toEqual({});
  });

  it('returns empty on version mismatch (forward-compat placeholder)', () => {
    expect(migrateChartSettings({ scaleMode: 'log' }, 999)).toEqual({});
  });
});

describe('chart settings constants', () => {
  it('DEFAULT_CHART_SETTINGS has the expected shape', () => {
    expect(DEFAULT_CHART_SETTINGS).toEqual({
      autoScale: true,
      invertScale: false,
      scaleMode: 'normal',
      scalePriceChartOnly: false,
      lockPriceToBarRatio: false,
      lockPriceToBarRatioValue: 10,
      activePriceScaleId: 'right',
      labelsStatusLine: true,
      showCrosshairSnap: false,
      showCountdown: true,
    });
  });
});

describe('localStorage helpers (integration)', () => {
  it('storage key matches expected namespaced version', () => {
    expect(__TEST_STORAGE_KEY).toBe('btc-mood:chart-settings:v1');
  });

  it('localStorage round-trips a known persisted payload', () => {
    const payload = {
      version: 1,
      state: { scaleMode: 'log', invertScale: true, activePriceScaleId: 'left' },
    };
    window.localStorage.setItem(__TEST_STORAGE_KEY, JSON.stringify(payload));
    const raw = window.localStorage.getItem(__TEST_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    const migrated = migrateChartSettings(parsed.state, parsed.version);
    expect(migrated).toEqual({
      scaleMode: 'log',
      invertScale: true,
      activePriceScaleId: 'left',
    });
  });
});
