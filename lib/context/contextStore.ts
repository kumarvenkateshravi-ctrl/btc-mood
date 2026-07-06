// One MarketContext for the whole app (MTFPlan Phase 12): the page computes it
// from candlesByTf and publishes here; the chart indicator, widget, dashboard,
// and future scanner/alerts/backtester all read the SAME object — no duplicate
// calculation. Plain module singleton (not React state): consumers that need
// reactivity already re-render on candle changes.

import type { Decision, MarketContext, Rejection } from './types';
import type { VdTrade } from '../indicators/vdEngine';

let _latest: MarketContext | null = null;

export function publishMarketContext(ctx: MarketContext): void {
  _latest = ctx;
}

export function latestMarketContext(): MarketContext | null {
  return _latest;
}

/** Test-only: reset the singleton. */
export function __resetContextForTest(): void {
  _latest = null;
  _decisions = null;
  _trades = null;
  _selectedTradeId = null;
}

// ---- Latest decisions/rejections (published by the VD indicator, read by the
// context widget so WHY-NOT explanations are visible; refinement 10). --------

export interface VdDecisionSnapshot {
  decisions: Decision[];
  rejections: Rejection[];
  gated: boolean;
}

let _decisions: VdDecisionSnapshot | null = null;

export function publishVdDecisions(snap: VdDecisionSnapshot): void {
  _decisions = snap;
}

export function latestVdDecisions(): VdDecisionSnapshot | null {
  return _decisions;
}

// ---- Latest tracked trades (VD indicator → trade table). -------------------


let _trades: VdTrade[] | null = null;

export function publishVdTrades(trades: VdTrade[]): void {
  _trades = trades;
}

export function latestVdTrades(): VdTrade[] | null {
  return _trades;
}

// ---- Trade selection (table row click → chart focuses that trade). ---------

export const vdTradeId = (t: VdTrade): string => `${t.signal.zoneId}@${t.signal.index}`;

let _selectedTradeId: string | null = null;

export function selectVdTrade(id: string | null): void {
  _selectedTradeId = id;
}

export function selectedVdTradeId(): string | null {
  return _selectedTradeId;
}
