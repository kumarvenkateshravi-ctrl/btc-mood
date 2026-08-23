import { toHeikinAshi } from './heikinAshi';
import { toRenko, type RenkoOptions } from './renko';
import type { Candle } from './types';

export type TransformOperation = 'initialize' | 'noop' | 'updateLast' | 'append' | 'rebuild';

export interface TransformStats {
  lastOperation: TransformOperation;
  initializes: number;
  updates: number;
  appends: number;
  rebuilds: number;
}

const initialStats = (): TransformStats => ({
  lastOperation: 'initialize',
  initializes: 0,
  updates: 0,
  appends: 0,
  rebuilds: 0,
});

function copyCandle(candle: Candle): Candle {
  return { ...candle };
}

function equalCandle(a: Candle | undefined, b: Candle | undefined): boolean {
  return a != null && b != null &&
    a.time === b.time && a.open === b.open && a.high === b.high &&
    a.low === b.low && a.close === b.close && a.volume === b.volume &&
    a.takerBuyVolume === b.takerBuyVolume;
}

// Live/history stores publish immutable candle arrays. The ordinary forming and
// append paths preserve existing prefix object identities; any new prefix is
// structural and takes the authoritative full rebuild.
function sameTail(snapshot: Candle | undefined, candles: Candle[]): boolean {
  return snapshot != null && candles.length > 0 && equalCandle(snapshot, candles[candles.length - 1]);
}

function sameSnapshot(snapshot: Candle | undefined, candle: Candle | undefined): boolean {
  return snapshot != null && equalCandle(snapshot, candle);
}

function isFormingUpdate(previous: Candle[], next: Candle[]): boolean {
  return next.length === previous.length && next.length > 0 &&
    next[0] === previous[0] && (next.length === 1 || next[next.length - 2] === previous[previous.length - 2]);
}

function isAppend(previous: Candle[], next: Candle[], previousTail: Candle | undefined): boolean {
  return next.length === previous.length + 1 && previous.length > 0 &&
    next[0] === previous[0] && next[previous.length - 1] === previous[previous.length - 1] &&
    sameSnapshot(previousTail, next[previous.length - 1]);
}

function updateStats(stats: TransformStats, operation: TransformOperation): void {
  stats.lastOperation = operation;
  if (operation === 'initialize') stats.initializes++;
  if (operation === 'updateLast') stats.updates++;
  if (operation === 'append') stats.appends++;
  if (operation === 'rebuild') stats.rebuilds++;
}

function nextHeikinAshi(source: Candle, previous: Candle | undefined): Candle {
  const close = (source.open + source.high + source.low + source.close) / 4;
  const open = previous ? (previous.open + previous.close) / 2 : (source.open + source.close) / 2;
  return {
    time: source.time,
    open,
    high: Math.max(source.high, open, close),
    low: Math.min(source.low, open, close),
    close,
    volume: source.volume,
  };
}

/**
 * Copy-on-write incremental HA transformer. A complete source comparison is
 * deliberately retained before using the fast paths: a history correction,
 * prepend, replay rewind, or source replacement must take the authoritative
 * full transform rather than reusing a stale recursive predecessor.
 */
export class IncrementalHeikinAshi {
  private source: Candle[] = [];
  private output: Candle[] = [];
  private lastSource: Candle | undefined;
  private readonly performance = initialStats();

  update(candles: Candle[]): Candle[] {
    if (this.source.length === 0 && this.output.length === 0) {
      return this.reset(candles, 'initialize');
    }
    if (sameTail(this.lastSource, candles) && (candles === this.source || isFormingUpdate(this.source, candles))) {
      updateStats(this.performance, 'noop');
      return this.output;
    }

    if (isFormingUpdate(this.source, candles)) {
      const previous = this.output.length > 1 ? this.output[this.output.length - 2] : undefined;
      this.output = [...this.output.slice(0, -1), nextHeikinAshi(candles[candles.length - 1], previous)];
      this.source = candles;
      this.lastSource = copyCandle(candles[candles.length - 1]);
      updateStats(this.performance, 'updateLast');
      return this.output;
    }

    if (isAppend(this.source, candles, this.lastSource)) {
      this.output = [...this.output, nextHeikinAshi(candles[candles.length - 1], this.output.at(-1))];
      this.source = candles;
      this.lastSource = copyCandle(candles[candles.length - 1]);
      updateStats(this.performance, 'append');
      return this.output;
    }

    return this.reset(candles, 'rebuild');
  }

  rebuild(candles: Candle[]): Candle[] {
    return this.reset(candles, this.source.length === 0 ? 'initialize' : 'rebuild');
  }

  stats(): Readonly<TransformStats> {
    return { ...this.performance };
  }

  private reset(candles: Candle[], operation: 'initialize' | 'rebuild'): Candle[] {
    this.source = candles;
    this.lastSource = candles.length > 0 ? copyCandle(candles[candles.length - 1]) : undefined;
    this.output = toHeikinAshi(candles);
    updateStats(this.performance, operation);
    return this.output;
  }
}

type RenkoDirection = -1 | 0 | 1;

interface TraditionalState {
  lastOpen: number;
  lastClose: number;
  direction: RenkoDirection;
}

function validCandle(candle: Candle | undefined): candle is Candle {
  return candle != null &&
    Number.isFinite(candle.time) && Number.isFinite(candle.open) && Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) && Number.isFinite(candle.close);
}

function fixedTraditionalOptions(options: RenkoOptions): boolean {
  return options.method === 'traditional' ||
    (options.method == null && !options.autoBrick && options.brickSize != null && Number.isFinite(options.brickSize) && options.brickSize > 0);
}

function renkoOptionsKey(options: RenkoOptions): string {
  return JSON.stringify({
    method: options.method ?? null,
    brickSize: options.brickSize ?? null,
    atrLength: options.atrLength ?? null,
    percentage: options.percentage ?? null,
    autoBrick: options.autoBrick ?? false,
  });
}

function pushBrick(out: Candle[], open: number, close: number, time: number): void {
  out.push({ time, open, close, high: Math.max(open, close), low: Math.min(open, close), volume: 0 });
}

function copyState(state: TraditionalState): TraditionalState {
  return { ...state };
}

function appendTraditionalSource(
  out: Candle[],
  state: TraditionalState,
  source: Candle,
  brick: number,
  candleInterval: number,
): void {
  const pending: Array<{ open: number; close: number }> = [];
  let safety = 0;
  while (safety++ < 10_000) {
    if (state.direction > 0) {
      if (source.close >= state.lastClose + brick) {
        const open = state.lastClose;
        state.lastOpen = open;
        state.lastClose = open + brick;
        pending.push({ open, close: state.lastClose });
      } else if (source.close <= state.lastClose - 2 * brick) {
        const open = state.lastOpen;
        state.lastClose = open - brick;
        state.lastOpen = open;
        state.direction = -1;
        pending.push({ open, close: state.lastClose });
      } else break;
    } else if (state.direction < 0) {
      if (source.close <= state.lastClose - brick) {
        const open = state.lastClose;
        state.lastOpen = open;
        state.lastClose = open - brick;
        pending.push({ open, close: state.lastClose });
      } else if (source.close >= state.lastClose + 2 * brick) {
        const open = state.lastOpen;
        state.lastClose = open + brick;
        state.lastOpen = open;
        state.direction = 1;
        pending.push({ open, close: state.lastClose });
      } else break;
    } else if (source.close >= state.lastClose + brick) {
      const open = state.lastClose;
      state.lastOpen = open;
      state.lastClose = open + brick;
      state.direction = 1;
      pending.push({ open, close: state.lastClose });
    } else if (source.close <= state.lastClose - brick) {
      const open = state.lastClose;
      state.lastOpen = open;
      state.lastClose = open - brick;
      state.direction = -1;
      pending.push({ open, close: state.lastClose });
    } else break;
  }

  for (let index = 0; index < pending.length; index++) {
    const timestamp = Math.round(source.time - candleInterval + ((index + 1) / pending.length) * candleInterval);
    const previousTime = out.length > 0 ? out[out.length - 1].time : 0;
    pushBrick(out, pending[index].open, pending[index].close, timestamp > previousTime ? timestamp : previousTime + 1);
  }
}

function formingBrick(out: Candle[], state: TraditionalState, source: Candle): Candle {
  const previousTime = out.length > 0 ? out[out.length - 1].time : source.time;
  const time = source.time > previousTime ? source.time : previousTime + 1;
  return {
    time,
    open: state.lastClose,
    close: source.close,
    high: Math.max(state.lastClose, source.close),
    low: Math.min(state.lastClose, source.close),
    volume: 0,
  };
}

/**
 * Checkpointed fixed/traditional Renko transformer. It snapshots the reducer
 * immediately before the current source candle, allowing the trailing ghost
 * and any completed bricks from that candle to be rebuilt without touching
 * completed history. ATR and percentage modes intentionally stay full-rebuild
 * because their brick size depends on the complete source history.
 */
export class IncrementalRenko {
  private source: Candle[] = [];
  private output: Candle[] = [];
  private lastSource: Candle | undefined;
  private optionsKey = '';
  private canIncrement = false;
  private brick = 0;
  private interval = 60;
  private completed: Candle[] = [];
  private currentState: TraditionalState | null = null;
  private stateBeforeLast: TraditionalState | null = null;
  private completedBeforeLast: Candle[] = [];
  private readonly performance = initialStats();

  update(candles: Candle[], options: RenkoOptions = {}): Candle[] {
    const key = renkoOptionsKey(options);
    if (this.source.length === 0 && this.output.length === 0) return this.reset(candles, options, 'initialize');
    if (key !== this.optionsKey || !fixedTraditionalOptions(options) || !candles.every(validCandle) || !this.canIncrement) {
      return this.reset(candles, options, 'rebuild');
    }
    if (sameTail(this.lastSource, candles) && (candles === this.source || isFormingUpdate(this.source, candles))) {
      updateStats(this.performance, 'noop');
      return this.output;
    }
    if (isFormingUpdate(this.source, candles)) {
      return this.updateLast(candles);
    }
    if (isAppend(this.source, candles, this.lastSource)) {
      return this.append(candles);
    }
    return this.reset(candles, options, 'rebuild');
  }

  rebuild(candles: Candle[], options: RenkoOptions = {}): Candle[] {
    return this.reset(candles, options, this.source.length === 0 ? 'initialize' : 'rebuild');
  }

  stats(): Readonly<TransformStats> {
    return { ...this.performance };
  }

  private updateLast(candles: Candle[]): Candle[] {
    if (!this.stateBeforeLast) return this.reset(candles, { method: 'traditional', brickSize: this.brick }, 'rebuild');
    const completed = this.completedBeforeLast.slice();
    const state = copyState(this.stateBeforeLast);
    if (candles.length > 1) appendTraditionalSource(completed, state, candles[candles.length - 1], this.brick, this.interval);
    this.commit(candles, completed, state, this.stateBeforeLast, this.completedBeforeLast, 'updateLast');
    return this.output;
  }

  private append(candles: Candle[]): Candle[] {
    if (!this.currentState) return this.reset(candles, { method: 'traditional', brickSize: this.brick }, 'rebuild');
    const beforeLast = copyState(this.currentState);
    const completedBeforeLast = this.completed.slice();
    const completed = completedBeforeLast.slice();
    const state = copyState(beforeLast);
    appendTraditionalSource(completed, state, candles[candles.length - 1], this.brick, this.interval);
    this.commit(candles, completed, state, beforeLast, completedBeforeLast, 'append');
    return this.output;
  }

  private reset(candles: Candle[], options: RenkoOptions, operation: 'initialize' | 'rebuild'): Candle[] {
    this.source = candles;
    this.lastSource = candles.length > 0 ? copyCandle(candles[candles.length - 1]) : undefined;
    this.optionsKey = renkoOptionsKey(options);
    this.canIncrement = fixedTraditionalOptions(options) && candles.length > 0 && candles.every(validCandle);
    if (!this.canIncrement) {
      this.output = toRenko(candles, options);
      this.completed = [];
      this.currentState = null;
      this.stateBeforeLast = null;
      this.completedBeforeLast = [];
      updateStats(this.performance, operation);
      return this.output;
    }

    this.brick = options.brickSize != null && Number.isFinite(options.brickSize) && options.brickSize > 0
      ? options.brickSize
      : Math.max(0.0001, candles[0].close * 0.01);
    this.interval = candles.length >= 2 ? candles[1].time - candles[0].time : 60;
    const gridStart = Math.floor(candles[0].close / this.brick) * this.brick;
    const state: TraditionalState = { lastOpen: gridStart, lastClose: gridStart, direction: 0 };
    const completed: Candle[] = [];
    pushBrick(completed, gridStart, gridStart, candles[0].time - 1);
    for (let index = 1; index < candles.length - 1; index++) {
      appendTraditionalSource(completed, state, candles[index], this.brick, this.interval);
    }
    const beforeLast = copyState(state);
    const completedBeforeLast = completed.slice();
    if (candles.length > 1) appendTraditionalSource(completed, state, candles[candles.length - 1], this.brick, this.interval);
    this.commit(candles, completed, state, beforeLast, completedBeforeLast, operation);
    return this.output;
  }

  private commit(
    candles: Candle[],
    completed: Candle[],
    state: TraditionalState,
    beforeLast: TraditionalState,
    completedBeforeLast: Candle[],
    operation: TransformOperation,
  ): void {
    this.source = candles;
    this.lastSource = candles.length > 0 ? copyCandle(candles[candles.length - 1]) : undefined;
    this.completed = completed;
    this.currentState = copyState(state);
    this.stateBeforeLast = copyState(beforeLast);
    this.completedBeforeLast = completedBeforeLast;
    this.output = [...completed, formingBrick(completed, state, candles[candles.length - 1])];
    updateStats(this.performance, operation);
  }
}
