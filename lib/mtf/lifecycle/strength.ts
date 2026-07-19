// M6 — Lifecycle Strength. How strongly the CURRENT stage is expressed — distinct
// from freshness (age) and exhaustion (overextension). Each stage group blends the
// signal(s) that best evidence its own expression. Spec §Lifecycle strength.

import { clamp } from '../indicators/shared';
import type { HierarchyResult, TimeframeSnapshot } from '../timeframe/timeframeTypes';
import type { TrendStage } from './lifecycleTypes';

export function lifecycleStrength(stage: TrendStage, s: TimeframeSnapshot, hier: HierarchyResult): number {
  let raw: number;
  switch (stage) {
    case 'breakout':
    case 'confirmation':
      raw = (s.trendFreshness + hier.alignment) / 2;
      break;
    case 'trend_establishment':
    case 'continuation':
      raw = (s.regimeClarity + hier.alignment + (100 - s.momentumExhaustion)) / 3;
      break;
    case 'healthy_pullback':
      raw = hier.controllerAuthority;
      break;
    case 'exhaustion':
    case 'distribution':
      raw = s.momentumExhaustion;
      break;
    case 'reversal':
      raw = hier.conflict;
      break;
    case 'accumulation':
    case 'range':
    default:
      raw = s.regimeClarity;
  }
  return Math.round(clamp(raw, 0, 100));
}
