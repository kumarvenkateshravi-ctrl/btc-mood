// URL state helpers for the dashboard. Pure functions — no React, no
// side effects beyond window.history.replaceState. Extracted from
// app/app/page.tsx so the page component is a thin orchestrator.

import type { Timeframe } from './types';
import { TIMEFRAMES } from './types';
import type { ChartType } from '@/components/Chart';
import { CUSTOM_INDICATORS } from './customIndicatorsLibrary';
import {
  DEFAULT_COMPARE_SYMBOL,
  isCompareSymbol,
  type CompareSymbol,
} from './compare';

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
}

export function readInitialState(): InitialDashboardState {
  if (typeof window === 'undefined') {
    return { tf: '15m', type: 'candlestick', symbol: DEFAULT_COMPARE_SYMBOL, indicators: null };
  }
  const sp = new URLSearchParams(window.location.search);
  const tfParam = sp.get('tf');
  const symbolParam = sp.get('symbol') ?? DEFAULT_COMPARE_SYMBOL;
  const tf: Timeframe = (TIMEFRAMES as string[]).includes(tfParam ?? '')
    ? (tfParam as Timeframe)
    : '15m';
  const type: ChartType = parseChartType(sp.get('type')) ?? 'candlestick';
  const symbol: CompareSymbol = isCompareSymbol(symbolParam) ? symbolParam : DEFAULT_COMPARE_SYMBOL;
  const indParam = sp.get('ind');
  const indicators = indParam
    ? indParam.split(',').filter((id) => CUSTOM_INDICATORS.some((d) => d.id === id))
    : null;
  return { tf, type, symbol, indicators };
}

export function writeUrlState(
  tf: Timeframe,
  type: ChartType,
  symbol: CompareSymbol,
  indicators: string[],
): void {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  if (tf === '15m') sp.delete('tf');
  else sp.set('tf', tf);
  if (type === 'candlestick') sp.delete('type');
  else sp.set('type', type === 'heikinAshi' ? 'ha' : type === 'renko' ? 'renko' : 'candle');
  if (symbol === DEFAULT_COMPARE_SYMBOL) sp.delete('symbol');
  else sp.set('symbol', symbol);
  if (indicators.length === 0) sp.delete('ind');
  else sp.set('ind', indicators.join(','));
  const qs = sp.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}
