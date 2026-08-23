import type { Candle, Timeframe } from '../types';

/** The two immutable sources used by analytical indicators. */
export type FvgSource = 'raw' | 'display';
export type FvgMitigation = 'wick' | 'close';
export type FvgPartialFill = 'track' | 'mitigate-on-touch';
export type FvgLifecycle = 'active' | 'partiallyMitigated' | 'mitigated' | 'invalidated' | 'archived';
export type FvgDirection = 'bullish' | 'bearish';

export type FvgThresholdMethod = 'none' | 'percentGap' | 'autoRange' | 'autoImpulse';

export interface FvgPolicy {
  /** Analytical source. Raw is the default for structural indicators. */
  source: FvgSource;
  sourceTimeframe?: Timeframe | string;
  /** A persistent object can only be born from the closed prefix. */
  requireClosedBars: boolean;
  threshold: { method: FvgThresholdMethod; value: number };
  mitigation: FvgMitigation;
  partialFill: FvgPartialFill;
  /** Keep the existing consumer-specific expiry semantics explicit. */
  maxAgeBars?: number;
  maxHistory?: number;
  /** SMC checks fills after creation; the Pine module checks before creation. */
  mitigationTiming?: 'beforeCreation' | 'afterCreation';
  requireImpulseThreshold?: boolean;
  /** Optional stable id adapter for legacy consumers. */
  idFactory?: (direction: FvgDirection, formationIndex: number, formationTime: number) => string;
}

export interface FvgEvaluationOptions {
  hasFormingBar?: boolean;
  /** A context may provide raw candles without making the domain depend on the framework. */
  rawCandles?: Candle[];
  displayCandles?: Candle[];
  symbol?: string;
  mode?: 'live' | 'replay';
  sourceRevision?: string;
  replay?: { sessionId: string; cutTime: number };
}

export interface FvgDomainObject {
  id: string;
  direction: FvgDirection;
  top: number;
  bottom: number;
  createdIndex: number;
  createdTime: number;
  endIndex: number | null;
  lifecycle: FvgLifecycle;
  /** Worst penetration into the gap, 0–100. */
  fillPercent: number;
  /** Active means not fully mitigated/invalidated/expired. */
  active: boolean;
  source: FvgSource;
  sourceTimeframe?: string;
  provenance?: { symbol?: string; mode?: 'live' | 'replay'; sourceRevision?: string; replay?: { sessionId: string; cutTime: number } };
}

export interface FvgDomainStep {
  created: FvgDomainObject[];
  filled: FvgDomainObject[];
}

const finitePositive = (n: number): boolean => Number.isFinite(n) && n > 0;

function thresholdAt(
  candles: Candle[],
  i: number,
  policy: FvgPolicy,
  cumulative: { range: number; impulse: number },
): number {
  const method = policy.threshold.method;
  if (method === 'none') return 0;
  if (method === 'percentGap') return Math.max(0, policy.threshold.value) / 100;
  if (method === 'autoRange') return i > 0 ? cumulative.range / i : 0;
  return i > 0 ? (cumulative.impulse / i) * 2 : 0;
}

function penetration(gap: FvgDomainObject, candle: Candle, mitigation: FvgMitigation): number {
  const bull = gap.direction === 'bullish';
  const probe = mitigation === 'wick' ? (bull ? candle.low : candle.high) : candle.close;
  const size = gap.top - gap.bottom;
  if (!(size > 0)) return 0;
  const amount = bull ? gap.top - probe : probe - gap.bottom;
  return Math.max(0, Math.min(1, amount / size));
}

function fullyMitigated(gap: FvgDomainObject, candle: Candle, mitigation: FvgMitigation): boolean {
  const bull = gap.direction === 'bullish';
  const probe = mitigation === 'wick' ? (bull ? candle.low : candle.high) : candle.close;
  return bull ? probe < gap.bottom : probe > gap.top;
}

function sourceCandles(candles: Candle[], policy: FvgPolicy, options?: FvgEvaluationOptions): Candle[] {
  const selected = policy.source === 'raw' ? (options?.rawCandles ?? candles) : (options?.displayCandles ?? candles);
  const replayBounded = options?.replay ? selected.filter((c) => c.time <= options.replay!.cutTime) : selected;
  if (!policy.requireClosedBars || !options?.hasFormingBar) return replayBounded;
  return replayBounded.slice(0, Math.max(0, replayBounded.length - 1));
}

/**
 * One deterministic FVG implementation shared by SMC and MA/FVG.
 * The function is pure: callers can replay any prefix without future leakage.
 */
export function computeFvgDomain(
  candles: Candle[],
  policy: FvgPolicy,
  options?: FvgEvaluationOptions,
): FvgDomainObject[] {
  const engine = createFvgDomainEngine(candles, policy, options);
  for (let i = 0; i < sourceCandles(candles, policy, options).length; i++) engine.onBar(i);
  return engine.gaps;
}

export interface FvgDomainEngine {
  gaps: FvgDomainObject[];
  onBar(index: number): FvgDomainStep;
}

export function createFvgDomainEngine(
  candles: Candle[],
  policy: FvgPolicy,
  options?: FvgEvaluationOptions,
): FvgDomainEngine {
  const bars = sourceCandles(candles, policy, options);
  const gaps: FvgDomainObject[] = [];
  const cumulative = { range: 0, impulse: 0 };
  const defaultId = (direction: FvgDirection, index: number): string =>
    `fvg_${direction}_${index}`;

  function updateExisting(index: number): FvgDomainObject[] {
    const c = bars[index];
    const filled: FvgDomainObject[] = [];
    for (const gap of gaps) {
      if (!gap.active || index <= gap.createdIndex) continue;
      const pct = Math.round(penetration(gap, c, policy.mitigation) * 100);
      if (pct > gap.fillPercent) gap.fillPercent = pct;
      if (fullyMitigated(gap, c, policy.mitigation) ||
          (policy.partialFill === 'mitigate-on-touch' && pct > 0)) {
        gap.fillPercent = 100;
        gap.lifecycle = 'mitigated';
        gap.active = false;
        gap.endIndex = index;
        filled.push(gap);
      } else if (pct > 0) {
        gap.lifecycle = 'partiallyMitigated';
      }
      if (policy.maxAgeBars != null && index - gap.createdIndex > policy.maxAgeBars && gap.active) {
        gap.lifecycle = 'archived';
        gap.active = false;
      }
    }
    return filled;
  }

  function create(index: number): FvgDomainObject[] {
    if (index < 2) return [];
    const c = bars[index];
    const prev = bars[index - 1];
    const twoBack = bars[index - 2];
    if (!finitePositive(prev.open) || !finitePositive(twoBack.high) || !finitePositive(twoBack.low) ||
        !finitePositive(c.high) || !finitePositive(c.low)) return [];
    const delta = (prev.close - prev.open) / (prev.open * 100);
    const bullGap = c.low - twoBack.high;
    const bearGap = twoBack.low - c.high;
    const threshold = thresholdAt(bars, index, policy, cumulative);
    const result: FvgDomainObject[] = [];
    const bullImpulsePass = !policy.requireImpulseThreshold || delta > threshold;
    const bearImpulsePass = !policy.requireImpulseThreshold || -delta > threshold;
    if (bullGap > 0 && prev.close > twoBack.high && bullImpulsePass && bullGap / twoBack.high > threshold) {
      result.push({
        id: policy.idFactory?.('bullish', index, c.time) ?? defaultId('bullish', index),
        direction: 'bullish', top: c.low, bottom: twoBack.high,
        createdIndex: index, createdTime: c.time, endIndex: null,
        lifecycle: 'active', fillPercent: 0, active: true,
        source: policy.source, sourceTimeframe: policy.sourceTimeframe,
        provenance: { symbol: options?.symbol, mode: options?.mode, sourceRevision: options?.sourceRevision, replay: options?.replay },
      });
    } else if (bearGap > 0 && prev.close < twoBack.low && bearImpulsePass && bearGap / c.high > threshold) {
      result.push({
        id: policy.idFactory?.('bearish', index, c.time) ?? defaultId('bearish', index),
        direction: 'bearish', top: twoBack.low, bottom: c.high,
        createdIndex: index, createdTime: c.time, endIndex: null,
        lifecycle: 'active', fillPercent: 0, active: true,
        source: policy.source, sourceTimeframe: policy.sourceTimeframe,
        provenance: { symbol: options?.symbol, mode: options?.mode, sourceRevision: options?.sourceRevision, replay: options?.replay },
      });
    }
    return result;
  }

  return {
    gaps,
    onBar(index: number): FvgDomainStep {
      if (index < 0 || index >= bars.length) return { created: [], filled: [] };
      // Keep both historical threshold definitions explicit and deterministic.
      // Keep the two legacy auto-threshold definitions exact: MA/FVG averages
      // the current range, while SMC averages the preceding impulse bars only.
      const current = bars[index];
      if (finitePositive(current.low)) cumulative.range += (current.high - current.low) / current.low;
      if (index >= 2) {
        const prev = bars[index - 1];
        if (finitePositive(prev.open)) cumulative.impulse += Math.abs((prev.close - prev.open) / (prev.open * 100));
      }
      const before = policy.mitigationTiming !== 'afterCreation';
      const filledBefore = before ? updateExisting(index) : [];
      const created = create(index);
      for (const gap of created) {
        gaps.push(gap);
        if (policy.maxHistory != null) {
          while (gaps.length > policy.maxHistory) {
            const expired = gaps.shift();
            if (expired) { expired.lifecycle = 'archived'; expired.active = false; }
          }
        }
        // SMC's after-creation semantics deliberately do not consume this bar.
      }
      const filledAfter = before ? [] : updateExisting(index);
      return { created, filled: [...filledBefore, ...filledAfter] };
    },
  };
}

export const DEFAULT_FVG_POLICY: FvgPolicy = {
  source: 'raw',
  requireClosedBars: true,
  threshold: { method: 'none', value: 0 },
  mitigation: 'close',
  partialFill: 'track',
  maxAgeBars: 500,
  maxHistory: 500,
};
