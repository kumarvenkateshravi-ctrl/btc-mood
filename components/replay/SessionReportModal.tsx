'use client';

import { BarChart3, CheckCircle2, Target, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/util';
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
  const holdMin = s.avgHoldSec != null ? Math.round(s.avgHoldSec / 60) : null;
  const primaryNote = notes[0]?.text ?? (s.trades === 0 ? 'Run one focused drill and take only planned setups.' : 'Review your worst trade before the next drill.');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-base/75 p-4 backdrop-blur-sm" role="dialog" aria-label="Session summary">
      <div className="elev-2 w-full max-w-2xl rounded-2xl bg-surface-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                <BarChart3 className="h-4 w-4 text-accent" />
                Practice Review
              </span>
              <Badge tone="accent">Replay complete</Badge>
            </div>
            <p className="mt-1 text-[12px] text-ink-faint">Account outcome, execution quality, and the next improvement focus.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-ink-faint transition hover:bg-surface-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[0.95fr_1.35fr]">
          <div className="rounded-xl border border-line bg-base p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Net result</p>
            <p className={cx('mt-2 font-mono text-3xl font-semibold tabular-nums', s.netPnl >= 0 ? 'text-bull-bright' : 'text-bear-bright')}>
              {s.netPnl >= 0 ? '+' : '-'}{sym}{formatMoney(Math.abs(s.netPnl))}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric k="Start" v={`${sym}${formatMoney(config.startBalance)}`} />
              <Metric k="End" v={`${sym}${formatMoney(s.balance)}`} tone={s.netPnl >= 0 ? 'bull' : 'bear'} />
              <Metric k="Trades" v={String(s.trades)} />
              <Metric k="Win rate" v={`${Math.round(s.winRate * 100)}%`} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricCard k="Wins / Losses" v={`${s.wins} / ${s.losses}`} />
            <MetricCard k="Average RR" v={s.avgRR != null ? s.avgRR.toFixed(1) : 'N/A'} />
            <MetricCard k="Profit factor" v={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'Infinity'} />
            <MetricCard k="Largest win" v={`${sym}${formatMoney(s.largestWin)}`} tone="bull" />
            <MetricCard k="Largest loss" v={`${sym}${formatMoney(Math.abs(s.largestLoss))}`} tone="bear" />
            <MetricCard k="Max DD" v={`${s.maxDrawdownPct.toFixed(1)}%`} tone="bear" />
            <MetricCard k="Avg hold" v={holdMin != null ? `${holdMin} min` : 'N/A'} />
            <MetricCard k="Risk model" v={`${config.riskPct}% / ${config.leverage}x`} />
            <MetricCard k="Commission" v={`${formatMoney(config.commissionRate * 100)}%`} />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-base p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
            <Target className="h-4 w-4 text-accent" />
            Next drill focus
          </div>
          <p className="mt-2 text-[13px] leading-snug text-ink-muted">{primaryNote}</p>
          {notes.length > 1 && (
            <div className="mt-3 space-y-1.5 border-t border-line pt-3">
              {notes.slice(1).map((n, i) => (
                <p key={i} className={cx('flex gap-2 text-xs', n.tone === 'good' ? 'text-bull-bright' : 'text-regime-hot')}>
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {n.text}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button type="button" variant="solid" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function Metric({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-faint">{k}</p>
      <p className={cx('mt-0.5 font-mono text-[12px] tabular-nums', tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink')}>{v}</p>
    </div>
  );
}

function MetricCard({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) {
  return (
    <div className="rounded-lg border border-line bg-base p-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-faint">{k}</p>
      <p className={cx('mt-1 font-mono text-[13px] tabular-nums', tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink')}>{v}</p>
    </div>
  );
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
