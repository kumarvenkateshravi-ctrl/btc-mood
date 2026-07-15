'use client';

import { GraduationCap, Target, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/util';
import type { TrainingReport } from '@/lib/replay/trainingReport';

const GRADE_STYLE: Record<TrainingReport['grade'], string> = {
  A: 'text-bull-bright border-bull/40 bg-bull/10',
  B: 'text-bull-bright border-bull/30 bg-bull/5',
  C: 'text-regime-hot border-regime-hot/40 bg-regime-hot/10',
  D: 'text-bear-bright border-bear/30 bg-bear/5',
  F: 'text-bear-bright border-bear/40 bg-bear/10',
};

function money(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function TrainingReportModal({
  report,
  onClose,
}: {
  report: TrainingReport;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-base/65 p-4 backdrop-blur-sm" role="dialog" aria-label="Replay training report">
      <div className="elev-2 w-full max-w-xl rounded-2xl bg-surface-2">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                <GraduationCap className="h-4 w-4 text-accent" />
                Replay Review
              </span>
              <Badge tone="accent">Practice score</Badge>
            </div>
            <p className="mt-1 text-[12px] text-ink-faint">Grade the drill, then pick one thing to improve next.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-ink-faint transition hover:bg-surface-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5 md:grid-cols-[0.75fr_1.25fr]">
          <div className="rounded-xl border border-line bg-base p-4 text-center">
            <div className={cx('mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border text-4xl font-bold', GRADE_STYLE[report.grade])}>
              {report.grade}
            </div>
            <p className="mt-3 text-[13px] leading-snug text-ink-muted">{report.gradeNote}</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Metric label="Trades" value={String(report.trades)} />
            <Metric label="Win rate" value={`${report.winRate}%`} />
            <Metric label="P/L" value={money(report.totalPnl)} tone={report.totalPnl >= 0 ? 'bull' : 'bear'} />
            <Metric label="Payoff" value={report.payoffRatio != null ? `${report.payoffRatio.toFixed(1)}R` : 'N/A'} />
            <Metric label="Max DD" value={money(report.maxDrawdown)} tone="bear" />
            <Metric label="Duration" value={`${report.durationBars} bars`} />
            <Metric label="Best" value={money(report.bestTrade)} tone="bull" />
            <Metric label="Worst" value={money(report.worstTrade)} tone="bear" />
            <Metric label="W / L" value={`${report.wins} / ${report.losses}`} />
          </div>
        </div>

        <div className="mx-5 rounded-xl border border-line bg-base p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
            <Target className="h-4 w-4 text-accent" />
            Next drill focus
          </div>
          <p className="mt-2 text-[13px] leading-snug text-ink-muted">{focusFromReport(report)}</p>
        </div>

        <div className="flex justify-end px-5 py-4">
          <Button onClick={onClose} variant="solid">Done</Button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  return (
    <div className="rounded-lg border border-line bg-base p-3">
      <dt className="text-[10px] font-sans uppercase text-ink-faint">{label}</dt>
      <dd className={cx('mt-1 font-mono text-[13px] tabular-nums', tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink')}>{value}</dd>
    </div>
  );
}

function focusFromReport(report: TrainingReport): string {
  if (report.trades === 0) return 'Pick one clean setup and commit to the full replay, even if the best action is no trade.';
  if (report.winRate < 40) return 'Wait for confirmation before entering. Your next drill is about selectivity, not speed.';
  if (report.payoffRatio != null && report.payoffRatio < 1) return 'Protect asymmetry. Let winners reach the planned target or tighten the invalidation sooner.';
  if (report.totalPnl < 0) return 'Review the first losing trade and define what would have invalidated it earlier.';
  return 'Repeat the same setup criteria and compare whether the process stays stable across a new random day.';
}
