// Market Context Engine — shared contracts. Pure types + defaults; no UI, no
// chart, no React, no store imports. Every weight/threshold lives in typed
// config (revisedMTF refinements 1-2, 12): the numbers here are DEFAULTS.

import type { Timeframe, Candle } from '../types';
import type { VdSignal } from '../indicators/vdEngine';

export type ContextState = 'bullish' | 'bearish' | 'neutral';

export interface ContextWeights {
  ema: number; supertrend: number; macd: number; rsi: number;
  adx: number; obv: number; volume: number;
}

export interface TimeframeWeights {
  '5m': number; '15m': number; '30m': number; '1h': number; '4h': number; '1d': number;
}

export interface ContextConfig {
  weights: ContextWeights;
  tfWeights: TimeframeWeights;
  /** Bias is neutral while |contextScore − 50| ≤ neutralBand (refinement 4). */
  neutralBand: number;
  /** Event scores (crosses/flips) decay toward 50 with this half-life in bars. */
  recencyHalfLifeBars: number;
  /** Higher timeframes whose weighted agreement gates decisions (refinement 3). */
  htfTfs: Timeframe[];
  htfFloor: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  weights: { ema: 25, supertrend: 20, macd: 15, rsi: 10, adx: 10, obv: 10, volume: 10 },
  tfWeights: { '5m': 5, '15m': 10, '30m': 10, '1h': 20, '4h': 25, '1d': 30 },
  neutralBand: 8,
  recencyHalfLifeBars: 10,
  htfTfs: ['4h', '1d'],
  htfFloor: 55,
};

/** Pluggable scorer (refinement 12): register new engines here — the Decision
 *  Engine never changes. Candles passed in are CLOSED bars only. */
export type ContextScoreProducer = (candles: Candle[], tf: Timeframe) => ContextIndicatorScore;

export interface ContextIndicatorScore {
  name: string;
  timeframe: Timeframe;
  state: ContextState;
  score: number;       // 0-100 directional strength; 50 = neutral
  confidence: number;  // 0-1 data sufficiency (warm-up, bars available)
  explanation: string;
}

export interface TfContext {
  tf: Timeframe;
  indicators: ContextIndicatorScore[];
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  contextScore: number;
  bias: ContextState;
  conflictScore: number; // 0-100 indicator disagreement (refinement 5)
  confidence: number;    // 0-100 agreement × data sufficiency (refinement 6)
}

export interface MarketContext {
  perTf: Partial<Record<Timeframe, TfContext | null>>;
  overallBias: ContextState;
  contextScore: number;   // TF-weighted cross-TF alignment, 0-100
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  htfAgreement: number;   // weighted htfTfs blend (no binary veto)
  conflictScore: number;
  confidence: number;
  confirmations: string[];
  warnings: string[];
  /** Unix seconds of the newest CLOSED bar considered (non-repaint anchor). */
  asOfTime: number;
}

// ---------------------------------------------------------------------------
// Decision engine contracts
// ---------------------------------------------------------------------------

export interface DecisionWeights {
  context: number; zone: number; trend: number; momentum: number;
  volume: number; risk: number; liquidity: number;
}

export interface DecisionConfig {
  weights: DecisionWeights;
  /** Zone weight scales with zone confidence inside this range (refinement 7);
   *  the remaining weights renormalize to fill 1 − zoneWeight. */
  zoneWeightRange: [number, number];
  minDecisionScore: number;
  htfFloor: number;
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  weights: { context: 30, zone: 25, trend: 15, momentum: 10, volume: 10, risk: 5, liquidity: 5 },
  zoneWeightRange: [0.20, 0.45],
  minDecisionScore: 65,
  htfFloor: 55,
};

export type SignalGrade = 'A+' | 'A' | 'B' | 'C' | 'D';
export type RiskProfile = 'low' | 'medium' | 'high';

export interface Decision {
  signal: VdSignal;
  decisionScore: number;
  grade: SignalGrade;
  riskProfile: RiskProfile;
  contextScore: number;
  htfAgreement: number;
  conflictScore: number;
  reasons: string[];
  warnings: string[];
}

/** WHY NOT (refinement 10): rejected candidates are explained, never dropped silently. */
export interface Rejection {
  signal: VdSignal;
  decisionScore: number;
  failedGates: string[];
}
