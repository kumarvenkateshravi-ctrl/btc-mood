// M6 — Expectation engine. Deterministic forward map: current stage → expected
// next stage + a human rationale. Continuation is the one exhaustion-aware branch
// (a continuing trend either cycles into another pullback or starts exhausting).
// Spec §Expectation engine.

import { LIFECYCLE_THRESHOLDS } from './config';
import type { TrendStage } from './lifecycleTypes';

const RATIONALE: Record<Exclude<TrendStage, 'continuation'>, string> = {
  accumulation: 'Range compression typically resolves into a directional breakout.',
  breakout: 'A breakout typically needs confirmation before the trend is established.',
  confirmation: 'Confirmed breakouts typically evolve into an established trend.',
  trend_establishment: 'Established trends typically pull back before continuing.',
  healthy_pullback: 'Healthy pullbacks typically resolve into trend continuation.',
  exhaustion: 'Exhausted trends typically transition into distribution.',
  distribution: 'Distribution typically precedes a reversal.',
  reversal: 'Reversals typically settle into a new accumulation phase.',
  range: 'Ranging markets typically resolve into a breakout.',
};

const NEXT: Record<Exclude<TrendStage, 'continuation'>, TrendStage> = {
  accumulation: 'breakout', breakout: 'confirmation', confirmation: 'trend_establishment',
  trend_establishment: 'healthy_pullback', healthy_pullback: 'continuation',
  exhaustion: 'distribution', distribution: 'reversal', reversal: 'accumulation', range: 'breakout',
};

export function expectNext(stage: TrendStage, exhaustion: number): { expected: TrendStage; rationale: string } {
  if (stage === 'continuation') {
    return exhaustion >= LIFECYCLE_THRESHOLDS.exhaustHigh
      ? { expected: 'exhaustion', rationale: 'Continuation with high momentum exhaustion typically signals the trend is nearing exhaustion.' }
      : { expected: 'healthy_pullback', rationale: 'Continuation without exhaustion typically cycles back into another pullback.' };
  }
  return { expected: NEXT[stage], rationale: RATIONALE[stage] };
}
