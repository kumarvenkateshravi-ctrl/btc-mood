'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/util';
import {
  replayOpenWithRisk,
  setPendingLevels,
  setReplayActionContext,
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
  'no-stop': 'Set a Stop Loss first. Undefined-risk trades are blocked.',
  'stop-on-wrong-side': 'Stop must sit on the losing side of entry.',
  'insufficient-margin': 'Not enough balance for this size at the chosen leverage.',
  'bad-input': 'Waiting for a valid replay price.',
};

export default function SessionHud({
  session,
  lastClose,
  lastTime,
  atr,
  replayBarIndex,
}: {
  session: ReplaySessionState;
  lastClose: number;
  lastTime: number;
  atr: number;
  replayBarIndex: number;
}) {
  const cfg = session.config!;
  const sym = currencySymbol(cfg.currency);
  const hasPosition = !!(session.position && session.position.side !== 'flat');

  const [side, setSide] = useState<Side>('buy');
  const [sl, setSl] = useState<number | null>(null);
  const [tp, setTp] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const suggestedLevels = useMemo(() => {
    if (hasPosition || !(lastClose > 0) || !(atr > 0)) return { sl: null, tp: null };
    const dist = 1.5 * atr;
    return {
      sl: side === 'buy' ? lastClose - dist : lastClose + dist,
      tp: side === 'buy' ? lastClose + 2 * dist : lastClose - 2 * dist,
    };
  }, [atr, hasPosition, lastClose, side]);
  const effectiveSl = sl ?? suggestedLevels.sl;
  const effectiveTp = tp ?? suggestedLevels.tp;

  useEffect(() => {
    setReplayActionContext(replayBarIndex, lastTime);
    setPendingLevels(effectiveSl, effectiveTp);
  }, [effectiveSl, effectiveTp, replayBarIndex, lastTime]);

  const balance = sessionBalance(session);
  const sizing = useMemo(() => positionSizeFor(cfg, balance, side, lastClose, effectiveSl), [cfg, balance, side, lastClose, effectiveSl]);
  const stats = useMemo(() => sessionStats(session.trades, cfg.startBalance), [session.trades, cfg.startBalance]);
  const lastDone = session.behaviors[0];

  const selectSide = (next: Side) => {
    setSide(next);
    setSl(null);
    setTp(null);
  };

  const execute = (s: Side) => {
    selectSide(s);
    setReplayActionContext(replayBarIndex, lastTime);
    const r = replayOpenWithRisk(s, lastClose, lastTime);
    if (r.blocked === 'position-open') setNotice('Finish current trade first.');
    else if (!r.ok) setNotice(REASON_TEXT[r.reason]);
    else setNotice(null);
  };

  const field = 'input-field h-8 w-24 rounded-md border border-line bg-base px-2 font-mono text-[12px] text-ink';

  return (
    <div className="elev-1 rounded-xl p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">Practice account</span>
            <Badge tone="accent">Replay only</Badge>
            {hasPosition && <Badge tone="warn">Position open</Badge>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Metric label="Balance" value={`${sym}${formatMoney(stats.balance)}`} />
            <Metric label="P/L" value={`${stats.netPnl >= 0 ? '+' : '-'}${sym}${formatMoney(Math.abs(stats.netPnl))}`} tone={stats.netPnl >= 0 ? 'bull' : 'bear'} />
            <Metric label="Win" value={`${Math.round(stats.winRate * 100)}%`} />
            <Metric label="Trades" value={String(stats.trades)} />
            <Metric label="Risk" value={`${cfg.riskPct}% / ${cfg.leverage}x`} />
          </div>
        </div>

        {hasPosition ? (
          <div className="rounded-lg border border-line bg-base px-3 py-2 text-[11px] text-ink-muted">
            Manage TP/SL on the chart. Replay allows one open position at a time.
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Intent</span>
              <div className="mt-1 flex rounded-lg border border-line bg-base p-0.5">
                <button type="button" onClick={() => selectSide('buy')} className={intentClass(side === 'buy', 'buy')}>Long</button>
                <button type="button" onClick={() => selectSide('sell')} className={intentClass(side === 'sell', 'sell')}>Short</button>
              </div>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Stop Loss</span>
              <input type="number" value={effectiveSl != null ? Number(effectiveSl.toFixed(1)) : ''} onChange={(e) => setSl(e.target.value === '' ? null : Number(e.target.value))} className={field} aria-label="Stop loss" />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Take Profit</span>
              <input type="number" value={effectiveTp != null ? Number(effectiveTp.toFixed(1)) : ''} onChange={(e) => setTp(e.target.value === '' ? null : Number(e.target.value))} className={field} aria-label="Take profit" />
            </label>
            <div className="min-w-[170px] rounded-lg border border-line bg-base px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Auto size</p>
              <p className="mt-1 font-mono text-[12px] tabular-nums text-ink">
                {sizing.ok ? `${sizing.units.toFixed(4)} units` : 'Blocked'}
              </p>
              <p className="mt-0.5 text-[10px] text-ink-faint">
                {sizing.ok ? `Risk ${sym}${formatMoney(sizing.riskAmount)}` : REASON_TEXT[sizing.reason]}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!sizing.ok}
                onClick={() => execute('buy')}
                className="focus-ring inline-flex h-9 items-center justify-center rounded-lg bg-bull px-4 text-[12px] font-bold text-white transition hover:opacity-90 disabled:opacity-40"
              >
                BUY
              </button>
              <button
                type="button"
                disabled={!sizing.ok}
                onClick={() => execute('sell')}
                className="focus-ring inline-flex h-9 items-center justify-center rounded-lg bg-bear px-4 text-[12px] font-bold text-white transition hover:opacity-90 disabled:opacity-40"
              >
                SELL
              </button>
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-regime-hot/30 bg-regime-hot/10 px-3 py-2 text-[11px] text-regime-hot">
          <ShieldAlert className="h-3.5 w-3.5" />
          {notice}
        </div>
      )}

      {lastDone && lastDone.exitKind && (
        <p className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2 font-mono text-[11px] tabular-nums text-ink-muted">
          <Activity className="h-3.5 w-3.5 text-accent" />
          Trade #{session.behaviors.length} - {lastDone.side.toUpperCase()} - entry {lastDone.entryPrice.toFixed(1)} to exit {lastDone.exitPrice?.toFixed(1)} - {lastDone.exitKind.toUpperCase()} -{' '}
          <span className={(lastDone.realizedPnl ?? 0) >= 0 ? 'text-bull-bright' : 'text-bear-bright'}>
            {(lastDone.realizedPnl ?? 0) >= 0 ? '+' : '-'}{sym}{formatMoney(Math.abs(lastDone.realizedPnl ?? 0))}
          </span>
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  return (
    <div className="rounded-lg border border-line bg-base px-2 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={cx('mt-0.5 font-mono text-[12px] tabular-nums', tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink')}>
        {value}
      </p>
    </div>
  );
}

function intentClass(active: boolean, side: Side): string {
  const activeClass = side === 'buy' ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright';
  return cx('focus-ring h-7 rounded-md px-2.5 text-[11px] font-semibold transition', active ? activeClass : 'text-ink-faint hover:bg-surface-2 hover:text-ink');
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
