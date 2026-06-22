// Tests for the multi-pane grid layout module. Pure functions, no DOM.

import { describe, it, expect } from 'vitest';
import {
  GRID_COUNTS,
  GRID_COLS_CLASS,
  DEFAULT_GRID_COUNT,
  isGridCount,
  tfsForCount,
  reconcileGridTfs,
  loadGrid,
  saveGrid,
} from './gridLayout';

describe('gridLayout', () => {
  describe('isGridCount', () => {
    it('accepts every allowed count', () => {
      for (const n of GRID_COUNTS) {
        expect(isGridCount(n)).toBe(true);
      }
    });
    it('rejects values outside the allowed set', () => {
      for (const n of [0, 3, 5, 7, 8, 9, -1, 1.5]) {
        expect(isGridCount(n)).toBe(false);
      }
    });
    it('exposes the documented cap of 6', () => {
      expect(GRID_COUNTS).toEqual([1, 2, 4, 6]);
      expect(DEFAULT_GRID_COUNT).toBe(1);
    });
  });

  describe('GRID_COLS_CLASS', () => {
    it('emits a Tailwind class for every count', () => {
      for (const n of GRID_COUNTS) {
        const cls = GRID_COLS_CLASS[n];
        expect(cls).toMatch(/grid-cols-/);
      }
    });
  });

  describe('tfsForCount', () => {
    it('returns a list whose length matches the count', () => {
      for (const n of GRID_COUNTS) {
        expect(tfsForCount(n, '15m')).toHaveLength(n);
      }
    });
    it('pins the user-selected TF when it is not in the default ladder', () => {
      // '1m' is in the default ladder for count=6 but not for count=1.
      // count=1 with selected='1m' should produce ['1m'].
      const out = tfsForCount(1, '1m');
      expect(out[0]).toBe('1m');
    });
    it('falls back to the default ladder when the selected TF is already included', () => {
      expect(tfsForCount(4, '15m')).toEqual(['15m', '1h', '4h', '1d']);
      expect(tfsForCount(6, '15m')).toEqual(['1m', '5m', '15m', '1h', '4h', '1d']);
    });
    it('never produces duplicates within the result', () => {
      for (const n of GRID_COUNTS) {
        const out = tfsForCount(n, '1m');
        expect(new Set(out).size).toBe(out.length);
      }
    });
  });

  describe('reconcileGridTfs', () => {
    it('returns previous unchanged when length matches the count', () => {
      expect(reconcileGridTfs(['15m', '1h'], 2, '15m')).toEqual(['15m', '1h']);
    });
    it('grows the list using the default ladder when previous is empty', () => {
      expect(reconcileGridTfs([], 4, '15m')).toEqual(['15m', '1h', '4h', '1d']);
    });
    it('shrinks by truncation when count shrinks', () => {
      expect(
        reconcileGridTfs(['1m', '5m', '15m', '1h', '4h', '1d'], 2, '15m'),
      ).toEqual(['1m', '5m']);
    });
    it('grows by appending default TFs not already present', () => {
      expect(
        reconcileGridTfs(['5m'], 4, '15m'),
      ).toEqual(['5m', '15m', '1h', '4h']);
    });
  });

  describe('persistence', () => {
    it('round-trips a valid state', () => {
      saveGrid({ count: 4, tfs: ['15m', '1h', '4h', '1d'] });
      const loaded = loadGrid();
      expect(loaded).toEqual({ count: 4, tfs: ['15m', '1h', '4h', '1d'] });
    });
    it('returns null when storage is empty', () => {
      // jsdom storage is per-test via setItem; this test assumes clean.
      // We simulate by reading after a key removal.
      window.localStorage.removeItem('btc-mood:chart-grid:v1');
      expect(loadGrid()).toBeNull();
    });
    it('returns null on schema mismatch', () => {
      window.localStorage.setItem(
        'btc-mood:chart-grid:v1',
        JSON.stringify({ schemaVersion: 999, count: 4, tfs: ['15m'] }),
      );
      expect(loadGrid()).toBeNull();
    });
    it('returns null when count is invalid', () => {
      window.localStorage.setItem(
        'btc-mood:chart-grid:v1',
        JSON.stringify({ schemaVersion: 1, count: 3, tfs: [] }),
      );
      expect(loadGrid()).toBeNull();
    });
    it('drops invalid TF entries on load', () => {
      window.localStorage.setItem(
        'btc-mood:chart-grid:v1',
        JSON.stringify({
          schemaVersion: 1,
          count: 4,
          tfs: ['15m', 'NOT_A_TF', '1h'],
        }),
      );
      const loaded = loadGrid();
      expect(loaded?.tfs).toEqual(['15m', '1h']);
    });
  });
});