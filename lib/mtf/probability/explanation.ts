// M7 — Probability explanation. PROB_MODEL_PRIORS is the permanent honesty
// signal while calibration is 'prior': these are model estimates, never measured
// frequencies. Spec §Explanation.

import type { OutcomeProbability, ProbabilitySignal } from './probabilityTypes';
import { PROB_THRESHOLDS } from './config';

export interface ExplainProbabilityContext {
  calibration: 'prior' | 'empirical';
  mostLikelyOutcome: OutcomeProbability;
  marketOutcomes: OutcomeProbability[];
}

const sig = (code: string, message: string, severity: ProbabilitySignal['severity']): ProbabilitySignal => ({ code, message, severity });

export function explainProbability(ctx: ExplainProbabilityContext): { signals: ProbabilitySignal[]; warnings: ProbabilitySignal[] } {
  const T = PROB_THRESHOLDS;
  const signals: ProbabilitySignal[] = [];
  const warnings: ProbabilitySignal[] = [];

  if (ctx.calibration === 'prior')
    signals.push(sig('PROB_MODEL_PRIORS', 'Estimates from model priors, not measured frequencies.', 'info'));
  if (ctx.mostLikelyOutcome.probability >= T.highConviction)
    signals.push(sig('PROB_HIGH_CONVICTION', `High conviction: ${ctx.mostLikelyOutcome.outcome}.`, 'strong'));

  if (ctx.mostLikelyOutcome.probability < T.uncertain)
    warnings.push(sig('PROB_UNCERTAIN', 'No outcome is clearly favored.', 'warning'));
  const adverse = ctx.marketOutcomes
    .filter((o) => o.outcome === 'reversal' || o.outcome === 'false_breakout')
    .reduce((m, o) => Math.max(m, o.probability), 0);
  if (adverse >= T.reversalElevated)
    warnings.push(sig('PROB_REVERSAL_ELEVATED', 'Reversal / false-breakout probability is elevated.', 'warning'));

  return { signals, warnings };
}
