// URL state helpers for the dashboard. Pure functions — no React, no
// side effects beyond window.history.replaceState. Extracted from
// app/app/page.tsx so the page component is a thin orchestrator.

import type { Timeframe } from './types';
import type { ChartType } from '@/components/Chart';
import { CUSTOM_INDICATORS } from './customIndicatorsLibrary';
import {
  DEFAULT_COMPARE_SYMBOL,
  type CompareSymbol,
} from './compare';
import type { Drawing } from './drawings';
import { CHART_CONFIG_STORAGE_KEY, DEFAULT_CHART_CONFIG, parsePersistedChartConfig, resolveChartConfig, type ChartConfigPatch } from './chartConfig';

export const POLL_MS = 30_000;
export const INDICATORS_KEY = 'btc-mood:chart-indicators:v1';

export const TF_MS: Record<Timeframe, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export function parseChartType(param: string | null): ChartType | null {
  if (param === 'ha') return 'heikinAshi';
  if (param === 'renko') return 'renko';
  if (param === 'candle' || param === 'candlestick') return 'candlestick';
  return null;
}

export interface InitialDashboardState {
  tf: Timeframe;
  type: ChartType;
  symbol: CompareSymbol;
  indicators: string[] | null;
  drawings: Drawing[] | null;
  rightPanel: 'mood' | 'signals' | 'orderflow' | 'scanner' | 'widgets' | 'watchlist' | null;
}

// Compact serialization for drawings
// Format: [id, type, color, text, time1, price1, time2, price2, ...]
function compressDrawings(drawings: Drawing[]): string {
  const compact = drawings.map(d => {
    const base: any[] = [d.id, d.type, d.color, d.text || ''];
    d.points.forEach(p => {
      base.push(p.time, p.price);
    });
    return base;
  });
  return btoa(JSON.stringify(compact));
}

function decompressDrawings(data: string): Drawing[] | null {
  if (data.startsWith('id:')) {
    console.warn('Backend fetch for drawing ID not implemented:', data);
    return null;
  }
  try {
    const parsed = JSON.parse(atob(data));
    if (!Array.isArray(parsed)) return null;
    return parsed.map((arr: any[]) => {
      const id = arr[0];
      const type = arr[1];
      const color = arr[2];
      const text = arr[3];
      const points = [];
      for (let i = 4; i < arr.length; i += 2) {
        points.push({ time: arr[i], price: arr[i + 1] });
      }
      const d: Drawing = { id, type, color, points };
      if (text) d.text = text;
      return d;
    });
  } catch {
    return null;
  }
}

export function readInitialState(workspace?: ChartConfigPatch): InitialDashboardState {
  const defaults = DEFAULT_CHART_CONFIG;
  if (typeof window === 'undefined') {
    return { tf: defaults.timeframe, type: defaults.chartType, symbol: defaults.symbol, indicators: null, drawings: null, rightPanel: defaults.rightPanel };
  }

  const sp = new URLSearchParams(window.location.search);
  const url: ChartConfigPatch = {};
  const persisted: ChartConfigPatch = {};
  const tfParam = sp.get('tf');
  const typeParam = sp.get('type');
  const symbolParam = sp.get('symbol');
  const indParam = sp.get('ind');

  // URL/active-session values outrank workspaces, which outrank these legacy
  // preference keys. Values are still validated by resolveChartConfig.
  if (tfParam) url.timeframe = tfParam;
  if (typeParam) url.chartType = parseChartType(typeParam);
  if (symbolParam) url.symbol = symbolParam;
  if (indParam != null) url.indicatorIds = indParam ? indParam.split(',') : [];

  const isValidIndicator = (id: string) => CUSTOM_INDICATORS.some((d) => d.id === id.split('::')[0]);

  try {
    Object.assign(persisted, parsePersistedChartConfig(localStorage.getItem(CHART_CONFIG_STORAGE_KEY), isValidIndicator));
    const storedTf = localStorage.getItem('btc-mood:tf');
    const storedType = localStorage.getItem('btc-mood:type');
    const storedSymbol = localStorage.getItem('btc-mood:symbol');
    if (storedTf) persisted.timeframe = storedTf;
    if (storedType) persisted.chartType = parseChartType(storedType);
    if (storedSymbol) persisted.symbol = storedSymbol;

    const rawIndicators = localStorage.getItem(INDICATORS_KEY);
    if (rawIndicators) {
      const parsed: unknown = JSON.parse(rawIndicators);
      if (Array.isArray(parsed)) persisted.indicatorIds = parsed;
    }
    const rawPanel = localStorage.getItem('rightPanel');
    if (rawPanel === 'mood' || rawPanel === 'signals' || rawPanel === 'orderflow' || rawPanel === 'scanner' || rawPanel === 'widgets' || rawPanel === 'watchlist') persisted.rightPanel = rawPanel;
    else if (rawPanel === 'none') persisted.rightPanel = null;
  } catch {
    // A malformed/blocked browser value simply falls through to the next
    // valid source and ultimately the defaults.
  }

  const resolved = resolveChartConfig({
    defaults,
    persisted,
    workspace,
    url,
    validIndicator: isValidIndicator,
  });
  const drawParam = sp.get('draw');
  const drawings = drawParam ? decompressDrawings(drawParam) : null;
  const indicators = (sp.has('ind') || Object.prototype.hasOwnProperty.call(persisted, 'indicatorIds'))
    ? resolved.indicatorIds
    : null;
  return {
    tf: resolved.timeframe,
    type: resolved.chartType,
    symbol: resolved.symbol,
    indicators,
    drawings,
    rightPanel: resolved.rightPanel,
  };
}
export function writeUrlState(
  tf: Timeframe,
  type: ChartType,
  symbol: CompareSymbol,
  indicators: string[],
  drawings: Drawing[] = [],
): void {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  if (tf === '15m') {
    sp.delete('tf');
    localStorage.removeItem('btc-mood:tf');
  } else {
    sp.set('tf', tf);
    localStorage.setItem('btc-mood:tf', tf);
  }

  if (type === 'candlestick') {
    sp.delete('type');
    localStorage.removeItem('btc-mood:type');
  } else {
    const t = type === 'heikinAshi' ? 'ha' : type === 'renko' ? 'renko' : 'candle';
    sp.set('type', t);
    localStorage.setItem('btc-mood:type', t);
  }

  if (symbol === DEFAULT_COMPARE_SYMBOL) {
    sp.delete('symbol');
    localStorage.removeItem('btc-mood:symbol');
  } else {
    sp.set('symbol', symbol);
    localStorage.setItem('btc-mood:symbol', symbol);
  }
  if (indicators.length === 0) sp.delete('ind');
  else sp.set('ind', indicators.join(','));
  
  if (drawings.length === 0) {
    sp.delete('draw');
  } else if (drawings.length <= 50) {
    sp.set('draw', compressDrawings(drawings));
  } else {
    // Stub for backend upload
    const fakeId = 'id:xyz' + Date.now();
    console.warn(`> 50 drawings (${drawings.length}), stubbing backend upload with ${fakeId}`);
    sp.set('draw', fakeId);
  }

  const qs = sp.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}
