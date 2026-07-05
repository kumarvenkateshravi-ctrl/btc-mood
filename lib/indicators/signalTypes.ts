// Shared signal contract — the SINGLE type used by the engine, chart,
// dashboard, backtester, and future alerts/AI. No framework/chart/store imports.
import type { ZoneKind, ZoneStrength } from './zoneStrength';
import type { HtfPeriod } from './htf';

export type Side = 'buy' | 'sell';

export type SdSignalStatus =
  | 'armed'        // price entered the zone; awaiting confirmation
  | 'triggered'    // confirmation bar closed; signal is live
  | 'tp1'          // first target hit
  | 'tp2'          // second target hit
  | 'stopped'      // stop-loss hit
  | 'expired'      // no confirm within window, or no resolution within window
  | 'invalidated'; // zone broken pre-confirm, or failed the quality gate

export const SIGNAL_STATUSES: SdSignalStatus[] = [
  'armed', 'triggered', 'tp1', 'tp2', 'stopped', 'expired', 'invalidated',
];

/** Why a setup did not become a tradeable signal — powers the "no signals" explainer. */
export type SdRejectReason = 'confidence' | 'riskReward' | 'zoneBroken' | null;

/** One weighted piece of evidence behind the confidence score. */
export interface SignalFactor {
  key: 'zoneStrength' | 'confluence' | 'riskReward' | 'freshness' | 'formationVolume';
  label: string;
  input: number;        // normalized 0..1
  weight: number;
  contribution: number; // weight * input * 100
}

/** Structured, renderable rationale — maps to DESIGN.md §E explainable-AI grammar. */
export interface SignalExplanation {
  factors: SignalFactor[];   // sorted by contribution desc
  summary: string;
  counterSignals: string[];
}

/** A zone annotated with score + context, consumed by the signal engine. */
export interface ScoredZone {
  kind: ZoneKind;
  zoneType: 'supply' | 'demand';
  tf: HtfPeriod;
  upper: number;
  lower: number;
  mid: number;
  formedAtIndex: number;
  formedTime: number;
  strength: ZoneStrength;
  isConfluence: boolean;
  retestCount: number;
}

/**
 * The canonical trade signal. Shared contract for every consumer.
 * `*Index` fields are bar positions on the signal (chart) timeframe used for
 * rendering; `createdAt`/`resolvedAt` are unix seconds for ordering/history.
 */
export interface SdSignal {
  id: string;                 // `${side}:${zoneId}` — stable, deduped per zone
  side: Side;
  timeframe: string;          // chart timeframe the signal is evaluated on
  symbol: string;
  zoneId: string;             // `${zoneTf}:${zoneKind}:${formedAtIndex}`
  zoneTf: HtfPeriod;
  zoneKind: 'supply' | 'demand';
  status: SdSignalStatus;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: number;         // (tp1-entry)/risk, sell mirrored
  confidence: number;         // 0..100
  explanation: SignalExplanation;
  tier: 'medium' | 'strong';
  rejectReason: SdRejectReason; // set when status === 'invalidated', else null
  armedIndex: number | null;
  triggeredIndex: number | null;
  resolvedIndex: number | null;
  createdAt: number;          // triggeredTime ?? armedTime
  resolvedAt: number | null;
}

export const zoneIdOf = (tf: HtfPeriod, kind: 'supply' | 'demand', formedAtIndex: number): string =>
  `${tf}:${kind}:${formedAtIndex}`;
