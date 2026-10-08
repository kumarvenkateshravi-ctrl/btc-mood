'use client';

import Link from 'next/link';
import { ArrowRight, Clock3, Gauge, Play, ShieldCheck, Target } from 'lucide-react';
import { Button, Num, Panel } from '@/components/ui';
import ChallengeShell from '@/components/challenges/ChallengeShell';
import { useChallengeUi } from '@/lib/challenges/ui/store';
import { formatChallengeRatio, formatReplayMoment } from '@/lib/challenges/ui/format';
import type { ChallengeAttemptSummary } from '@/lib/challenges/persistence';

const tone: Record<string, string> = {
  SAFE: 'text-bull-bright', WARNING: 'text-regime-hot', DANGER: 'text-bear-bright', BREACHED: 'text-bear-bright',
};

export default function ChallengesPage() {
  const { readModel, history } = useChallengeUi();
  return (
    <ChallengeShell>
      <section className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8 border-b border-line/70 pb-10 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              <span className="h-px w-7 bg-accent/60" /> BTC · Bar Replay
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">Prop Challenges</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink-muted">
              Practice prop-style trading rules against historical BTC markets before taking a real evaluation.
            </p>
          </div>
          <Link href="/challenges/new">
            <Button size="lg" variant="solid" icon={<Play className="h-4 w-4" />}>Start Challenge</Button>
          </Link>
        </div>

        {readModel ? (
          <div className="mt-10">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Active attempt</div>
            <Panel className="overflow-hidden p-0">
              <div className="grid lg:grid-cols-[1.25fr_1fr]">
                <div className="border-b border-line/60 p-6 sm:p-8 lg:border-b-0 lg:border-r">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-accent/12 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-accent">Bar Replay</span>
                    <span className="rounded-md border border-line px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{readModel.identity.status}</span>
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${tone[readModel.identity.health]}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {readModel.identity.health}
                    </span>
                  </div>
                  <div className="mt-8 flex flex-wrap items-end gap-x-5 gap-y-2">
                    <Num.MoneyMicros value={readModel.account.startingCash} whole className="text-3xl font-semibold tracking-[-0.04em]" />
                    <span className="pb-1 text-sm text-ink-muted">{readModel.identity.challengeType === 'twoStep' ? 'Two-Step' : 'One-Step'} · {String(readModel.identity.currentPhaseId).replace('-', ' ')}</span>
                  </div>
                  <Link href={`/challenges/${readModel.identity.challengeId}`} className="focus-ring mt-8 inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-accent transition-colors duration-200 hover:text-accent-bright">
                    Continue Challenge <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-px bg-line/50">
                  <Metric icon={Target} label="Target progress" value={formatChallengeRatio(readModel.progress.targetProgress)} />
                  <Metric icon={Gauge} label="Daily risk left" node={<Num.MoneyMicros value={readModel.risk.dailyLoss.headroom} whole />} />
                  <Metric icon={ShieldCheck} label="Maximum risk left" node={<Num.MoneyMicros value={readModel.risk.maximumLoss.headroom} whole />} />
                  <Metric icon={Target} label="Qualified days" value={`${readModel.progress.activeDaysCompleted} / ${readModel.progress.activeDaysRequired}`} />
                </div>
              </div>
            </Panel>
          </div>
        ) : (
          <section className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <Panel className="min-h-64 p-7 sm:p-9">
              <div className="flex h-full flex-col justify-between">
                <div>
                  <ShieldCheck className="h-5 w-5 text-accent" />
                  <h2 className="mt-8 text-xl font-semibold tracking-tight">No active Challenge</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-ink-muted">Start Bar Replay on the BTC chart, choose your evaluation structure, and practice against the frozen historical dataset.</p>
                </div>
                <Link href="/challenges/new" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-accent">Build an attempt <ArrowRight className="h-4 w-4" /></Link>
              </div>
            </Panel>
            <div className="grid gap-px overflow-hidden rounded-xl border border-line/70 bg-line/60">
              <QuietFact label="Execution" value="Deterministic" detail="Same frozen policy for the full attempt" />
              <QuietFact label="Market" value="BTCUSDT" detail="Gold remains outside Challenge v1" />
              <QuietFact label="Risk reset" value="00:00 UTC" detail="Daily equity floor, evaluated inclusively" />
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section className="mt-12 border-t border-line/70 pt-8" aria-labelledby="attempt-history-heading">
            <div className="flex items-end justify-between gap-4">
              <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Durable history</div><h2 id="attempt-history-heading" className="mt-2 text-xl font-semibold">Replay Challenges</h2></div>
              <div className="text-xs text-ink-faint">{history.length} {history.length === 1 ? 'attempt' : 'attempts'}</div>
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-line/70 bg-surface-1">
              {history.map((attempt, index) => <HistoryAttempt key={attempt.challengeId} attempt={attempt} divided={index > 0} />)}
            </div>
          </section>
        )}
      </section>
    </ChallengeShell>
  );
}

function Metric({ icon: Icon, label, value, node }: { icon: typeof Gauge; label: string; value?: string; node?: React.ReactNode }) {
  return <div className="bg-surface-1 p-5 sm:p-6"><Icon className="h-3.5 w-3.5 text-ink-faint" /><div className="mt-5 text-[9px] uppercase tracking-[0.14em] text-ink-faint">{label}</div><div className="mt-1 num text-lg font-semibold text-ink">{node ?? value}</div></div>;
}
function QuietFact({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="bg-surface-1 p-5"><div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{label}</div><div className="mt-2 text-sm font-semibold">{value}</div><div className="mt-1 text-xs leading-5 text-ink-muted">{detail}</div></div>;
}

function HistoryAttempt({ attempt, divided }: { attempt: ChallengeAttemptSummary; divided: boolean }) {
  const active = attempt.status === 'ACTIVE';
  const model = attempt.readModel;
  return <article className={`grid gap-4 p-5 sm:grid-cols-[1.2fr_.75fr_.75fr_auto] sm:items-center sm:p-6 ${divided ? 'border-t border-line/60' : ''}`}>
    <div><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${attempt.status === 'PASSED' ? 'bg-bull' : attempt.status === 'FAILED' ? 'bg-bear' : 'bg-accent'}`} /><span className="text-sm font-semibold">{attempt.challengeType === 'twoStep' ? 'Two-Step' : 'One-Step'} · {attempt.currentPhaseId.replace('-', ' ')}</span></div><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-faint"><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3 w-3" /> Created {formatReplayMoment(attempt.createdAt)}</span><span>Replay {model ? formatReplayMoment(model.replay.logicalTime) : 'unavailable'} · cursor {attempt.activeReplayCursor}</span></div></div>
    <div><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Capital</div><div className="mt-1 text-sm font-semibold"><Num.Money value={Number(attempt.selectedCapital)} /></div></div>
    <div><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Status · target</div><div className="mt-1 text-sm font-semibold">{attempt.status}{model ? ' · ' + formatChallengeRatio(model.progress.targetProgress) : ''}</div></div>
    <div className="flex gap-2"><Link href={`/challenges/${attempt.challengeId}/report`}><Button variant="outline">Report</Button></Link>{active && <Link href={`/challenges/${attempt.challengeId}`}><Button variant="solid">Continue</Button></Link>}</div>
  </article>;
}

