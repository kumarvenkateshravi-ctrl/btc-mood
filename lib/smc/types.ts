// SMC Intelligence Engine — shared types, config, ids.
//
// Spec: docs/superpowers/specs/2026-07-11-smc-intelligence-engine-design.md
// Pine reference (frozen): LuxAlgo Smart Money Concepts (see spec header).
//
// Everything in lib/smc/ is headless and deterministic: no colors, no drawing,
// no module-level mutable state. Same input ⇒ identical output, including ids.

export const BULLISH = 1 as const;
export const BEARISH = -1 as const;
/** Trend bias: +1 bullish, -1 bearish, 0 none (pre-first-break). */
export type Bias = 1 | -1 | 0;

export type SmcDirection = 'bullish' | 'bearish';
export type SmcScope = 'swing' | 'internal';

/**
 * One lifecycle enum for every object kind; per-kind meaning:
 *  - orderBlock: active → tested (wick in) → partial (close in) → mitigated | invalidated → archived
 *  - fvg:        active → partial → mitigated (= filled) → archived
 *  - liquidityPool: active → mitigated (= swept) | invalidated (= true break) → archived
 *  - structureLevel: active → mitigated (= broken; produced the BOS/CHoCH) → archived
 *  - zone: always active (rebuilt every bar)
 */
export type SmcLifecycle = 'active' | 'tested' | 'partial' | 'mitigated' | 'invalidated' | 'archived';

export type SmcObjectKind = 'orderBlock' | 'fvg' | 'liquidityPool' | 'structureLevel' | 'zone';

export interface SmcObject {
  id: string;
  kind: SmcObjectKind;
  scope?: SmcScope;
  direction: SmcDirection;
  /** Price band; level objects use top === bottom. */
  top: number;
  bottom: number;
  createdAtBar: number;
  createdAtTime: number;
  updatedAtBar: number;
  state: SmcLifecycle;
  /** Times price traded into the band without mitigating it (FVG: worst fill %). */
  touches: number;
  /** Intrinsic, frozen at creation (impulse magnitude vs ATR). 0–100. */
  strength: number;
  /** Current condition: age decay, touches, fill. 0–100. */
  quality: number;
  /** Context: trend + zone + confluence agreement. 0–100. */
  confidence: number;
}

export type SmcEventType =
  | 'BOS'
  | 'CHOCH'
  | 'SWING_FORMED'
  | 'OB_CREATED'
  | 'OB_TESTED'
  | 'OB_MITIGATED'
  | 'FVG_CREATED'
  | 'FVG_FILLED'
  | 'EQH_FORMED'
  | 'EQL_FORMED'
  | 'LIQUIDITY_SWEEP'
  | 'ZONE_CHANGED';

export interface SmcEvent {
  /** `${type}_${barIndex}` (+ `_${scope}` when scoped) — deterministic. */
  id: string;
  type: SmcEventType;
  barIndex: number;
  time: number;
  direction: SmcDirection;
  scope?: SmcScope;
  /** Links the event to the object it created/updated. */
  objectId?: string;
  price: number;
}

/** Institutional score blend weights — configuration, never hardcoded in logic. */
export interface InstitutionalWeights {
  structure: number;
  liquidity: number;
  orderBlocks: number;
  fvg: number;
  premiumDiscount: number;
}

export interface SmcConfig {
  /** Algorithm version; bump to evolve detection without breaking old backtests. */
  version: string;
  // ---- LuxAlgo-parity inputs (defaults = script defaults) ----
  swingsLength: number;
  internalLength: number;
  eqLength: number;
  eqThreshold: number;
  obFilter: 'atr' | 'range';
  obMitigation: 'highlow' | 'close';
  maxInternalOrderBlocks: number;
  maxSwingOrderBlocks: number;
  fvgAutoThreshold: boolean;
  fvgExtend: number;
  // ---- Intelligence layer ----
  weights: InstitutionalWeights;
  /** Objects older than this are archived. */
  maxAgeBars: number;
  /** Bars allowed for close-back-inside sweep confirmation. */
  sweepConfirmBars: number;
}

export const DEFAULT_SMC_CONFIG: SmcConfig = {
  version: '1.0',
  swingsLength: 50,
  internalLength: 5,
  eqLength: 3,
  eqThreshold: 0.1,
  obFilter: 'atr',
  obMitigation: 'highlow',
  maxInternalOrderBlocks: 5,
  maxSwingOrderBlocks: 5,
  fvgAutoThreshold: true,
  fvgExtend: 1,
  weights: { structure: 30, liquidity: 25, orderBlocks: 25, fvg: 10, premiumDiscount: 10 },
  maxAgeBars: 500,
  sweepConfirmBars: 2,
};

export function resolveSmcConfig(partial?: Partial<SmcConfig>): SmcConfig {
  return {
    ...DEFAULT_SMC_CONFIG,
    ...partial,
    weights: { ...DEFAULT_SMC_CONFIG.weights, ...partial?.weights },
  };
}

export type SetupState = 'none' | 'watch' | 'building' | 'ready' | 'confirmed' | 'exhausted' | 'invalidated';

export type ZoneName = 'premium' | 'equilibrium' | 'discount';

export interface SmcScores {
  structure: number;
  liquidity: number;
  orderBlocks: number;
  fvg: number;
  premiumDiscount: number;
  confluence: number;
  institutional: number;
}

export interface SmcEvaluationIdentity {
  symbol: string;
  timeframe: string;
  mode: 'live' | 'replay';
  sourceRevision: string;
  replay?: { sessionId: string; cutTime: number; executionTimeframe: string };
}
export interface SmcSnapshot {
  metadata: { version: string; config: SmcConfig; context?: SmcEvaluationIdentity };
  state: {
    swingTrend: Bias;
    internalTrend: Bias;
    zone: ZoneName;
    trailing: {
      top: number;
      bottom: number;
      barIndex: number;
      barTime: number;
      lastTopTime: number;
      lastBottomTime: number;
    };
    setup: SetupState;
    setupDirection: SmcDirection | null;
  };
  objects: {
    orderBlocks: SmcObject[];
    fvgs: SmcObject[];
    liquidityPools: SmcObject[];
    structureLevels: SmcObject[];
    zones: SmcObject[];
  };
  events: SmcEvent[];
  scores: SmcScores;
  diagnostics: { barsProcessed: number; computeMs: number; version: string; warnings: string[] };
}

export function smcObjectId(
  kind: SmcObjectKind,
  scope: SmcScope | undefined,
  direction: SmcDirection,
  createdAtBar: number,
): string {
  return `${kind}_${scope ?? 'x'}_${direction}_${createdAtBar}`;
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function biasToDirection(bias: Bias): SmcDirection | null {
  return bias === BULLISH ? 'bullish' : bias === BEARISH ? 'bearish' : null;
}
