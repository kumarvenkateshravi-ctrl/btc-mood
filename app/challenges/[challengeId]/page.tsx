'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { AlertOctagon, ArrowRight, Check, CheckCircle2, Clock3, DatabaseZap, GitBranch, ShieldCheck, Target } from 'lucide-react';
import ChallengeShell from '@/components/challenges/ChallengeShell';
import { Button, Num, Panel } from '@/components/ui';
import type { ChallengeReplayReadModel } from '@/lib/challenges/replay/types';
import type { LossRuleEvaluation } from '@/lib/challenges/rules/types';
import { clearChallengeRejection, restoreChallengeAttempt, useChallengeUi } from '@/lib/challenges/ui/store';
import { challengeRatioWidth, formatChallengeRatio, formatReplayMoment } from '@/lib/challenges/ui/format';

const STATUS_TONE = {
  SAFE: { text: 'text-bull-bright', bar: 'bg-bull', edge: 'border-bull/25' },
  WARNING: { text: 'text-regime-hot', bar: 'bg-regime-hot', edge: 'border-regime-hot/35' },
  DANGER: { text: 'text-bear-bright', bar: 'bg-bear', edge: 'border-bear/45' },
  BREACHED: { text: 'text-bear-bright', bar: 'bg-bear', edge: 'border-bear/50' },
} as const;

export default function ChallengeDashboardPage({ params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = use(params);
  const requestedId = decodeURIComponent(challengeId);
  const { attempt, readModel } = useChallengeUi();
  useEffect(() => {
    if (String(readModel?.identity.challengeId ?? '') !== requestedId) void restoreChallengeAttempt(requestedId);
  }, [readModel?.identity.challengeId, requestedId]);
  if (!readModel || String(readModel.identity.challengeId) !== requestedId) {
    return <ChallengeShell><EmptyAttempt /></ChallengeShell>;
  }
  const terminal = readModel.lifecycle.challengeStatus === 'FAILED' || readModel.lifecycle.challengeStatus === 'PASSED' || readModel.lifecycle.phaseStatus === 'PASSED';
  return (
    <ChallengeShell>
      <section className="mx-auto max-w-7xl">
        <ChallengeHeader model={readModel} />
        <div aria-live="polite" aria-atomic="true">
          {attempt?.branched && <ContextNotice icon={GitBranch} title="New replay branch" detail="Branched from an earlier point. Future outcomes from the prior branch were removed." />}
          {readModel.replay.availability === 'DATASET_EXHAUSTED' && <ContextNotice icon={DatabaseZap} title="Replay data ended" detail="Historical data ended before this Challenge was completed. Current status remains unchanged." />}
          {attempt?.lastRejection && <ContextNotice icon={AlertOctagon} title="Command rejected" detail={attempt.lastRejection} action={<button onClick={clearChallengeRejection} className="focus-ring rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted hover:text-ink">Dismiss</button>} danger />}
          {terminal && <TerminalState model={readModel} />}
        </div>

        <div className={terminal ? 'transition-opacity duration-200' : ''}>
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.04fr_.96fr]">
            <TargetPanel model={readModel} />
            <AccountPanel model={readModel} />
          </div>
          <section aria-labelledby="risk-heading" className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Risk control</div><h2 id="risk-heading" className="mt-1 text-lg font-semibold tracking-tight">Loss limits</h2></div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Evaluated against equity</div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <RiskPanel title="Daily loss" reset="Resets 00:00 UTC" risk={readModel.risk.dailyLoss} />
              <RiskPanel title="Maximum loss" reset="Static phase floor" risk={readModel.risk.maximumLoss} />
            </div>
          </section>
          <div className="mt-8 grid gap-4 lg:grid-cols-[1.35fr_.65fr]">
            <Requirements model={readModel} />
            <PhaseProgress model={readModel} />
          </div>
        </div>
      </section>
    </ChallengeShell>
  );
}

function ChallengeHeader({ model }: { model: ChallengeReplayReadModel }) {
  const status = STATUS_TONE[model.identity.health];
  return <header className="border-b border-line/70 pb-6">
    <h1 className="sr-only">{model.identity.challengeType === 'twoStep' ? 'Two-Step' : 'One-Step'} Prop Challenge account</h1>
    <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Prop Challenge</div>
        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <Num.MoneyMicros value={model.account.startingCash} whole className="text-3xl font-semibold tracking-[-0.045em]" />
          <span className="pb-1 text-sm text-ink-muted">{model.identity.challengeType === 'twoStep' ? 'Two-Step' : 'One-Step'} · {phaseName(model.identity.currentPhaseId)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label>BTCUSDT</Label><Label>Bar Replay</Label><Label>00:00 UTC reset</Label>
        <span className="h-5 w-px bg-line" />
        <span className="rounded-md border border-line px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink">{model.identity.status}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${status.text} ${status.edge}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{model.identity.health}</span>
      </div>
    </div>
  </header>;
}

function TargetPanel({ model }: { model: ChallengeReplayReadModel }) {
  const pct = ratioPercent(model.progress.targetProgress);
  return <Panel className="p-6 sm:p-7">
    <div className="flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Profit target</div><Target className="h-4 w-4 text-accent" /></div>
    <div className="mt-7 flex items-end justify-between gap-6">
      <div><div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Current profit</div><Num.PnlMicros value={model.progress.phaseNetPnl} className="mt-1 block text-3xl tracking-[-0.04em]" /></div>
      <div className="text-right"><div className="num text-xl font-semibold text-accent">{pct.label}</div><div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-faint">Complete</div></div>
    </div>
    <Progress width={pct.width} tone="accent" />
    <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line/60 pt-4">
      <SmallMoney label="Target" value={model.progress.profitTarget} signed tone />
      <SmallMoney label="Remaining" value={model.progress.targetRemaining} align="right" />
    </div>
  </Panel>;
}

function AccountPanel({ model }: { model: ChallengeReplayReadModel }) {
  return <Panel className="p-6 sm:p-7">
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Account overview</div>
    <div className="mt-6 grid grid-cols-2 gap-x-7 gap-y-5 sm:grid-cols-3">
      <SmallMoney label="Cash" value={model.account.cash} />
      <SmallMoney label="Equity" value={model.account.equity} />
      <SmallMoney label="Realized gross" value={model.account.realizedGrossPnl} signed tone />
      <SmallMoney label="Unrealized" value={model.account.unrealizedPnl} signed tone />
      <SmallMoney label="Fees" value={model.account.commissions} />
      <SmallMoney label="Used margin" value={model.account.usedMargin} />
      <SmallMoney label="Free margin" value={model.account.freeMargin} />
    </div>
  </Panel>;
}

function RiskPanel({ title, reset, risk }: { title: string; reset: string; risk: LossRuleEvaluation }) {
  const style = STATUS_TONE[risk.status === 'PASSED' || risk.status === 'NOT_APPLICABLE' ? 'SAFE' : risk.status];
  const pct = ratioPercent(risk.consumptionRatio);
  return <Panel className={`relative overflow-hidden border ${style.edge} p-6 sm:p-7`}>
    <div aria-hidden className={`absolute inset-x-0 top-0 h-px ${style.bar}`} />
    <div className="flex items-start justify-between">
      <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{title}</div><div className="mt-1 text-[10px] text-ink-faint">{reset}</div></div>
      <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${style.text}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{risk.status}</span>
    </div>
    <div className="mt-7"><Num.MoneyMicros value={risk.headroom} whole className={`block text-4xl font-semibold tracking-[-0.045em] ${style.text}`} /><div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Risk left</div></div>
    <Progress width={pct.width} tone={risk.status === 'SAFE' ? 'safe' : risk.status === 'WARNING' ? 'warning' : 'danger'} />
    <div className="mt-5 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
      <SmallMoney label="Used" value={risk.consumedAmount} />
      <SmallMoney label="Allowance" value={risk.allowance} />
      <SmallMoney label="Floor" value={risk.floor} />
      <div className="sm:text-right"><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Consumption</div><div className="num mt-1 text-sm font-semibold text-ink">{pct.label}</div></div>
    </div>
  </Panel>;
}

function Requirements({ model }: { model: ChallengeReplayReadModel }) {
  const days = model.progress.activeDaysCompleted;
  const profitable = model.progress.profitableDaysCompleted;
  return <Panel className="p-6 sm:p-7">
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Challenge requirements</div>
    <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
      <DayRequirement label="Trading days" complete={days} required={model.progress.activeDaysRequired} />
      <DayRequirement label="Profitable days" complete={profitable} required={model.progress.profitableDaysRequired} />
      <div>
        <div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Current day</div>
        <Num.MoneyMicros value={model.progress.currentDay.settledNetPnl} signed tone className="mt-2 block text-lg font-semibold" />
        <div className="mt-1 text-[10px] text-ink-muted">
          {!model.progress.currentDay.active
            ? 'No exposure-increasing fill yet'
            : model.progress.currentDay.thresholdMet
              ? 'Above threshold · pending UTC finalization'
              : 'Below threshold · pending UTC finalization'}
        </div>
      </div>
      <div><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Inactivity</div><div className="num mt-2 text-lg font-semibold">{remainingDays(model.risk.inactivity.remainingDurationMs)} days</div><div className="mt-1 text-[10px] text-ink-muted">remaining before breach</div></div>
    </div>
    <div className="mt-6 flex items-start gap-2 border-t border-line/60 pt-4 text-[11px] leading-5 text-ink-muted"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" /> Days qualify only after UTC finalization. Entry fees stay on the entry day; exit P&amp;L and fees stay on the exit day.</div>
  </Panel>;
}

function PhaseProgress({ model }: { model: ChallengeReplayReadModel }) {
  const two = model.identity.challengeType === 'twoStep';
  const current = String(model.identity.currentPhaseId);
  const firstStatus = current === 'phase-2' || model.lifecycle.challengeStatus === 'PASSED' ? 'PASSED' : model.lifecycle.phaseStatus;
  const secondStatus = !two ? null : current === 'phase-2' ? model.lifecycle.phaseStatus : model.lifecycle.challengeStatus === 'PASSED' ? 'PASSED' : 'LOCKED';
  return <Panel className="p-6 sm:p-7">
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Phase progress</div>
    <div className="mt-6 space-y-5">
      <PhaseRow phase="Phase 1" target="10%" status={firstStatus} />
      {two && <PhaseRow phase="Phase 2" target="8%" status={secondStatus ?? 'LOCKED'} />}
    </div>
    <div className="mt-6 border-t border-line/60 pt-4 text-[10px] leading-4 text-ink-faint">A phase completes only when target and day requirements are satisfied while flat with no working orders.</div>
  </Panel>;
}

function TerminalState({ model }: { model: ChallengeReplayReadModel }) {
  if (model.lifecycle.challengeStatus === 'FAILED') {
    const evidence = model.lifecycle.terminalBreachEvidence;
    return <Panel className="mt-6 border border-bear/35 p-6 sm:p-7">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-bear-bright"><AlertOctagon className="h-4 w-4" /> Challenge failed</div><h2 className="mt-3 text-2xl font-semibold tracking-tight">{evidence?.ruleKind === 'inactivity' ? 'Inactivity limit exceeded' : evidence?.ruleId.includes('daily') ? 'Daily loss limit exceeded' : 'Maximum loss limit exceeded'}</h2>
          {evidence?.metric === 'equity' && <div className="mt-6 grid max-w-3xl grid-cols-2 gap-5 sm:grid-cols-5"><SmallMoney label="Observed equity" value={evidence.actual as bigint} /><SmallMoney label="Allowed floor" value={evidence.threshold as bigint} /><SmallMoney label="Exceeded by" value={evidence.excess as bigint} /><div><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Phase</div><div className="mt-1 text-sm font-semibold">{phaseName(model.identity.currentPhaseId)}</div></div><div><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Replay time</div><div className="num mt-1 text-xs font-semibold">{formatReplayMoment(model.replay.logicalTime)}</div></div></div>}
        </div>
        <div className="flex gap-2"><Link href={'/app?challenge=' + model.identity.challengeId}><Button variant="outline">Rewind Replay</Button></Link><Link href={`/challenges/${model.identity.challengeId}/report`}><Button variant="outline">Open report</Button></Link></div>
      </div>
    </Panel>;
  }
  const challengePassed = model.lifecycle.challengeStatus === 'PASSED';
  return <Panel className="mt-6 border border-bull/30 p-6 sm:p-7">
    <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-bull-bright"><CheckCircle2 className="h-4 w-4" /> {challengePassed ? 'Challenge passed' : `${phaseName(model.identity.currentPhaseId)} passed`}</div><h2 className="mt-3 text-2xl font-semibold tracking-tight">{challengePassed ? 'Evaluation complete' : 'Next phase is ready'}</h2><div className="mt-6 grid max-w-3xl grid-cols-2 gap-5 sm:grid-cols-4"><SmallMoney label="Target achieved" value={model.progress.phaseNetPnl} signed tone /><SmallMoney label="Final cash" value={model.account.cash} /><div><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Trading days</div><div className="num mt-1 text-sm font-semibold">{model.progress.activeDaysCompleted}</div></div><div><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Profitable days</div><div className="num mt-1 text-sm font-semibold">{model.progress.profitableDaysCompleted}</div></div></div></div><Link href={'/app?challenge=' + model.identity.challengeId}><Button variant="solid" icon={<ArrowRight className="h-4 w-4" />}>{challengePassed ? 'Review on chart' : 'Continue to next phase'}</Button></Link></div>
  </Panel>;
}

function ContextNotice({ icon: Icon, title, detail, action, danger }: { icon: typeof GitBranch; title: string; detail: string; action?: React.ReactNode; danger?: boolean }) {
  return <div className={`mt-4 flex items-start gap-3 rounded-xl border px-4 py-3 ${danger ? 'border-bear/30 bg-bear/[0.06]' : 'border-accent/25 bg-accent/[0.06]'}`}><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${danger ? 'text-bear-bright' : 'text-accent'}`} /><div className="min-w-0 flex-1"><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">{title}</div><div className="mt-0.5 text-[11px] leading-5 text-ink-muted">{detail}</div></div>{action}</div>;
}
function DayRequirement({ label, complete, required }: { label: string; complete: number; required: number }) {
  return <div><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">{label}</div><div className="num mt-2 text-lg font-semibold">{complete} / {required}</div><div className="mt-3 flex gap-1.5" role="img" aria-label={`${complete} of ${required} completed`}>{Array.from({ length: required }, (_, i) => <span key={i} className={`flex h-5 w-5 items-center justify-center rounded-full border ${i < complete ? 'border-bull/35 bg-bull/12 text-bull-bright' : 'border-line bg-surface-2 text-ink-faint'}`}>{i < complete ? <Check className="h-3 w-3" /> : <span className="h-1 w-1 rounded-full bg-current" />}</span>)}</div></div>;
}
function PhaseRow({ phase, target, status }: { phase: string; target: string; status: string }) {
  const passed = status === 'PASSED'; const active = status === 'ACTIVE';
  return <div className="flex items-center gap-3"><span className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] ${passed ? 'border-bull/35 bg-bull/12 text-bull-bright' : active ? 'border-accent/40 bg-accent/12 text-accent' : 'border-line text-ink-faint'}`}>{passed ? <Check className="h-3.5 w-3.5" /> : phase.slice(-1)}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{phase}</span><span className={`text-[9px] font-semibold uppercase tracking-[0.14em] ${passed ? 'text-bull-bright' : active ? 'text-accent' : 'text-ink-faint'}`}>{status}</span></div><div className="mt-1 text-[10px] text-ink-faint">Target {target}</div></div></div>;
}
function Progress({ width, tone }: { width: string; tone: 'accent' | 'safe' | 'warning' | 'danger' }) {
  const color = tone === 'accent' ? 'bg-accent' : tone === 'safe' ? 'bg-bull' : tone === 'warning' ? 'bg-regime-hot' : 'bg-bear';
  return <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden><div className={`h-full rounded-full ${color} transition-[width] duration-200 ease-[cubic-bezier(.25,1,.5,1)] motion-reduce:transition-none`} style={{ width }} /></div>;
}
function SmallMoney({ label, value, signed, tone, align }: { label: string; value: bigint; signed?: boolean; tone?: boolean; align?: 'right' }) {
  return <div className={align === 'right' ? 'text-right' : ''}><div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">{label}</div><Num.MoneyMicros value={value} signed={signed} tone={tone} className="mt-1 block text-sm font-semibold" /></div>;
}
function Label({ children }: { children: React.ReactNode }) { return <span className="rounded-md bg-surface-2 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{children}</span>; }
function phaseName(id: string) { return id.replace('phase-', 'Phase '); }
function ratioPercent(value: string) { return { label: formatChallengeRatio(value), width: challengeRatioWidth(value) }; }
function remainingDays(ms: number) { return Math.max(0, Math.ceil(ms / 86_400_000)); }
function EmptyAttempt() { return <div className="mx-auto max-w-xl py-20 text-center"><ShieldCheck className="mx-auto h-6 w-6 text-ink-faint" /><h1 className="mt-5 text-2xl font-semibold">Challenge attempt unavailable</h1><p className="mt-2 text-sm leading-6 text-ink-muted">The requested persisted attempt could not be loaded. Return to Challenge history or start a new attempt from an active BTC Bar Replay dataset.</p><Link href="/challenges/new" className="mt-6 inline-flex"><Button variant="solid">Build Challenge</Button></Link></div>; }

