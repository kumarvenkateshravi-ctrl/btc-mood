// Technical-filter presets for the SMC Screener (Layer 2 only — the
// Institutional Workflow is locked and identical across all presets).
// Custom presets + the trader's current filters persist in localStorage.

import { DEFAULT_FILTERS, type TechnicalFilters } from './screener';

export interface ScreenerPreset {
  id: string;
  name: string;
  builtIn: boolean;
  filters: TechnicalFilters;
}

export const BUILT_IN_PRESETS: ScreenerPreset[] = [
  {
    id: 'default',
    name: 'Default (EMA · RSI · ATR)',
    builtIn: true,
    filters: DEFAULT_FILTERS,
  },
  {
    id: 'conservative',
    name: 'Conservative Trend Filter',
    builtIn: true,
    filters: {
      trend: { indicator: 'sma', fast: 20, slow: 50, long: 200, atrPeriod: 10, multiplier: 3, minAlignment: 4 },
      momentum: { indicator: 'rsi', rsiLength: 14, bullThreshold: 60, bearThreshold: 40, cciLength: 20, adxEnabled: true, adxMin: 25 },
      volatility: { indicator: 'atr', length: 14, volSpikeMult: 1.5 },
      volume: { indicator: 'volSma', smaLength: 20, mfiLength: 14 },
    },
  },
  {
    id: 'aggressive',
    name: 'Aggressive Scalping Filter',
    builtIn: true,
    filters: {
      trend: { indicator: 'ema', fast: 9, slow: 21, long: 100, atrPeriod: 10, multiplier: 3, minAlignment: 2 },
      momentum: { indicator: 'rsi', rsiLength: 7, bullThreshold: 52, bearThreshold: 48, cciLength: 20, adxEnabled: false, adxMin: 20 },
      volatility: { indicator: 'bollinger', length: 20, volSpikeMult: 1.3 },
      volume: { indicator: 'obv', smaLength: 20, mfiLength: 14 },
    },
  },
  {
    id: 'swing',
    name: 'Swing Trading Filter',
    builtIn: true,
    filters: {
      trend: { indicator: 'ema', fast: 20, slow: 50, long: 200, atrPeriod: 10, multiplier: 3, minAlignment: 3 },
      momentum: { indicator: 'macd', rsiLength: 14, bullThreshold: 55, bearThreshold: 45, cciLength: 20, adxEnabled: true, adxMin: 25 },
      volatility: { indicator: 'donchian', length: 20, volSpikeMult: 1.5 },
      volume: { indicator: 'mfi', smaLength: 20, mfiLength: 14 },
    },
  },
];

const STORAGE_KEY = 'btc-mood:smc-screener-filters:v1';

interface StoredState {
  version: 1;
  current: TechnicalFilters;
  custom: ScreenerPreset[];
}

function mergeFilters(partial: unknown): TechnicalFilters {
  const p = (partial ?? {}) as Partial<Record<keyof TechnicalFilters, object>>;
  return {
    trend: { ...DEFAULT_FILTERS.trend, ...p.trend },
    momentum: { ...DEFAULT_FILTERS.momentum, ...p.momentum },
    volatility: { ...DEFAULT_FILTERS.volatility, ...p.volatility },
    volume: { ...DEFAULT_FILTERS.volume, ...p.volume },
  };
}

export function loadScreenerFilters(): { current: TechnicalFilters; custom: ScreenerPreset[] } {
  if (typeof window === 'undefined') return { current: DEFAULT_FILTERS, custom: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { current: DEFAULT_FILTERS, custom: [] };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    const custom = Array.isArray(parsed.custom)
      ? parsed.custom
          .filter((c): c is ScreenerPreset => Boolean(c && typeof c === 'object' && 'id' in c && 'name' in c))
          .map((c) => ({ ...c, builtIn: false, filters: mergeFilters(c.filters) }))
      : [];
    return { current: mergeFilters(parsed.current), custom };
  } catch {
    return { current: DEFAULT_FILTERS, custom: [] };
  }
}

export function saveScreenerFilters(current: TechnicalFilters, custom: ScreenerPreset[]): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredState = { version: 1, current, custom };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / blocked */
  }
}
