// M6 — Lifecycle explanation. Generic codes; component names (the controller TF,
// the invalidation condition) are interpolated from data. Spec §Explanation.

import type { Timeframe } from '../../types';
import type { OverallMarketState } from '../timeframe/timeframeTypes';
import type { LifecycleSignal, TrendStage } from './lifecycleTypes';
import { LIFECYCLE_THRESHOLDS } from './config';

export interface ExplainLifecycleContext {
  timeframe: Timeframe;
  stage: TrendStage;
  invalidation: { invalidated: boolean; condition: string | null };
  overallMarketState: OverallMarketState;
  exhaustion: number;
}

const sig = (code: string, message: string, severity: LifecycleSignal['severity']): LifecycleSignal => ({ code, message, severity });

export function explainLifecycle(ctx: ExplainLifecycleContext): { signals: LifecycleSignal[]; warnings: LifecycleSignal[] } {
  const signals: LifecycleSignal[] = [];
  const warnings: LifecycleSignal[] = [];

  if (ctx.stage === 'breakout') signals.push(sig('LC_BREAKOUT', `${ctx.timeframe} entering a breakout.`, 'strong'));
  if (ctx.stage === 'trend_establishment') signals.push(sig('LC_TREND', `${ctx.timeframe} establishing a trend.`, 'info'));
  if (ctx.stage === 'continuation') signals.push(sig('LC_CONTINUATION', `${ctx.timeframe} continuing its trend.`, 'info'));
  if (ctx.stage === 'exhaustion') signals.push(sig('LC_EXHAUSTION', `${ctx.timeframe} showing momentum exhaustion.`, 'strong'));

  if (ctx.invalidation.invalidated) warnings.push(sig('LC_INVALIDATION', `Lifecycle invalidated: ${ctx.invalidation.condition}.`, 'warning'));
  if (ctx.overallMarketState === 'reversal_risk') warnings.push(sig('LC_REVERSAL_RISK', 'Reversal risk in the current market state.', 'warning'));
  if (ctx.exhaustion >= LIFECYCLE_THRESHOLDS.exhaustHigh) warnings.push(sig('LC_EXHAUSTION_WARN', 'Momentum exhaustion elevated.', 'warning'));

  return { signals, warnings };
}
