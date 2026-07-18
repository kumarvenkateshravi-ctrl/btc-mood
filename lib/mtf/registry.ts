// MTF Engine M0 — Indicator Registry. Holds the indicator roster in stable
// row order, evaluates it against one timeframe's candles, and composes a
// weighted 0–100 score. Pure and deterministic; with default (equal) weights
// the composite equals the legacy rounded mean, so behavior is unchanged.

import type { Candle } from '../types';
import {
  verdictOf,
  type IndicatorDefinition,
  type IndicatorEvaluation,
  type IndicatorSettingsMap,
  type IndicatorWeights,
} from './types';
import type { IndicatorResult } from './intelligence';

export interface EvaluateOptions {
  weights?: IndicatorWeights;
  /** Per-indicator custom settings; unknown ids and no-input indicators are ignored. */
  settings?: IndicatorSettingsMap;
}
import { DEFAULT_INDICATORS } from './definitions';

const isValidWeight = (w: number) => Number.isFinite(w) && w > 0;

export class IndicatorRegistry {
  private defs = new Map<string, IndicatorDefinition>();

  register(def: IndicatorDefinition): void {
    if (this.defs.has(def.id)) throw new Error(`Indicator '${def.id}' is already registered`);
    if (!isValidWeight(def.defaultWeight)) {
      throw new Error(`Indicator '${def.id}' has invalid defaultWeight ${def.defaultWeight}`);
    }
    this.defs.set(def.id, def);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  get(id: string): IndicatorDefinition | undefined {
    return this.defs.get(id);
  }

  /** Definitions in registration (row) order. */
  list(): IndicatorDefinition[] {
    return [...this.defs.values()];
  }

  private resolveWeights(weights?: IndicatorWeights): Map<string, number> {
    if (weights) {
      for (const [id, w] of Object.entries(weights)) {
        if (!this.defs.has(id)) throw new Error(`Weight override for unregistered indicator '${id}'`);
        if (!isValidWeight(w)) throw new Error(`Invalid weight ${w} for indicator '${id}'`);
      }
    }
    return new Map(this.list().map((d) => [d.id, weights?.[d.id] ?? d.defaultWeight]));
  }

  /** Evaluate every registered indicator; empty candles score neutral (50). */
  evaluate(candles: Candle[], opts?: EvaluateOptions): IndicatorResult[] {
    const resolved = this.resolveWeights(opts?.weights);
    return this.list().map((d) => {
      const ev: IndicatorEvaluation =
        candles.length === 0 ? { score: 50, display: '—' } : d.evaluate(candles, opts?.settings?.[d.id]);
      return {
        id: d.id,
        category: d.category,
        score: ev.score,
        display: ev.display,
        verdict: verdictOf(ev.score),
        confidence: ev.confidence ?? ev.score,
        strength: ev.strength ?? ev.score,
        diagnostics: ev.diagnostics ?? {},
        signals: ev.signals ?? [],
        warnings: ev.warnings ?? [],
        weight: resolved.get(d.id)!,
      };
    });
  }

  /** Weighted 0–100 composite of evaluated results (rounded). */
  compositeScore(results: IndicatorResult[], weights?: IndicatorWeights): number {
    if (results.length === 0) return 50;
    const resolved = weights ? this.resolveWeights(weights) : null;
    let sum = 0;
    let wSum = 0;
    for (const r of results) {
      const w = resolved?.get(r.id) ?? r.weight;
      sum += r.score * w;
      wSum += w;
    }
    return Math.round(sum / wSum);
  }
}

/** A fresh registry pre-loaded with the fixed seven-indicator roster. */
export function createDefaultRegistry(): IndicatorRegistry {
  const r = new IndicatorRegistry();
  for (const d of DEFAULT_INDICATORS) r.register(d);
  return r;
}
