'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PriceScaleModeOption } from './types';

/**
 * Schema for the TV-style chart settings popover.
 *
 * Persisted across reloads (in localStorage `btc-mood:chart-settings:v1`):
 *  - `scaleMode`
 *  - `invertScale`
 *  - `activePriceScaleId`
 *
 * All other keys reset to defaults on reload.
 */
export interface ChartSettingsState {
  /** Re-apply autoScale on every visible-range change. */
  autoScale: boolean;
  /** Alt+I. */
  invertScale: boolean;
  /** 'normal' | 'log' | 'percent'. Alt+P cycles. */
  scaleMode: PriceScaleModeOption;
  /** Mirror of "Scale price chart only" (approximation). */
  scalePriceChartOnly: boolean;
  /** Approximation: keep price scale auto-sized to the visible bars. */
  lockPriceToBarRatio: boolean;
  /** Cosmetic number shown next to the toggle. */
  lockPriceToBarRatioValue: number;
  /** 'right' (default) or 'left'. */
  activePriceScaleId: 'left' | 'right';
  /** "Status line" (price-scale border). */
  labelsStatusLine: boolean;
  /** LWC crosshair MagnetOHLC vs Normal. */
  showCrosshairSnap: boolean;
  /** Master toggle for the candle-close countdown label. */
  showCountdown: boolean;
}

export const DEFAULT_CHART_SETTINGS: ChartSettingsState = {
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
};

const STORAGE_KEY = 'btc-mood:chart-settings:v1';
const STORAGE_VERSION = 1;

const PERSISTED_KEYS: ReadonlyArray<keyof ChartSettingsState> = [
  'scaleMode',
  'invertScale',
  'activePriceScaleId',
];

/** Drop unknown keys and backfill missing ones with defaults. Idempotent and
 *  version-tolerant — used on every hydrate so future schema changes can be
 *  forward-compat. */
export function migrateChartSettings(
  stored: unknown,
  version: number = STORAGE_VERSION,
): Partial<ChartSettingsState> {
  if (version !== STORAGE_VERSION) return {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const out: Partial<ChartSettingsState> = {};
  const src = stored as Record<string, unknown>;
  for (const key of PERSISTED_KEYS) {
    if (!(key in src)) continue;
    const v = src[key];
    switch (key) {
      case 'scaleMode':
        if (v === 'normal' || v === 'log' || v === 'percent') {
          out.scaleMode = v;
        }
        break;
      case 'invertScale':
        if (typeof v === 'boolean') out.invertScale = v;
        break;
      case 'activePriceScaleId':
        if (v === 'left' || v === 'right') out.activePriceScaleId = v;
        break;
    }
  }
  return out;
}

function readPersisted(): Partial<ChartSettingsState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { version?: number; state?: unknown };
    if (typeof parsed !== 'object' || parsed == null) return {};
    return migrateChartSettings(parsed.state, parsed.version);
  } catch {
    return {};
  }
}

function writePersisted(persisted: Partial<ChartSettingsState>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify({ version: STORAGE_VERSION, state: persisted });
    window.localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    /* localStorage may be full / blocked — ignore. */
  }
}

function clearPersisted(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function pickPersisted(s: ChartSettingsState): Partial<ChartSettingsState> {
  const out: Partial<ChartSettingsState> = {};
  for (const k of PERSISTED_KEYS) {
    (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

export interface UseChartSettingsResult {
  settings: ChartSettingsState;
  patch: (p: Partial<ChartSettingsState>) => void;
  reset: () => void;
}

/**
 * Owns the chart settings state. Hydrates persisted keys from localStorage
 * synchronously in the initial `useState` so the first chart paint reflects
 * the user's saved preferences (no log → linear flash).
 */
export function useChartSettings(): UseChartSettingsResult {
  const [settings, setSettings] = useState<ChartSettingsState>(() => ({
    ...DEFAULT_CHART_SETTINGS,
    ...readPersisted(),
  }));

  // Skip the very first effect run — we just hydrated.
  const isFirstWrite = useRef(true);

  useEffect(() => {
    if (isFirstWrite.current) {
      isFirstWrite.current = false;
      return;
    }
    writePersisted(pickPersisted(settings));
  }, [settings]);

  const patch = useCallback((p: Partial<ChartSettingsState>) => {
    setSettings((prev) => ({ ...prev, ...p }));
  }, []);

  const reset = useCallback(() => {
    setSettings({ ...DEFAULT_CHART_SETTINGS });
    clearPersisted();
  }, []);

  return { settings, patch, reset };
}

/** Test-only helper: change the storage key. */
export const __TEST_STORAGE_KEY = STORAGE_KEY;
