'use client';

// The trading simulator HUD (spec steps 4-12): stop-first order entry with
// automatic position sizing, instant BUY/SELL, one position at a time, live
// account statistics, and a summary of the last closed trade.

import { useEffect, useMemo, useState } from 'react';
import {
  replayOpenWithRisk,
  setPendingLevels,
  sessionBalance,
  type ReplaySessionState,
} from '@/lib/replaySession';
import {
  currencySymbol,
  positionSizeFor,
  sessionStats,
  type SizingResult,
} from '@/lib/replay/sessionSim';
import type { Side } from '@/lib/paper';

const REASON_TEXT: Record<SizingResult['reason'], string> = {
  ok: '',
  'no-stop': 'Set a Stop Loss first — undefined-risk trades are not allowed.',
  'stop-on-wrong-side': 'The stop must be on the losing side of the entry.',
  'insufficient-margin': 'Not enough balance for this size at the chosen leverage.',
  'bad-input': 'Waiting for a price…',
};

export default function SessionHud({
  session,
  lastClose,
  lastTime,
  atr,
}: {
  session: ReplaySessionState;
  lastClose: number;
  lastTime: number;
  atr: number;
}) {
  const cfg = session.config!;
  const sym = currencySymbol(cfg.currency);
  const hasPosition = !!(session.position && session.position.side !== 'flat');

  // Stop-first entry: user picks the side they are CONSIDERING; SL/TP prefill
  // from ATR and re-seed when the side flips. Sizing updates live (spec:
  // automatic position sizing before the trade, locked after).
  const [side, setSide] = useState<Side>('buy');
  const [sl, setSl] = useState<number | null>(null);
  const [tp, setTp] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const atrReady = atr > 0;
  useEffect(() => {
    if (hasPosition || !(lastClose > 0) || !atrReady) return;
    const dist = 1.5 * atr;
    setSl(side === 'buy' ? lastClose - dist : lastClose + dist);
    setTp(side === 'buy' ? lastClose + 2 * dist : lastClose - 2 * dist);
    // atrReady in the deps: if the HUD mounts while deep history is still
    // loading (ATR not computable yet), re-seed the levels the moment it is —
    // otherwise the stop never prefills and BUY stays disabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, hasPosition, atrReady]);

  useEffect(() => {
    setPendingLevels(sl, tp);
  }, [sl, tp]);

  const balance = sessionBalance(session);
  const sizing = useMemo(
    () => positionSizeFor(cfg, balance, side, lastClose, sl),
    [cfg, balance, side, lastClose, sl],
  );
  const stats = useMemo(() => sessionStats(session.trades, cfg.startBalance), [session.trades, cfg.startBalance]);
  const lastDone = session.behaviors[0];

  const execute = (s: Side) => {
    setSide(s);
    const r = replayOpenWithRisk(s, lastClose, lastTime);
    if (r.blocked === 'position-open') setNotice('Finish current trade first.');
    else if (!r.ok) setNotice(REASON_TEXT[r.reason]);
    else setNotice(null);
  };

  const field = 'focus-ring h-7 w-24 rounded-lg border border-line bg-base px-2 font-mono text-[11px] text-ink';

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Live account stats (spec step 12) */}
        <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
          <span className="text-ink">Balance <b>{sym}{stats.balance.toFixed(2)}</b></span>
          <span className={stats.netPnl >= 0 ? 'text-bull-bright' : 'text-bear-bright'}>
            P/L {stats.netPnl >= 0 ? '+' : ''}{sym}{stats.netPnl.toFixed(2)}
          </span>
          <span className="text-ink-muted">Win {Math.round(stats.winRate * 100)}%</span>
          <span className="text-ink-muted">Trades {stats.trades}</span>
          <span className="text-ink-faint">Risk {cfg.riskPct}% · {cfg.leverage}x</span>
        </div>

        {hasPosition ? (
          <span className="text-[11px] text-ink-faint">
            Position open — manage TP/SL on the chart. One position at a time.
          </span>
        ) : (
          <>
            <label className="inline-flex items-center gap-1 text-ink-faint">
              SL
              <input
                type="number"
                value={sl != null ? Number(sl.toFixed(1)) : ''}
                onChange={(e) => setSl(e.target.value === '' ? null : Number(e.target.value))}
                className={field}
                aria-label="Stop loss"
              />
            </label>
            <label className="inline-flex items-center gap-1 text-ink-faint">
              TP
              <input
                type="number"
                value={tp != null ? Number(tp.toFixed(1)) : ''}
                onChange={(e) => setTp(e.target.value === '' ? null : Number(e.target.value))}
                className={field}
                aria-label="Take profit"
              />
            </label>
            <span className="font-mono text-[11px] tabular-nums text-ink-muted">
              {sizing.ok
                ? <>Size <b className="text-ink">{sizing.units.toFixed(4)}</b> · risk {sym}{sizing.riskAmount.toFixed(2)}</>
                : REASON_TEXT[sizing.reason]}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!sizing.ok}
                onClick={() => execute('buy')}
                className="focus-ring rounded-lg bg-bull px-4 py-1.5 text-[12px] font-bold text-black disabled:opacity-40"
              >
                BUY
              </button>
              <button
                type="button"
                disabled={!sizing.ok}
                onClick={() => execute('sell')}
                className="focus-ring rounded-lg bg-bear px-4 py-1.5 text-[12px] font-bold text-black disabled:opacity-40"
              >
                SELL
              </button>
            </div>
          </>
        )}
        {notice && <span className="text-[11px] text-regime-hot">{notice}</span>}
      </div>

      {/* Last trade summary (spec step 11) */}
      {lastDone && lastDone.exitKind && (
        <p className="mt-2 border-t border-line/60 pt-2 font-mono text-[11px] tabular-nums text-ink-muted">
          Trade #{session.behaviors.length} · {lastDone.side.toUpperCase()} · entry {lastDone.entryPrice.toFixed(1)} → exit{' '}
          {lastDone.exitPrice?.toFixed(1)} · {lastDone.exitKind.toUpperCase()} ·{' '}
          <span className={(lastDone.realizedPnl ?? 0) >= 0 ? 'text-bull-bright' : 'text-bear-bright'}>
            {(lastDone.realizedPnl ?? 0) >= 0 ? '+' : ''}{sym}{(lastDone.realizedPnl ?? 0).toFixed(2)}
          </span>
        </p>
      )}
    </div>
  );
}
