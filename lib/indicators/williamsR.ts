import { highest, lowest } from '../pineMath';
import type { Candle } from '../types';
import type { IndicatorResult, CustomIndicatorConfig } from '../indicatorFramework';
import { neutralSignals, resolveInputs, resolveSourceNum } from './itsTemplates';

export interface WilliamsRInputs {
  length: number;
  source: 'close' | 'open' | 'high' | 'low';
}

const DEFAULTS: WilliamsRInputs = {
  length: 14,
  source: 'close',
};

export function computeWilliamsR(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  computedSources?: Record<string, (number | null)[]>
): IndicatorResult {
  const inputs = resolveInputs<WilliamsRInputs>(config, DEFAULTS);
  const length = Number(inputs.length);
  const srcKey = inputs.source;
  
  const src = resolveSourceNum(candles, srcKey, computedSources);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  
  const n = candles.length;
  const resultData = new Array<number | null>(n).fill(null);
  
  const maxArr = highest(highs, length);
  const minArr = lowest(lows, length);
  
  for (let i = 0; i < n; i++) {
    const max = maxArr[i];
    const min = minArr[i];
    const s = src[i];
    if (max !== null && min !== null && s !== undefined && max !== min) {
      resultData[i] = 100 * (s - max) / (max - min);
    } else if (max !== null && min !== null && max === min) {
      resultData[i] = 0; // Avoid division by zero
    }
  }

  // Styles are handled dynamically via config in the TV style
  const styles = config?.settings?.styles || {};
  
  const rColor = styles['percentR']?.color ?? '#7E57C2';
  const rLineWidth = styles['percentR']?.thickness ?? 2;
  const showR = styles['percentR']?.display !== false;

  const upperVal = styles['upperBand']?.value ?? -20;
  const upperColor = styles['upperBand']?.color ?? '#787B86';
  const showUpper = styles['upperBand']?.display !== false;
  const upperDash = styles['upperBand']?.lineStyle ?? 'solid';

  const midVal = styles['middleLevel']?.value ?? -50;
  const midColor = styles['middleLevel']?.color ?? '#787B86';
  const showMid = styles['middleLevel']?.display !== false;
  const midDash = styles['middleLevel']?.lineStyle ?? 'dotted';

  const lowerVal = styles['lowerBand']?.value ?? -80;
  const lowerColor = styles['lowerBand']?.color ?? '#787B86';
  const showLower = styles['lowerBand']?.display !== false;
  const lowerDash = styles['lowerBand']?.lineStyle ?? 'solid';

  const bgCol = styles['background']?.color ?? 'rgba(126, 87, 194, 0.1)';
  const showBg = styles['background']?.display !== false;

  return {
    plots: [
      {
        id: 'percentR',
        title: '%R',
        color: rColor,
        type: 'line',
        pane: 'separate',
        lineWidth: rLineWidth,
        data: showR ? resultData : new Array(n).fill(null),
      }
    ],
    signals: neutralSignals(n),
    levels: [
      ...(showUpper ? [{ value: upperVal, color: upperColor, lineStyle: upperDash as any, lineWidth: styles['upperBand']?.thickness || 1 }] : []),
      ...(showMid ? [{ value: midVal, color: midColor, lineStyle: midDash as any, lineWidth: styles['middleLevel']?.thickness || 1 }] : []),
      ...(showLower ? [{ value: lowerVal, color: lowerColor, lineStyle: lowerDash as any, lineWidth: styles['lowerBand']?.thickness || 1 }] : [])
    ],
    fills: showBg && showUpper && showLower ? [
      { from: upperVal, to: lowerVal, color: bgCol }
    ] : undefined,
  };
}
