// @vitest-environment happy-dom

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { IndicatorSettings } from './indicatorFramework';

const original: IndicatorSettings = {
  inputs: { length: 14 }, styles: {}, visibility: {}, valuesInStatusLine: true,
};
const updated: IndicatorSettings = {
  inputs: { length: 21 }, styles: {}, visibility: {}, valuesInStatusLine: false,
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('indicator defaults storage', () => {
  it('saves a default in IndexedDB even when localStorage is at quota', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); },
    });
    const store = await import('./indicatorDefaultsStore');
    expect(await store.saveIndicatorDefault('rsi', updated)).toBe(true);
    vi.resetModules();
    const reloaded = await import('./indicatorDefaultsStore');
    expect((await reloaded.loadIndicatorDefaults()).rsi).toEqual(updated);
  });

  it('keeps legacy defaults and lets newer IndexedDB settings take precedence', async () => {
    localStorage.setItem('indicator_defaults', JSON.stringify({ rsi: original, sma: original }));
    const store = await import('./indicatorDefaultsStore');
    expect(await store.saveIndicatorDefault('rsi', updated)).toBe(true);
    expect(await store.loadIndicatorDefaults()).toEqual({ rsi: updated, sma: original });
  });

  it('reports failure without throwing when both stores are unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); },
    });
    const store = await import('./indicatorDefaultsStore');
    await expect(store.saveIndicatorDefault('rsi', updated)).resolves.toBe(false);
  });
});
