'use client';

import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Num } from '@/components/ui';
import { useReplayDataset } from '@/lib/replay/replayDataset';
import { useChallengeUi } from '@/lib/challenges/ui/store';
import { formatChallengeRatio } from '@/lib/challenges/ui/format';

const HEALTH = {
  SAFE: 'text-bull-bright border-bull/30',
  WARNING: 'text-regime-hot border-regime-hot/35',
  DANGER: 'text-bear-bright border-bear/40',
  BREACHED: 'text-bear-bright border-bear/45',
} as const;

export default function ChallengeChartWidget() {
  const replay = useReplayDataset();
  const { attempt, readModel, saving } = useChallengeUi();
  if (!attempt || !readModel || !replay.active || replay.sessionId !== attempt.sourceReplaySessionId) return null;
  return <aside aria-label="Active Prop Challenge" className="absolute left-3 top-3 z-20 w-[248px] overflow-hidden rounded-xl border border-line/80 bg-surface-1/95 elev-2 backdrop-blur-sm sm:left-14">
    <div className="flex items-center justify-between border-b border-line/60 px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-ink"><ShieldCheck className="h-3.5 w-3.5 text-accent" /> Prop Challenge</div>
      <span className={`rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${HEALTH[readModel.identity.health]}`}>{saving ? 'Saving' : readModel.identity.health}</span>
    </div>
    <div className="px-3.5 py-3">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.12em] text-ink-muted"><span>{String(readModel.identity.currentPhaseId).replace('phase-', 'Phase ')}</span><span>Bar Replay</span></div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Metric label="Target" value={formatChallengeRatio(readModel.progress.targetProgress)} />
        <Metric label="Days" value={`${readModel.progress.activeDaysCompleted} / ${readModel.progress.activeDaysRequired}`} />
        <Metric label="Daily risk" node={<Num.MoneyMicros value={readModel.risk.dailyLoss.headroom} whole />} />
        <Metric label="Max risk" node={<Num.MoneyMicros value={readModel.risk.maximumLoss.headroom} whole />} />
      </div>
      <Link href={`/challenges/${readModel.identity.challengeId}`} className="focus-ring mt-3 flex items-center justify-between rounded-lg border border-line/70 bg-surface-2/60 px-2.5 py-2 text-[10px] font-semibold text-ink-muted transition-colors duration-200 hover:border-line-strong hover:text-ink">
        View Challenge <ArrowUpRight className="h-3.5 w-3.5 text-accent" />
      </Link>
    </div>
  </aside>;
}
function Metric({ label, value, node }: { label: string; value?: string; node?: React.ReactNode }) {
  return <div><div className="text-[8px] uppercase tracking-[0.12em] text-ink-muted">{label}</div><div className="num mt-0.5 text-xs font-semibold text-ink">{node ?? value}</div></div>;
}
