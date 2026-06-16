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

export const INDICATORS: IndicatorDef[] = [
  // --- TREND ---
  {
    id: 'SMA', label: 'SMA', category: 'trend',
    description: 'Simple Moving Average',
    separatePane: false,
    params: [{ key: 'period', label: 'Period', default: 14, min: 2, max: 500, step: 1 }]
  },
  {
    id: 'EMA', label: 'EMA', category: 'trend',
    description: 'Exponential Moving Average',
    separatePane: false,
    params: [{ key: 'period', label: 'Period', default: 14, min: 2, max: 500, step: 1 }]
  },
  {
    id: 'MACD', label: 'MACD', category: 'trend',
    description: 'Moving Average Convergence Divergence',
    separatePane: true,
    params: [
      { key: 'fast', label: 'Fast', default: 12, min: 2, max: 500, step: 1 },
      { key: 'slow', label: 'Slow', default: 26, min: 2, max: 500, step: 1 },
      { key: 'signal', label: 'Signal', default: 9, min: 2, max: 500, step: 1 },
    ]
  },
  {
    id: 'BOLL', label: 'Bollinger Bands', category: 'volatility',
    description: 'Bollinger Bands',
    separatePane: false,
    params: [
      { key: 'period', label: 'Period', default: 20, min: 2, max: 500, step: 1 },
      { key: 'stdDev', label: 'Std Dev', default: 2, min: 1, max: 10, step: 0.5 }
    ]
  },
  {
    id: 'SAR', label: 'Parabolic SAR', category: 'trend',
    description: 'Stop and Reverse',
    separatePane: false,
    params: []
  },
  // --- OSCILLATORS ---
  {
    id: 'RSI', label: 'RSI', category: 'momentum',
    description: 'Relative Strength Index',
    separatePane: true,
    params: [{ key: 'period', label: 'Period', default: 14, min: 2, max: 500, step: 1 }]
  },
  {
    id: 'KDJ', label: 'KDJ', category: 'momentum',
    description: 'KDJ Stochastic Oscillator',
    separatePane: true,
    params: [
      { key: 'k', label: 'K', default: 9, min: 2, max: 500, step: 1 },
      { key: 'd', label: 'D', default: 3, min: 2, max: 500, step: 1 },
      { key: 'j', label: 'J', default: 3, min: 2, max: 500, step: 1 }
    ]
  },
  {
    id: 'CCI', label: 'CCI', category: 'momentum',
    description: 'Commodity Channel Index',
    separatePane: true,
    params: [{ key: 'period', label: 'Period', default: 20, min: 2, max: 500, step: 1 }]
  },
  {
    id: 'ATR', label: 'ATR', category: 'volatility',
    description: 'Average True Range',
    separatePane: true,
    params: [{ key: 'period', label: 'Period', default: 14, min: 2, max: 500, step: 1 }]
  },
  // --- VOLUME ---
  {
    id: 'VOL', label: 'Volume', category: 'volume',
    description: 'Trading Volume',
    separatePane: true,
    params: []
  },
  {
    id: 'OBV', label: 'OBV', category: 'volume',
    description: 'On Balance Volume',
    separatePane: true,
    params: []
  },
  {
    id: 'MFI', label: 'MFI', category: 'volume',
    description: 'Money Flow Index',
    separatePane: true,
    params: [{ key: 'period', label: 'Period', default: 14, min: 2, max: 500, step: 1 }]
  }
];

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
