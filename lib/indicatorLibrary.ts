import type { Candle } from './types';

// Extract vectors for compute
export function candleColumns(candles: Candle[]) {
  const open = new Float64Array(candles.length);
  const high = new Float64Array(candles.length);
  const low = new Float64Array(candles.length);
  const close = new Float64Array(candles.length);
  const volume = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    open[i] = candles[i].open;
    high[i] = candles[i].high;
    low[i] = candles[i].low;
    close[i] = candles[i].close;
    volume[i] = candles[i].volume;
  }
  return { open, high, low, close, volume };
}

// Indicator library registry mapped to KLineChart native indicators.

export type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume';

export interface IndicatorDef {
  id: string; // KLineChart's native name (e.g., 'SMA', 'MACD')
  label: string;
  category: IndicatorCategory;
  description: string;
  separatePane: boolean;
  params: { key: string; label: string; default: number; min: number; max: number; step: number }[];
}

export const INDICATORS: IndicatorDef[] = [];

export const INDICATORS_BY_CATEGORY = INDICATORS.reduce((acc, ind) => {
  if (!acc[ind.category]) acc[ind.category] = [];
  acc[ind.category].push(ind);
  return acc;
}, {} as Record<IndicatorCategory, IndicatorDef[]>);

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  trend: 'Trend & Moving Averages',
  momentum: 'Momentum Oscillators',
  volatility: 'Volatility',
  volume: 'Volume & Flow',
};
