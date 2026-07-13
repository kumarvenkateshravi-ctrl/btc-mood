// D Smart Line as scanner sources (plan Phase 4) — same pattern as the M3
// SMC sources: bars-since series for the signal events (backtestable) plus
// full-history state series (regime / in-cloud / cloud width are per-bar
// values, so unlike smc_state they need no liveOnly escape hatch).

import type { Candle } from '../types';
import { TIMEFRAMES } from '../types';
import { computeDsmart, DSMART_DEFAULTS, type DsmartResult } from '../indicators/dsmartLine';
import type { OperatorId, ScannerSource, Series } from './types';

const cache = new Map<string, DsmartResult>();
function resultFor(candles: Candle[]): DsmartResult {
  const key = `${candles.length}:${candles[0]?.time ?? 0}:${candles[candles.length - 1]?.time ?? 0}:${candles[0]?.open ?? 0}:${candles.length > 1 ? candles[candles.length - 2].close : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = computeDsmart(candles, DSMART_DEFAULTS);
  if (cache.size >= 8) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, r);
  return r;
}

function barsSince(candles: Candle[], match: (e: DsmartResult['events'][number]) => boolean): Series {
  const events = resultFor(candles).events.filter(match);
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

const SINCE_OPS: OperatorId[] = ['lte', 'lt', 'gte', 'gt'];
const CMP: OperatorId[] = ['gt', 'gte', 'lt', 'lte', 'between'];
const COST = 4;

export const DSMART_SCANNER_SOURCES: ScannerSource[] = [
  {
    id: 'dsmart_signal',
    name: 'D Smart Signal (bars since)',
    group: 'intelligence',
    costWeight: COST,
    params: [],
    outputs: [
      { id: 'pullbackBull', label: 'Bullish pullback (P)' },
      { id: 'pullbackBear', label: 'Bearish pullback (P)' },
      { id: 'arrowBull', label: 'Bullish continuation arrow' },
      { id: 'arrowBear', label: 'Bearish continuation arrow' },
      { id: 'starBull', label: 'Bullish exhaustion star' },
      { id: 'starBear', label: 'Bearish exhaustion star' },
    ],
    operators: SINCE_OPS,
    tfs: TIMEFRAMES,
    series: (c, _p, out) => {
      const type = out.startsWith('pullback') ? 'pullback' : out.startsWith('arrow') ? 'arrow' : 'star';
      const direction = out.endsWith('Bull') ? 'bullish' : 'bearish';
      return barsSince(c, (e) => e.type === type && e.direction === direction);
    },
  },
  {
    id: 'dsmart_state',
    name: 'D Smart State',
    group: 'intelligence',
    costWeight: COST,
    params: [],
    outputs: [
      { id: 'regime', label: 'Regime (1 bull / -1 bear)', range: [-1, 1] },
      { id: 'inCloud', label: 'Inside cloud (1 = corrective)', range: [0, 1] },
      { id: 'cloudWidth', label: 'Cloud width (brick units)' },
    ],
    operators: CMP,
    tfs: TIMEFRAMES,
    series: (c, _p, out) => {
      const r = resultFor(c);
      return c.map((bar, i): number | null => {
        if (out === 'regime') return r.regime[i] === 0 ? null : r.regime[i];
        if (out === 'cloudWidth') return r.cloudWidth[i];
        const w = r.walk[i];
        const ru = r.run[i];
        if (w == null || ru == null) return null;
        const lo = Math.min(w, ru);
        const hi = Math.max(w, ru);
        return bar.close >= lo && bar.close <= hi ? 1 : 0;
      });
    },
  },
];
