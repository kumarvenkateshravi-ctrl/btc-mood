// MTF Intelligence UI (Phase 1) — pure aggregator. Distills the frozen M2–M5
// stack into one board object for the Custom MTF page, plus a deterministic,
// READ-ONLY trade-context mapping (a presentation bridge, NOT a decision engine —
// M9 owns decisions). No engine changes. Closed-bar only.
// Spec: docs/superpowers/specs/2026-07-19-mtf-intelligence-ui-phase1-design.md

import type { Candle, Timeframe } from '../types';
import { createDefaultRegistry } from './registry';
import { computeCategoryIntelligence } from './categoryEngine';
import type { CategoryResult } from './categoryTypes';
import { computeAgreement } from './agreement/agreementEngine';
import type { AgreementResult } from './agreement/agreementTypes';
import { computeConfidence } from './confidence/confidenceEngine';
import type { ConfidenceResult } from './confidence/confidenceTypes';
import { buildTimeframeSnapshots } from './timeframe/snapshots';
import { computeTimeframeHierarchy } from './timeframe/hierarchy';
import { tfWeight } from './timeframe/config';
import type { HierarchyResult, OverallMarketState, TimeframeSnapshot } from './timeframe/timeframeTypes';

export interface MarketIntelligenceBoard {
  hierarchy: HierarchyResult;
  snapshots: TimeframeSnapshot[];
  selected: { timeframe: Timeframe; agreement: AgreementResult; confidence: ConfidenceResult; categories: CategoryResult[] } | null;
}

/** Drop the still-forming last bar (closed-bar determinism). */
const closed = (c: Candle[]): Candle[] => (c.length > 1 ? c.slice(0, -1) : c);

export function computeMarketIntelligenceBoard(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  selectedTf: Timeframe,
): MarketIntelligenceBoard {
  const closedByTf: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, arr] of Object.entries(candlesByTf) as [Timeframe, Candle[]][]) {
    if (arr && arr.length) closedByTf[tf] = closed(arr);
  }

  const snapshots = buildTimeframeSnapshots(closedByTf);
  const hierarchy = computeTimeframeHierarchy(snapshots);

  let selected: MarketIntelligenceBoard['selected'] = null;
  const selCandles = closedByTf[selectedTf];
  if (selCandles && selCandles.length) {
    const indicators = createDefaultRegistry().evaluate(selCandles);
    const categories = Object.values(computeCategoryIntelligence(indicators).categories);
    const agreement = computeAgreement(indicators, categories);
    const confidence = computeConfidence(indicators, categories, agreement);
    selected = { timeframe: selectedTf, agreement, confidence, categories };
  }

  return { hierarchy, snapshots, selected };
}

export interface TradeContext {
  overallMarketState: OverallMarketState;
  controller: Timeframe;
  executionTf: Timeframe;
  opportunity: string;
  action: string;
  risk: 'Low' | 'Medium' | 'High';
}

/** Deterministic read-only mapping — presentation only, not trading advice. */
const STATE_CONTEXT: Record<OverallMarketState, { opportunity: string; action: string }> = {
  bullish_continuation: { opportunity: 'Trend Continuation', action: 'Favor Longs With Trend' },
  bearish_continuation: { opportunity: 'Trend Continuation', action: 'Favor Shorts With Trend' },
  bullish_pullback: { opportunity: 'Trend Pullback', action: 'Wait For Continuation' },
  bearish_pullback: { opportunity: 'Trend Pullback', action: 'Wait For Continuation' },
  bullish_transition: { opportunity: 'Developing Bullish Bias', action: 'Wait For Confirmation' },
  bearish_transition: { opportunity: 'Developing Bearish Bias', action: 'Wait For Confirmation' },
  reversal_risk: { opportunity: 'Possible Reversal', action: 'Reduce Exposure / Wait' },
  range_bound: { opportunity: 'Range', action: 'Fade Extremes / Stand Aside' },
  compression: { opportunity: 'Compression', action: 'Await Expansion' },
  expansion: { opportunity: 'Expansion / Volatility', action: 'Trade With Caution' },
};

export function deriveTradeContext(hierarchy: HierarchyResult, confidence: number): TradeContext {
  const { overallMarketState, controller, conflict } = hierarchy;
  const map = STATE_CONTEXT[overallMarketState];

  const entries = Object.values(hierarchy.perTimeframe).filter((e): e is NonNullable<typeof e> => !!e);
  const triggers = entries.filter((e) => e.role === 'trigger');
  let executionTf: Timeframe;
  if (triggers.length) executionTf = triggers.reduce((b, e) => (e.authority > b.authority ? e : b)).timeframe;
  else if (entries.length) executionTf = entries.reduce((b, e) => (tfWeight(e.timeframe) < tfWeight(b.timeframe) ? e : b)).timeframe;
  else executionTf = controller;

  let risk: TradeContext['risk'] = confidence >= 70 && conflict < 30 ? 'Low' : confidence >= 45 ? 'Medium' : 'High';
  if ((overallMarketState === 'reversal_risk' || overallMarketState === 'expansion') && risk === 'Low') risk = 'Medium';

  return { overallMarketState, controller, executionTf, opportunity: map.opportunity, action: map.action, risk };
}
