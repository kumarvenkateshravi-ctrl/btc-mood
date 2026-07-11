'use client';

// Replay Training Report — the score card shown when a replay session with
// trades ends. Deliberate practice needs a grade, not just a movie.

import { GraduationCap, X } from 'lucide-react';
import type { TrainingReport } from '@/lib/replay/trainingReport';

const GRADE_STYLE: Record<TrainingReport['grade'], string> = {
  A: 'text-bull-bright border-bull/40 bg-bull/10',
  B: 'text-bull-bright border-bull/30 bg-bull/5',
  C: 'text-regime-hot border-regime-hot/40 bg-regime-hot/10',
  D: 'text-bear-bright border-bear/30 bg-bear/5',
  F: 'text-bear-bright border-bear/40 bg-bear/10',
};

function money(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function TrainingReportModal({
  report,
  onClose,
}: {
  report: TrainingReport;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-[380px] rounded-xl border border-line bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <GraduationCap className="h-4 w-4 text-accent" />
            Replay Complete
          </span>
          <button onClick={onClose} aria-label="Close" className="focus-ring rounded p-1 text-ink-faint transition hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-4 px-4 py-4">
          <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border text-3xl font-bold ${GRADE_STYLE[report.grade]}`}>
            {report.grade}
          </div>
          <p className="text-[13px] leading-snug text-ink-muted">{report.gradeNote}</p>
        </div>

        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 border-t border-line px-4 py-4 font-mono text-[13px] tabular-nums">
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">Trades</dt>
            <dd className="text-ink">{report.trades}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">Win rate</dt>
            <dd className="text-ink">{report.winRate}%</dd>
          </div>
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">P&L</dt>
            <dd className={report.totalPnl >= 0 ? 'text-bull-bright' : 'text-bear-bright'}>{money(report.totalPnl)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">Payoff</dt>
            <dd className="text-ink">{report.payoffRatio != null ? `${report.payoffRatio.toFixed(1)}R` : '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">Max DD</dt>
            <dd className="text-bear-bright">{report.maxDrawdown.toLocaleString(undefined, { maximumFractionDigits: 2 })}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">Duration</dt>
            <dd className="text-ink">{report.durationBars} bars</dd>
          </div>
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">Best</dt>
            <dd className="text-bull-bright">{money(report.bestTrade)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">Worst</dt>
            <dd className="text-bear-bright">{money(report.worstTrade)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-sans uppercase text-ink-faint">W / L</dt>
            <dd className="text-ink">{report.wins} / {report.losses}</dd>
          </div>
        </dl>

        <div className="border-t border-line px-4 py-3 text-right">
          <button
            onClick={onClose}
            className="focus-ring rounded-md bg-accent/15 px-4 py-1.5 text-[13px] font-semibold text-ink transition hover:bg-accent/25"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
