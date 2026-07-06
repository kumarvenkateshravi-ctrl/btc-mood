// Technical Scanner — shared contracts (ARCHITECTURE FROZEN, rev. 3).
// Rules: deterministic closed-bar only · one source of truth · append-only
// events · immutable history. Pure types; no UI/chart/store imports.

import type { Timeframe, Candle } from '../types';
import type { IndicatorInputDef } from '../indicatorFramework';

export type Series = (number | null)[];
export type SourceGroup = 'standard' | 'structure' | 'intelligence';

export type OperatorId =
  | 'gt' | 'lt' | 'gte' | 'lte' | 'between'
  | 'crossAbove' | 'crossBelow' | 'increasing' | 'decreasing';

export type OperandKind = 'series' | 'number' | 'range';

/** A reference to one output series of a registered source. */
export interface SeriesRef {
  source: string;                              // registry id, e.g. 'ema'
  output: string;                              // e.g. 'value' | 'hist' | 'k'
  params?: Record<string, number | string>;    // e.g. { length: 20 }
}

export interface Condition {
  left: SeriesRef;
  op: OperatorId;
  right: SeriesRef | number | [number, number]; // series, constant, or between-range
  tf: Timeframe;                                // per-condition timeframe
}

export type GroupNode = { logic: 'AND' | 'OR'; children: Array<GroupNode | Condition> };
export const isCondition = (n: GroupNode | Condition): n is Condition => 'op' in n;

/** Versioned, marketplace-ready strategy (immutable versions — Rule 4). */
export interface ScannerStrategy {
  id: string;
  name: string;
  direction: 'long' | 'short';
  schemaVersion: 1;
  versions: Array<{
    v: number;
    createdAt: number;
    note: string;
    tree: GroupNode;
    performance?: unknown; // frozen VersionStats snapshot on supersede (S7)
  }>;
  activeVersion: number;
  enabled: boolean;
  archived: boolean; // never delete (Rule 4)
  exits: { slAtr: number; tp1R: number; tp2R: number; tp3R: number };
  // Marketplace-compatible now, unused until the community phase:
  ownerId: string | null;
  visibility: 'private' | 'public' | 'invite';
  createdAt: number;
  updatedAt: number;
  parentStrategy: string | null;
  forkCount: number;
  likes: number;
}

/** Registered source plugin — the builder/validator/evaluator are driven
 *  ENTIRELY by these definitions (registry, not switch statements). */
export interface ScannerSource {
  id: string;
  name: string;
  group: SourceGroup;
  params: IndicatorInputDef[];
  outputs: Array<{ id: string; label: string }>;
  operators: OperatorId[];
  tfs: Timeframe[];
  /** Cross-TF aggregates (Stack Score, Alignment) that only exist at the live
   *  edge in v1 — the validator warns they have no backtest coverage. */
  liveOnly?: boolean;
  series: (candles: Candle[], params: Record<string, number | string>, output: string) => Series;
}

/** Per-condition "Why?" snapshot stored on every signal (explainability). */
export interface ConditionSnapshot {
  label: string;       // "RSI(14) 15m"
  value: number | null;
  expect: string;      // "> 60" / "crossAbove EMA(50)"
  pass: boolean;
}
