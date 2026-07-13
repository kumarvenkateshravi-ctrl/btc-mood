'use client';

// End-of-session report (spec steps 13-14): account outcome + the behavioral
// coaching read — process feedback, not just P&L.

import { sessionStats, coachingNotes, currencySymbol, type SessionConfig } from '@/lib/replay/sessionSim';
import type { TradeBehavior } from '@/lib/replay/sessionSim';
import type { PaperTrade } from '@/lib/paper';

export default function SessionReportModal({
  config,
  trades,
  behaviors,
  onClose,
}: {
  config: SessionConfig;
  trades: PaperTrade[];
  behaviors: TradeBehavior[];
  onClose: () => void;
}) {
  const s = sessionStats(trades, config.startBalance);
  const sym = currencySymbol(config.currency);
  const notes = coachingNotes(behaviors);
  const fmt = (v: number) => `${v >= 0 ? '' : '-'}${sym}${Math.abs(v).toFixed(2)}`;
  const holdMin = s.avgHoldSec != null ? Math.round(s.avgHoldSec / 60) : null;

  const Row = ({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) => (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[11px] uppercase tracking-wider text-ink-faint">{k}</span>
      <span className={`font-mono text-sm tabular-nums ${tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink'}`}>{v}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Session summary">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface-2 p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-ink">Session Summary</h2>
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2">
          <Row k="Starting balance" v={`${sym}${config.startBalance.toFixed(2)}`} />
          <Row k="Ending balance" v={`${sym}${s.balance.toFixed(2)}`} tone={s.netPnl >= 0 ? 'bull' : 'bear'} />
          <Row k="Net profit" v={fmt(s.netPnl)} tone={s.netPnl >= 0 ? 'bull' : 'bear'} />
          <Row k="Trades" v={String(s.trades)} />
          <Row k="Wins / Losses" v={`${s.wins} / ${s.losses}`} />
          <Row k="Win rate" v={`${Math.round(s.winRate * 100)}%`} />
          <Row k="Average RR" v={s.avgRR != null ? s.avgRR.toFixed(1) : '—'} />
          <Row k="Profit factor" v={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} />
          <Row k="Largest win" v={fmt(s.largestWin)} tone="bull" />
          <Row k="Largest loss" v={fmt(s.largestLoss)} tone="bear" />
          <Row k="Max drawdown" v={`${s.maxDrawdownPct.toFixed(1)}%`} />
          <Row k="Avg hold" v={holdMin != null ? `${holdMin} min` : '—'} />
        </div>

        {notes.length > 0 && (
          <div className="mt-4 space-y-1.5 border-t border-line pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Coaching</p>
            {notes.map((n, i) => (
              <p key={i} className={`text-xs ${n.tone === 'good' ? 'text-bull-bright' : 'text-regime-hot'}`}>
                {n.text}
              </p>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="focus-ring mt-5 w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black hover:opacity-90"
        >
          Done
        </button>
      </div>
    </div>
  );
}
