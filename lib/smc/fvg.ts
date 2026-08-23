// Shared, policy-driven Fair Value Gap adapter for the SMC engine.
// The domain implementation lives in lib/fvg/domain.ts; this file only maps
// its lifecycle to the legacy SmcObject/event contract used by the UI/scorer.
import type { Candle } from '@/lib/types';
import type { IndicatorEvaluationContext } from '@/lib/indicatorEvaluation';
import { createFvgDomainEngine, type FvgDomainObject, type FvgPolicy } from '../fvg/domain';
import {
  type SmcConfig,
  type SmcEvent,
  type SmcObject,
  smcObjectId,
} from './types';

export interface FvgEngine {
  gaps: SmcObject[];
  onBar(i: number): void;
}

function mapLifecycle(state: FvgDomainObject['lifecycle']): SmcObject['state'] {
  if (state === 'partiallyMitigated') return 'partial';
  if (state === 'archived') return 'archived';
  return state;
}

export function smcFvgPolicy(cfg: SmcConfig, overrides: Partial<FvgPolicy> = {}): FvgPolicy {
  return {
    source: 'raw',
    requireClosedBars: true,
    threshold: { method: cfg.fvgAutoThreshold ? 'autoImpulse' : 'none', value: 0 },
    mitigation: 'wick',
    partialFill: 'track',
    mitigationTiming: 'afterCreation',
    requireImpulseThreshold: true,
    maxAgeBars: cfg.maxAgeBars,
    maxHistory: cfg.maxAgeBars,
    ...overrides,
  };
}
export function createFvgEngine(
  candles: Candle[],
  cfg: SmcConfig,
  events: SmcEvent[],
  context?: IndicatorEvaluationContext,
  policyOverrides: Partial<FvgPolicy> = {},
): FvgEngine {
  const raw = context?.rawCandles ?? candles;
  const source = context ? context.rawCandles : candles;
  const domain = createFvgDomainEngine(raw, {
    ...smcFvgPolicy(cfg, policyOverrides),
    sourceTimeframe: context?.timeframe,
    idFactory: (direction, index) => smcObjectId('fvg', undefined, direction, index),
  }, {
    hasFormingBar: Boolean(context?.hasFormingBar),
    rawCandles: raw,
    displayCandles: candles,
    symbol: context?.symbol,
    mode: context?.mode,
    sourceRevision: context?.sourceRevision,
    replay: context?.replay ? { sessionId: context.replay.sessionId, cutTime: context.replay.cutTime } : undefined,
  });
  const gaps: SmcObject[] = [];
  const byId = new Map<string, SmcObject>();

  function pushEvent(type: SmcEvent['type'], index: number, gap: SmcObject): void {
    const c = source[index] ?? candles[index];
    if (!c) return;
    events.push({
      id: `${type}_${index}_${gap.id}`,
      type,
      barIndex: index,
      time: c.time,
      direction: gap.direction,
      objectId: gap.id,
      price: gap.direction === 'bullish' ? gap.bottom : gap.top,
    });
  }

  function toSmc(g: FvgDomainObject): SmcObject {
    return {
      id: g.id,
      kind: 'fvg',
      direction: g.direction,
      top: g.top,
      bottom: g.bottom,
      createdAtBar: g.createdIndex,
      createdAtTime: g.createdTime,
      updatedAtBar: g.endIndex ?? g.createdIndex,
      state: mapLifecycle(g.lifecycle),
      touches: g.fillPercent,
      strength: 0,
      quality: 0,
      confidence: 0,
    };
  }

  return {
    gaps,
    onBar(index: number): void {
      const step = domain.onBar(index);
      for (const created of step.created) {
        const gap = toSmc(created);
        gaps.unshift(gap);
        byId.set(created.id, gap);
        pushEvent('FVG_CREATED', index, gap);
      }
      for (const filled of [...step.filled].reverse()) {
        const gap = byId.get(filled.id);
        if (!gap) continue;
        gap.state = mapLifecycle(filled.lifecycle);
        gap.touches = filled.fillPercent;
        gap.updatedAtBar = index;
        pushEvent('FVG_FILLED', index, gap);
      }
      // Partial/expiry updates are reflected in the same object references used
      // by the SMC scorer and overlay, without generating extra legacy events.
      for (const current of domain.gaps) {
        const gap = byId.get(current.id);
        if (!gap) continue;
        gap.state = mapLifecycle(current.lifecycle);
        gap.touches = current.fillPercent;
        gap.updatedAtBar = current.endIndex ?? (current.lifecycle === 'partiallyMitigated' ? index : gap.updatedAtBar);
      }
    },
  };
}