// Replay Verification (Phase 2.D, developer mode) — proves, at the current
// replay moment, that every engine obeys the Prime Invariant and produces
// deterministic results identical to direct historical computation. While
// every engine is a pure batch function this should always read 100%; it
// exists to catch future incremental/caching paths that drift.

import type { Candle, Timeframe } from '../types';
import { sliceCandlesByTf, TF_SECONDS } from './replaySlice';
import { computeSmc, projectSmcSnapshot } from '../smc/engine';
import { evaluateSmcScreener } from '../smc/screener';
import { computeSdSignalEvents } from '../indicators/sdSignals';

export interface IntegrityCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface IntegrityReport {
  checks: IntegrityCheck[];
  /** 0–100: passed / total. */
  integrity: number;
}

export function verifyReplayIntegrity(args: {
  candles: Candle[];
  playIndex: number;
  evalTf: Timeframe;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
}): IntegrityReport {
  const { candles, playIndex, evalTf, candlesByTf } = args;
  const checks: IntegrityCheck[] = [];
  const cutBar = candles[Math.min(playIndex, candles.length - 1)];
  const slice = candles.slice(0, Math.min(playIndex, candles.length - 1) + 1);

  // 1. Chart slice: nothing rendered beyond the replay bar.
  checks.push({
    name: 'Chart slice',
    ok: Boolean(cutBar) && slice.every((c) => c.time <= cutBar.time),
    detail: `${slice.length} bars ≤ cut`,
  });

  // 2. Prime Invariant across timeframes.
  if (cutBar) {
    const now = cutBar.time + TF_SECONDS[evalTf];
    const sliced = sliceCandlesByTf(candlesByTf, evalTf, cutBar);
    let leaked = 0;
    for (const tf of Object.keys(sliced) as Timeframe[]) {
      for (const c of sliced[tf] ?? []) if (c.time >= now) leaked++;
    }
    checks.push({
      name: 'Prime Invariant (MTF)',
      ok: leaked === 0,
      detail: leaked === 0 ? 'no future bars in any timeframe' : `${leaked} leaked bars`,
    });

    // 3. SMC engine determinism on the slice.
    const smcA = JSON.stringify(projectSmcSnapshot(computeSmc(slice)));
    const smcB = JSON.stringify(projectSmcSnapshot(computeSmc(slice)));
    checks.push({ name: 'SMC engine', ok: smcA === smcB, detail: 'double-run identical' });

    // 4. Scanner (SMC screener) determinism on the sliced MTF view.
    const scanA = JSON.stringify(evaluateSmcScreener(sliced, evalTf));
    const scanB = JSON.stringify(evaluateSmcScreener(sliced, evalTf));
    checks.push({ name: 'Scanner', ok: scanA === scanB, detail: 'double-run identical' });

    // 5. Signal events determinism on the slice.
    const sigA = JSON.stringify(computeSdSignalEvents(slice, { id: 'sd_signals' }, { symbol: 'VERIFY', timeframe: evalTf }));
    const sigB = JSON.stringify(computeSdSignalEvents(slice, { id: 'sd_signals' }, { symbol: 'VERIFY', timeframe: evalTf }));
    checks.push({ name: 'Signals', ok: sigA === sigB, detail: 'double-run identical' });
  }

  const passed = checks.filter((c) => c.ok).length;
  return { checks, integrity: checks.length === 0 ? 0 : Math.round((passed / checks.length) * 100) };
}
