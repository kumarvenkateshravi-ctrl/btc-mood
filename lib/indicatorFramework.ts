import type { Candle } from './types';

export type SignalSide = 'buy' | 'sell' | 'neutral';

export interface IndicatorInputDef {
  id: string;
  name: string;
  type: 'number' | 'boolean' | 'select' | 'source';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
  group?: string; // e.g. "SMOOTHING"
  tooltip?: string;
  disabledIf?: (inputs: Record<string, any>) => boolean;
}

export interface IndicatorStyleDef {
  id: string;
  name: string;
  color: string;
  thickness: 1 | 2 | 3 | 4;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  display: boolean;
}

export interface IndicatorSettings {
  inputs: Record<string, any>;
  styles: Record<string, { color: string; thickness: number; lineStyle: string; display: boolean }>;
  visibility: Record<string, boolean>; // e.g., 'minutes': true, 'hours': true
}

export interface IndicatorPlot {
  id: string;
  title: string;
  color: string;
  type: 'line' | 'band' | 'histogram';
  // Arrays mapping 1-to-1 with candles.
  // For 'line', array of number | { value: number; color: string } | null.
  // For 'histogram', array of number | { value: number; color: string } | null.
  // For 'band', array of { upper: number; lower: number } | null.
  data: (number | { value: number; color: string } | { upper: number; lower: number } | null)[];
  lineWidth?: number;
  /**
   * Optional pane routing:
   *   - 'overlay' (default): same price scale as the candle chart
   *   - 'separate': dedicated pane below the candles (matches PineScript
   *     `overlay=false`)
   */
  pane?: 'overlay' | 'separate';
}

export interface IndicatorResult {
  plots: IndicatorPlot[];
  // Buy/Sell/Neutral status per candle
  signals: SignalSide[];
}

export interface CustomIndicatorConfig {
  id: string;
  settings?: IndicatorSettings;
}

// Function signature that all PineScript translations will follow
export type IndicatorComputeFn = (candles: Candle[], config?: CustomIndicatorConfig) => IndicatorResult;
