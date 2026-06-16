// View-mode engine: the dashboard recomposes around the active intent.
// Explicit, remembered, shareable. Trader is the first-visit default
// (matches PRODUCT.md's primary persona); Analyst and Casual are a
// switch away. Each mode declares its own sensible defaults and which
// surfaces it shows, so the page can branch its layout from one config.

import type { Timeframe } from './types';
import type { ChartType } from '@/components/Chart';

export type ViewMode = 'trader' | 'analyst' | 'casual';

export const VIEW_MODES: ViewMode[] = ['trader', 'analyst', 'casual'];
export const DEFAULT_VIEW_MODE: ViewMode = 'trader';
export const VIEW_MODE_STORAGE_KEY = 'btc-mood:view:v1';

export function isViewMode(s: string | null | undefined): s is ViewMode {
  return s === 'trader' || s === 'analyst' || s === 'casual';
}

export interface ModeConfig {
  id: ViewMode;
  label: string;
  /** One-line description for the switch tooltip. */
  blurb: string;
  /** Applied to the chart when this mode is chosen explicitly. */
  defaultTf: Timeframe;
  defaultChartType: ChartType;
  /** Casual hides the EMA overlays for a calmer read. */
  hideIndicators: boolean;
  // --- Surface composition flags ---
  showNarrative: boolean; // plain-language mood explanation
  narrativeVariant: 'casual' | 'analyst';
  showRationale: boolean; // per-timeframe factor breakdown
  showTimeframeStrip: boolean;
  showBacktest: boolean;
  showAlerts: boolean;
  showReservedColumn: boolean;
}

export const MODE_CONFIG: Record<ViewMode, ModeConfig> = {
  trader: {
    id: 'trader',
    label: 'Trader',
    blurb: 'Fast, dense, glance-and-act',
    defaultTf: '15m',
    defaultChartType: 'candlestick',
    hideIndicators: false,
    showNarrative: false,
    narrativeVariant: 'analyst',
    showRationale: false,
    showTimeframeStrip: true,
    showBacktest: true,
    showAlerts: true,
    showReservedColumn: true,
  },
  analyst: {
    id: 'analyst',
    label: 'Analyst',
    blurb: 'Context, rationale, backtests',
    defaultTf: '1h',
    defaultChartType: 'candlestick',
    hideIndicators: false,
    showNarrative: true,
    narrativeVariant: 'analyst',
    showRationale: true,
    showTimeframeStrip: true,
    showBacktest: true,
    showAlerts: true,
    showReservedColumn: false,
  },
  casual: {
    id: 'casual',
    label: 'Casual',
    blurb: "Plain-language, what's it doing",
    defaultTf: '4h',
    defaultChartType: 'heikinAshi',
    hideIndicators: true,
    showNarrative: true,
    narrativeVariant: 'casual',
    showRationale: false,
    showTimeframeStrip: true,
    showBacktest: false,
    showAlerts: false,
    showReservedColumn: false,
  },
};

/** Resolve the initial mode: URL `?mode=` wins (shareable), then the
 *  remembered preference, then the default. SSR-safe. */
export function readInitialMode(search?: string): ViewMode {
  if (typeof window === 'undefined') return DEFAULT_VIEW_MODE;
  const sp = new URLSearchParams(search ?? window.location.search);
  const fromUrl = sp.get('mode');
  if (isViewMode(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (isViewMode(stored)) return stored;
  } catch {
    // storage disabled — fall through
  }
  return DEFAULT_VIEW_MODE;
}

export function saveMode(mode: ViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}
