// M5 — Market Regime engine (per timeframe, STATIONARY). Classifies one
// timeframe's character from its M2 trend + volatility categories only. Cross-TF
// interpretations (pullback/transition/reversal) belong to the hierarchy engine.
// Spec §Market Regime engine.

import type { CategoryResult } from '../categoryTypes';
import { clamp } from '../indicators/shared';
import type { RegimeResult, RegimeType, TimeframeSignal } from './timeframeTypes';
import { REGIME_THRESHOLDS } from './config';

export function classifyRegime(trend: CategoryResult, volatility: CategoryResult): RegimeResult {
  const trendStrong = trend.strength >= REGIME_THRESHOLDS.trendStrong;
  const direction = trend.verdict;
  const volStrong = volatility.strength >= REGIME_THRESHOLDS.volHigh;
  const volState = volatility.state;

  let regime: RegimeType;
  let clarity: number;
  if (trendStrong && direction === 'bullish') { regime = 'trending_up'; clarity = trend.strength; }
  else if (trendStrong && direction === 'bearish') { regime = 'trending_down'; clarity = trend.strength; }
  else if (volState === 'expanding' || volStrong) { regime = 'expansion'; clarity = volatility.strength; }
  else if (volState === 'compressed') { regime = 'compression'; clarity = volatility.strength; }
  else { regime = 'ranging'; clarity = 100 - trend.strength; }

  const signals: TimeframeSignal[] = [
    { code: `REGIME_${regime.toUpperCase()}`, message: `Timeframe regime: ${regime}.`, severity: 'info' },
  ];
  return {
    schemaVersion: 1,
    regime,
    clarity: clamp(Math.round(clarity), 0, 100),
    diagnostics: { trendStrength: trend.strength, volatility: volatility.strength, direction },
    signals,
  };
}
