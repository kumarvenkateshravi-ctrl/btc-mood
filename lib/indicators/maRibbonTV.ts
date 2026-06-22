/**
 * Moving Average Ribbon — port of the TradingView built-in PineScript indicator.
 *
 * //@version=6
 * indicator("Moving Average Ribbon", shorttitle="MA Ribbon", overlay=true)
 *
 * Four individually-togglable MAs, each with:
 *   - type: SMA | EMA | SMMA (RMA) | WMA | VWMA
 *   - source: close (only; VWMA uses volume automatically)
 *   - length: configurable
 *   - default colors matching TV: #f6c309 / #fb9800 / #fb6500 / #f60c0c
 *
 * No buy/sell signals are emitted (pure overlay, just like the original).
 */

import * as pm from '../pineMath';
import type { Candle } from '../types';
import type { IndicatorResult, CustomIndicatorConfig } from '../indicatorFramework';
import { neutralSignals, resolveInputs } from './itsTemplates';

type MAType = 'SMA' | 'EMA' | 'SMMA (RMA)' | 'WMA' | 'VWMA';

export interface MaRibbonTVInputs {
  showMa1: boolean;
  ma1Type: MAType;
  ma1Length: number;
  showMa2: boolean;
  ma2Type: MAType;
  ma2Length: number;
  showMa3: boolean;
  ma3Type: MAType;
  ma3Length: number;
  showMa4: boolean;
  ma4Type: MAType;
  ma4Length: number;
}

const DEFAULTS: MaRibbonTVInputs = {
  showMa1: true,  ma1Type: 'SMA', ma1Length: 20,
  showMa2: true,  ma2Type: 'SMA', ma2Length: 50,
  showMa3: true,  ma3Type: 'SMA', ma3Length: 100,
  showMa4: true,  ma4Type: 'SMA', ma4Length: 200,
};

/** TV default colors, matching the PineScript hex values. */
const COLORS = ['#f6c309', '#fb9800', '#fb6500', '#f60c0c'] as const;

/**
 * Compute one MA series. Returns (number | null)[] aligned to `n` bars.
 * VWMA uses candle volume; all others use close prices.
 */
function computeMA(
  closes: number[],
  volumes: number[],
  length: number,
  type: MAType,
): (number | null)[] {
  switch (type) {
    case 'SMA':        return pm.sma(closes, length);
    case 'EMA':        return pm.ema(closes, length);
    case 'SMMA (RMA)': return pm.rma(closes, length);
    case 'WMA':        return pm.wma(closes, length);
    case 'VWMA':       return pm.vwma(closes, volumes, length);
    default:           return new Array(closes.length).fill(null);
  }
}

export function computeMaRibbonTV(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const inputs = resolveInputs<MaRibbonTVInputs>(config, DEFAULTS);
  const n = candles.length;
  const closes  = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const mas: { show: boolean; type: MAType; length: number; label: string; color: string }[] = [
    { show: Boolean(inputs.showMa1), type: inputs.ma1Type, length: Number(inputs.ma1Length), label: 'MA #1', color: COLORS[0] },
    { show: Boolean(inputs.showMa2), type: inputs.ma2Type, length: Number(inputs.ma2Length), label: 'MA #2', color: COLORS[1] },
    { show: Boolean(inputs.showMa3), type: inputs.ma3Type, length: Number(inputs.ma3Length), label: 'MA #3', color: COLORS[2] },
    { show: Boolean(inputs.showMa4), type: inputs.ma4Type, length: Number(inputs.ma4Length), label: 'MA #4', color: COLORS[3] },
  ];

  const plots = mas.map((m, idx) => ({
    id:        `ma_${idx + 1}`,
    title:     `${m.label} (${m.type} ${m.length})`,
    color:     m.color,
    type:      'line' as const,
    pane:      'overlay' as const,
    lineWidth: 2 as const,
    data:      m.show && m.length >= 1
      ? computeMA(closes, volumes, m.length, m.type)
      : new Array<null>(n).fill(null),
  }));

  return { plots, signals: neutralSignals(n) };
}
