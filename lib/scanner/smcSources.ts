// SMC workflow as first-class scanner sources (Strategy Studio M3, grand-plan
// Phase 5): traders build scanners around institutional phases — "bullish BOS
// confirmed within 10 bars AND order block retested" — instead of only
// classic indicators.
//
// Two kinds of series, both driven by ONE cached computeSmc pass per candle
// array (progressive-reveal is engine-proven, so per-bar prefixes are safe):
//  - bars-since-event series (backtestable): value = bars since the last
//    matching SMC event, so `<= 10` reads "happened within the last 10 bars".
//  - live-edge state (liveOnly): institutional score / setup state / zone at
//    the last closed bar only — the validator warns about backtest coverage.

import type { Candle } from '../types';
import { TIMEFRAMES } from '../types';
import { computeSmcWindowed } from '../smc/engine';
import type { SmcEvent, SmcSnapshot } from '../smc/types';
import type { OperatorId, ScannerSource, Series } from './types';

// ---- one snapshot per candle array (closed-bar keyed, small LRU) ----------
const snapCache = new Map<string, SmcSnapshot>();
function snapFor(candles: Candle[]): SmcSnapshot {
  const key = `${candles.length}:${candles[0]?.time ?? 0}:${candles[candles.length - 1]?.time ?? 0}:${candles[0]?.open ?? 0}:${candles.length > 1 ? candles[candles.length - 2].close : 0}`;
  const hit = snapCache.get(key);
  if (hit) return hit;
  const snap = computeSmcWindowed(candles, 2500);
  if (snapCache.size >= 8) {
    const oldest = snapCache.keys().next().value;
    if (oldest !== undefined) snapCache.delete(oldest);
  }
  snapCache.set(key, snap);
  return snap;
}

/** Bars since the last event matching `match`; null before the first one. */
function barsSince(candles: Candle[], match: (e: SmcEvent) => boolean): Series {
  const events = snapFor(candles).events.filter(match);
  const out: Series = new Array(candles.length).fill(null);
  let last = -1;
  let ei = 0;
  for (let i = 0; i < candles.length; i++) {
    while (ei < events.length && events[ei].barIndex <= i) {
      last = events[ei].barIndex;
      ei++;
    }
    out[i] = last >= 0 ? i - last : null;
  }
  return out;
}

function liveEdge(candles: Candle[], pick: (snap: SmcSnapshot) => number | null): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;
  out[candles.length - 1] = pick(snapFor(candles));
  return out;
}

const SETUP_RANK: Record<string, number> = {
  none: 0, exhausted: 0, invalidated: 0, watch: 1, building: 2, ready: 3, confirmed: 4,
};

const SINCE_OPS: OperatorId[] = ['lte', 'lt', 'gte', 'gt'];
const CMP: OperatorId[] = ['gt', 'gte', 'lt', 'lte', 'between'];

const SMC_COST = 6; // one full engine pass (cached per candle array)

export const SMC_SCANNER_SOURCES: ScannerSource[] = [
  {
    id: 'smc_structure',
    name: 'SMC Structure (bars since)',
    group: 'intelligence',
    costWeight: SMC_COST,
    params: [],
    outputs: [
      { id: 'bullBos', label: 'Bullish BOS' },
      { id: 'bearBos', label: 'Bearish BOS' },
      { id: 'bullChoch', label: 'Bullish CHoCH' },
      { id: 'bearChoch', label: 'Bearish CHoCH' },
    ],
    operators: SINCE_OPS,
    tfs: TIMEFRAMES,
    series: (c, _p, out) =>
      barsSince(c, (e) =>
        out === 'bullBos'
          ? e.type === 'BOS' && e.direction === 'bullish'
          : out === 'bearBos'
            ? e.type === 'BOS' && e.direction === 'bearish'
            : out === 'bullChoch'
              ? e.type === 'CHOCH' && e.direction === 'bullish'
              : e.type === 'CHOCH' && e.direction === 'bearish',
      ),
  },
  {
    id: 'smc_liquidity',
    name: 'SMC Liquidity Sweep (bars since)',
    group: 'intelligence',
    costWeight: SMC_COST,
    params: [],
    outputs: [
      { id: 'sweepBull', label: 'Sell-side swept (bullish)' },
      { id: 'sweepBear', label: 'Buy-side swept (bearish)' },
    ],
    operators: SINCE_OPS,
    tfs: TIMEFRAMES,
    series: (c, _p, out) =>
      barsSince(c, (e) => e.type === 'LIQUIDITY_SWEEP' && e.direction === (out === 'sweepBull' ? 'bullish' : 'bearish')),
  },
  {
    id: 'smc_orderblock',
    name: 'SMC Order Block (bars since)',
    group: 'intelligence',
    costWeight: SMC_COST,
    params: [],
    outputs: [
      { id: 'bullRetest', label: 'Bullish OB retested' },
      { id: 'bearRetest', label: 'Bearish OB retested' },
      { id: 'bullCreated', label: 'Bullish OB created' },
      { id: 'bearCreated', label: 'Bearish OB created' },
    ],
    operators: SINCE_OPS,
    tfs: TIMEFRAMES,
    series: (c, _p, out) =>
      barsSince(c, (e) =>
        out === 'bullRetest'
          ? e.type === 'OB_TESTED' && e.direction === 'bullish'
          : out === 'bearRetest'
            ? e.type === 'OB_TESTED' && e.direction === 'bearish'
            : out === 'bullCreated'
              ? e.type === 'OB_CREATED' && e.direction === 'bullish'
              : e.type === 'OB_CREATED' && e.direction === 'bearish',
      ),
  },
  {
    id: 'smc_state',
    name: 'SMC State (live)',
    group: 'intelligence',
    costWeight: SMC_COST,
    liveOnly: true,
    params: [],
    outputs: [
      { id: 'institutional', label: 'Institutional score', range: [0, 100] },
      { id: 'setup', label: 'Setup stage (0 none → 4 confirmed)', range: [0, 4] },
      { id: 'zone', label: 'Zone (-1 discount · 0 eq · 1 premium)', range: [-1, 1] },
    ],
    operators: CMP,
    tfs: TIMEFRAMES,
    series: (c, _p, out) =>
      liveEdge(c, (snap) =>
        out === 'institutional'
          ? snap.scores.institutional
          : out === 'setup'
            ? SETUP_RANK[snap.state.setup] ?? 0
            : snap.state.zone === 'premium'
              ? 1
              : snap.state.zone === 'discount'
                ? -1
                : 0,
      ),
  },
];
