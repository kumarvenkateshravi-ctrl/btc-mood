import type { Candle } from './types';
import type { CustomIndicatorConfig, IndicatorComputeFn, IndicatorResult } from './indicatorFramework';
import type { IndicatorEvaluationContext } from './indicatorEvaluation';

export interface IncrementalIndicatorContext {
  config?: CustomIndicatorConfig;
  computedSources?: Record<string, (number | null)[]>;
  /** Caller-owned identity. Change it for settings, source-chain, symbol,
   * timeframe, or replay-session changes so the state is rebuilt. */
  identity?: string;
  evaluationContext?: IndicatorEvaluationContext;
}

export interface IncrementalIndicatorInstance {
  initialize(history: Candle[]): IndicatorResult;
  updateLast(formingBar: Candle): IndicatorResult;
  append(newClosedBar: Candle): IndicatorResult;
  rebuild(history: Candle[]): IndicatorResult;
  stats?: () => unknown;
}

export interface IncrementalIndicatorFactory {
  (args: {
    compute: IndicatorComputeFn;
    config?: CustomIndicatorConfig;
    computedSources?: Record<string, (number | null)[]>;
    identity?: string;
    evaluationContext?: IndicatorEvaluationContext;
  }): IncrementalIndicatorInstance;
}

export interface IncrementalIndicatorEngineOptions {
  compute: IndicatorComputeFn;
  incremental?: IncrementalIndicatorFactory;
}

/**
 * Small state machine around an optional incremental indicator implementation.
 * The existing full compute function remains the source of truth for initial
 * builds and every structural reset. Incremental adapters are only selected
 * when the candle prefix and caller identity prove that the update is safe.
 */
export class IncrementalIndicatorEngine {
  private readonly compute: IndicatorComputeFn;
  private readonly factory?: IncrementalIndicatorFactory;
  private instance?: IncrementalIndicatorInstance;
  private history: Candle[] = [];
  private result?: IndicatorResult;
  private identity: string | undefined;

  constructor(options: IncrementalIndicatorEngineOptions) {
    this.compute = options.compute;
    this.factory = options.incremental;
  }

  update(history: Candle[], context: IncrementalIndicatorContext = {}): IndicatorResult {
    const next = history.slice();
    const identityChanged = this.identity !== context.identity;
    const canIncrement = Boolean(this.factory && this.instance && this.result && !identityChanged);

    if (!canIncrement) {
      this.identity = context.identity;
      if (this.factory) {
        this.instance = this.factory({ compute: this.compute, config: context.config, computedSources: context.computedSources, identity: context.identity, evaluationContext: context.evaluationContext });
        this.result = this.instance.initialize(next);
      } else {
        this.instance = undefined;
        this.result = this.compute(next, context.config, context.computedSources, context.evaluationContext);
      }
      this.history = next;
      return this.result;
    }

    if (sameCandleSequence(this.history, next)) {
      return this.result!;
    }

    if (isLastBarUpdate(this.history, next)) {
      this.result = this.instance!.updateLast(next[next.length - 1]);
    } else if (isAppend(this.history, next)) {
      for (let i = this.history.length; i < next.length; i += 1) {
        this.result = this.instance!.append(next[i]);
      }
    } else {
      // Prepend, rewind, gaps, replacement of an earlier candle, and any
      // other structural change intentionally take the authoritative path.
      this.result = this.instance!.rebuild(next);
    }
    this.history = next;
    return this.result!;
  }

  stats(): unknown {
    return this.instance?.stats?.();
  }

  reset(): void {
    this.instance = undefined;
    this.history = [];
    this.result = undefined;
    this.identity = undefined;
  }
}

function sameCandleSequence(a: Candle[], b: Candle[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((candle, index) => candle.time === b[index].time && candleEquals(candle, b[index]));
}

function candleEquals(a: Candle, b: Candle): boolean {
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;
}

function isLastBarUpdate(previous: Candle[], next: Candle[]): boolean {
  if (previous.length === 0 || previous.length !== next.length) return false;
  if (previous.length === 1) return previous[0].time === next[0].time;
  for (let i = 0; i < previous.length - 1; i += 1) {
    if (previous[i].time !== next[i].time || !candleEquals(previous[i], next[i])) return false;
  }
  return previous.at(-1)!.time === next.at(-1)!.time;
}

function isAppend(previous: Candle[], next: Candle[]): boolean {
  if (next.length <= previous.length) return false;
  return previous.every((candle, index) => candle.time === next[index].time && candleEquals(candle, next[index]));
}
