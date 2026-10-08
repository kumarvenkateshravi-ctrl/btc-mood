'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertOctagon, CheckCircle2, LoaderCircle } from 'lucide-react';
import ChallengeShell from './ChallengeShell';
import { ChallengeReadinessSection } from './ChallengeReadiness';
import { Button, Cell, DataTable, Num, Panel, textColumn, type Column } from '@/components/ui';
import { IndexedDbChallengeReplayRepository, ChallengePersistenceError } from '@/lib/challenges/persistence';
import type { ChallengeReportReadModel, ChallengeReportPhase, ChallengeReportDay, ChallengeReportTrade } from '@/lib/challenges/report';
import { loadChallengeReportWithReadiness, type ChallengeReadinessReadModel } from '@/lib/challenges/readiness';
import { formatChallengeRatio, formatReplayMoment } from '@/lib/challenges/ui/format';

const tone = (status: string) => status === 'FAILED' || status === 'BREACHED' || status === 'DANGER' ? 'text-bear-bright' : status === 'WARNING' ? 'text-regime-hot' : status === 'PASSED' || status === 'SAFE' ? 'text-bull-bright' : 'text-ink-muted';
const phaseLabel = (phase: string) => phase.replace('phase-', 'Phase ');
const eventLabel = (kind: string) => kind.replace(/([a-z])([A-Z])/g, '$1 $2');
const reasonLabel = (reason: string | null) => reason ? eventLabel(reason).replace(/^./, value => value.toUpperCase()) : 'In progress';
function MoneyValue({ value, signed = false }: { value: bigint; signed?: boolean }) { return <Num.MoneyMicros value={value} signed={signed} tone={signed} />; }
function metricColumn<T>(key: string, header: string, value: (row: T) => bigint, signed = false): Column<T> {
  return { key, header, align: 'right', cell: row => <Cell align="right"><MoneyValue value={value(row)} signed={signed} /></Cell> };
}
function EvidenceValue({ value }: { value: bigint | number | null }) {
  if (value === null) return <span className="text-ink-faint">—</span>;
  if (typeof value === 'bigint') return <MoneyValue value={value} />;
  return <span className="num">{value > 1_000_000_000_000 ? formatReplayMoment(value) : `${Math.ceil(value / 60_000)} min`}</span>;
}
function Metric({ label, value, signed, hero }: { label: string; value: bigint; signed?: boolean; hero?: boolean }) {
  return <div><div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</div><Num.MoneyMicros value={value} signed={signed} tone={signed} className={`mt-2 block font-semibold tracking-[-0.035em] ${hero ? 'text-3xl sm:text-4xl' : 'text-lg'}`} /></div>;
}
function SectionHeading({ id, eyebrow, title, detail }: { id: string; eyebrow: string; title: string; detail?: string }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{eyebrow}</div><h2 id={id} className="mt-2 text-xl font-semibold tracking-tight">{title}</h2></div>{detail && <p className="text-xs text-ink-muted">{detail}</p>}</div>;
}

export default function ChallengeReportScreen({ challengeId }: { challengeId: string }) {
  const [loaded, setLoaded] = useState<{ report: ChallengeReportReadModel | null; readiness: ChallengeReadinessReadModel | null; error: string | null; code: string | null }>({ report: null, readiness: null, error: null, code: null });
  useEffect(() => {
    let cancelled = false;
    const repository = new IndexedDbChallengeReplayRepository();
    void loadChallengeReportWithReadiness(repository, challengeId).then(result => {
      if (!cancelled) setLoaded({ report: result.report, readiness: result.readiness, error: null, code: null });
    }).catch(error => {
      if (!cancelled) setLoaded({ report: null, readiness: null, error: error instanceof Error ? error.message : 'Report evidence could not be loaded.', code: error instanceof ChallengePersistenceError ? error.code : 'CORRUPT' });
    });
    return () => { cancelled = true; };
  }, [challengeId]);
  return <ChallengeShell recover={false} challengeId={challengeId}>
    {loaded.report && loaded.readiness ? <ChallengeReportView report={loaded.report} readiness={loaded.readiness} /> : <Panel className="mx-auto max-w-xl p-9 text-center" aria-live="polite">
      {loaded.error ? <><AlertOctagon className="mx-auto h-5 w-5 text-bear-bright" /><div className="mt-5 text-[10px] uppercase tracking-[0.16em] text-bear-bright">{loaded.code}</div><h1 className="mt-2 text-xl font-semibold">Report unavailable</h1><p className="mt-3 text-sm leading-6 text-ink-muted">{loaded.error}</p><Link href="/challenges" className="mt-7 inline-flex"><Button variant="outline">Challenge history</Button></Link></> : <><LoaderCircle className="mx-auto h-5 w-5 animate-spin text-accent motion-reduce:animate-none" /><h1 className="mt-5 text-xl font-semibold">Building your report</h1><p className="mt-3 text-sm leading-6 text-ink-muted">Reading the frozen attempt and validating its complete execution evidence.</p></>}
    </Panel>}
  </ChallengeShell>;
}

export function ChallengeReportView({ report, readiness }: { report: ChallengeReportReadModel; readiness?: ChallengeReadinessReadModel }) {
  const s = report.summary;
  return <article className="mx-auto max-w-7xl space-y-10 sm:space-y-12">
    <header className="border-b border-line/70 pb-7">
      <Link href={`/challenges/${s.challengeId}`} className="focus-ring inline-flex items-center gap-2 rounded text-xs text-ink-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Challenge account</Link>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5"><div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Challenge report · BTCUSDT</div><h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Your evaluation, in evidence.</h1><p className="mt-3 text-sm text-ink-muted"><Num.MoneyMicros value={s.startingCash} whole /> · {s.challengeType === 'twoStep' ? 'Two-Step' : 'One-Step'} · {phaseLabel(s.currentPhaseId)} · Bar Replay</p></div><div className="flex gap-3"><span className={`rounded-md border border-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${tone(s.status)}`}>{s.status === 'ACTIVE' ? 'In progress' : s.status}</span><span className={`py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${tone(s.health)}`}>{s.health}</span></div></div>
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-ink-faint"><span>{formatReplayMoment(s.replayStartedAt)} → {formatReplayMoment(s.replayEndedAt)}</span><span>{s.timeframe} execution</span><span>Current branch · generation {report.branch.generation}</span></div>
    </header>
    <section aria-labelledby="summary-heading"><h2 id="summary-heading" className="sr-only">Challenge summary</h2><Panel className="p-7 sm:p-9">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]"><div><Metric label={s.status === 'ACTIVE' ? 'Current equity' : 'Final equity'} value={s.currentEquity} hero /><div className="mt-7 grid grid-cols-2 gap-7"><Metric label="Cash balance" value={s.currentCash} /><Metric label="Net settled P&L · all phases" value={s.netPnl} signed /></div></div><div className="border-t border-line/60 pt-7 lg:border-l lg:border-t-0 lg:pl-9 lg:pt-0"><div className="flex items-end justify-between"><Metric label="Current phase target" value={s.targetAmount} /><div className="text-right"><div className="num text-2xl font-semibold tracking-tight">{formatChallengeRatio(s.targetProgress)}</div><div className="mt-1 text-[10px] text-ink-faint">target achieved</div></div></div><div className="mt-7 grid grid-cols-2 gap-7"><Metric label="Gross realized · all phases" value={s.grossPnl} signed /><Metric label="Commissions · all phases" value={s.fees} /></div></div></div>
      <div className="mt-8 grid gap-4 border-t border-line/60 pt-5 sm:grid-cols-3"><div className="text-xs text-ink-muted">Starting cash <span className="ml-2 text-ink"><MoneyValue value={s.startingCash} /></span></div><div className="text-xs text-ink-muted">Active days <span className="num ml-2 text-ink">{s.activeDays[0]} / {s.activeDays[1]}</span></div><div className="text-xs text-ink-muted">Profitable days <span className="num ml-2 text-ink">{s.profitableDays[0]} / {s.profitableDays[1]}</span></div></div>
    </Panel></section>
    {readiness && <ChallengeReadinessSection readiness={readiness} />}
    <PhaseResults phases={report.phases} />
    <DailyResults days={report.days} />
    <TradeResults trades={report.trades} />
    <section aria-labelledby="risk-timeline-heading"><SectionHeading id="risk-timeline-heading" eyebrow="Risk control" title="Risk timeline" detail="Canonical rule transitions" /><Panel className="p-6 sm:p-7"><div className="space-y-0">{report.riskTimeline.length === 0 ? <p className="text-sm text-ink-muted">No risk transitions recorded.</p> : report.riskTimeline.map(event => <div key={event.decisionId} className="grid gap-3 border-b border-line/50 py-4 last:border-0 md:grid-cols-[1.1fr_1fr_1.5fr]"><div><div className={`text-xs font-semibold ${tone(event.status)}`}>{event.status} {event.kind === 'WarningRearmed' ? '· rearmed' : ''}</div><div className="mt-1 text-[10px] text-ink-faint">{formatReplayMoment(event.occurredAt)} · #{event.sequence}</div></div><div className="text-xs text-ink-muted">{phaseLabel(event.phaseId)}<div className="mt-1 text-ink">{event.ruleId}</div></div><div className="grid gap-3 text-xs sm:grid-cols-3 sm:text-right"><div><div className="mb-1 text-[9px] uppercase text-ink-faint">Observed</div><EvidenceValue value={event.observed} /></div><div><div className="mb-1 text-[9px] uppercase text-ink-faint">Floor / deadline</div><EvidenceValue value={event.floor} /></div><div><div className="mb-1 text-[9px] uppercase text-ink-faint">Headroom</div><EvidenceValue value={event.headroom} /></div></div></div>)}</div></Panel></section>
    <section aria-labelledby="decision-timeline-heading"><SectionHeading id="decision-timeline-heading" eyebrow="Lifecycle" title="Decision timeline" detail="Ordered by canonical decision sequence" /><Panel className="p-6 sm:p-7"><div className="grid gap-x-8 lg:grid-cols-2">{report.decisionTimeline.map(event => <div key={event.decisionId} className="flex gap-4 border-b border-line/50 py-3"><span className="num w-7 shrink-0 pt-0.5 text-[10px] text-ink-faint">{event.sequence}</span><div className="min-w-0"><div className={`text-xs font-medium ${tone(event.status ?? '')}`}>{eventLabel(event.kind)}</div><div className="mt-1 text-[10px] text-ink-faint">{formatReplayMoment(event.occurredAt)} · {phaseLabel(event.phaseId)}{event.ruleId ? ` · ${event.ruleId}` : ''}</div></div></div>)}</div>{report.branch.creationReason === 'rewind' && <div className="mt-5 border-t border-line pt-4 text-xs text-ink-muted">Replay branch created from cursor {report.branch.forkCursor}. Only this branch’s retained causal history contributes to the report.</div>}</Panel></section>
    <OutcomeAnalysis report={report} />
    <EvidenceDetails report={report} />
  </article>;
}

function PhaseResults({ phases }: { phases: readonly ChallengeReportPhase[] }) {
  const columns: Column<ChallengeReportPhase>[] = [
    textColumn({ key: 'phase', header: 'Phase', value: row => row.name }),
    textColumn({ key: 'status', header: 'Result', value: row => row.status }),
    metricColumn('capital', 'Starting cash', row => row.startingCash),
    { key: 'target', header: 'Target', align: 'right', cell: row => <Cell align="right">{row.targetAmount === null ? <span className="text-ink-faint">Pending activation</span> : <MoneyValue value={row.targetAmount} />}</Cell> },
    { key: 'cash', header: 'Cash', align: 'right', cell: row => <Cell align="right">{row.endingCash === null ? <span className="text-ink-faint">—</span> : <MoneyValue value={row.endingCash} />}</Cell> }, metricColumn('net', 'Net P&L', row => row.netPnl, true),
    metricColumn('fees', 'Fees', row => row.fees),
    textColumn({ key: 'days', header: 'Active / profitable', value: row => `${row.activeDays[0]}/${row.activeDays[1]} · ${row.profitableDays[0]}/${row.profitableDays[1]}`, align: 'right' }),
  ];
  return <section aria-labelledby="phase-results-heading"><SectionHeading id="phase-results-heading" eyebrow="Evaluation structure" title="Phase results" detail="Capital and counters remain separate" /><Panel className="p-6 sm:p-7"><DataTable columns={columns} rows={[...phases]} rowKey={row => row.phaseId} minWidth={940} density="comfortable" />
    <div className="mt-6 grid gap-5 border-t border-line/60 pt-5 md:grid-cols-2">{phases.map(phase => <div key={phase.phaseId} className="text-[11px] leading-6 text-ink-muted"><div className="font-semibold text-ink">{phase.name}</div><div>Start: {phase.startedAt === null ? 'Not activated' : `${formatReplayMoment(phase.startedAt)} · cursor ${phase.startCursor ?? '—'}`}</div><div>Terminal: {phase.endedAt === null ? 'Pending' : `${formatReplayMoment(phase.endedAt)} · cursor ${phase.endCursor ?? '—'}`}</div><div>Gross realized <MoneyValue value={phase.grossPnl} signed /> · Equity {phase.endingEquity === null ? '—' : <MoneyValue value={phase.endingEquity} />}</div>{phase.failure && <div className="mt-1 text-bear-bright">{phase.failure.ruleId} · {reasonLabel(phase.failure.ruleKind)}</div>}</div>)}</div>
  </Panel></section>;
}
function DailyResults({ days }: { days: readonly ChallengeReportDay[] }) {
  const columns: Column<ChallengeReportDay>[] = [
    textColumn({ key: 'date', header: 'UTC date', value: row => row.dayId, sortable: true }),
    textColumn({ key: 'phase', header: 'Phase', value: row => phaseLabel(row.phaseId) }),
    textColumn({ key: 'state', header: 'Day state', value: row => row.state === 'IN_PROGRESS' ? 'IN PROGRESS' : row.active ? 'Active · finalized' : 'Inactive · finalized' }),
    metricColumn('gross', 'Gross', row => row.grossPnl, true), metricColumn('fees', 'Fees', row => row.fees), metricColumn('net', 'Settled net', row => row.settledNetPnl, true),
    metricColumn('threshold', 'Threshold', row => row.profitableThreshold),
    textColumn({ key: 'qualified', header: 'Profitable day', value: row => row.state === 'IN_PROGRESS' ? 'Pending' : row.qualified ? 'Yes' : 'No' }),
    metricColumn('low', 'Lowest equity', row => row.lowestEquity), metricColumn('floor', 'Daily floor', row => row.dailyFloor), metricColumn('usage', 'Max daily usage', row => row.maximumDailyLossUsage),
  ];
  return <section aria-labelledby="daily-performance-heading"><SectionHeading id="daily-performance-heading" eyebrow="UTC settlement" title="Daily performance" detail="Entry fees stay on their entry day" /><Panel className="p-6 sm:p-7"><div className="max-h-[440px]"><DataTable columns={columns} rows={[...days]} rowKey={row => `${row.phaseId}:${row.dayId}`} minWidth={1400} density="comfortable" virtualize={days.length > 100} /></div><details className="mt-5 border-t border-line/60 pt-4"><summary className="focus-ring cursor-pointer rounded text-xs font-medium text-ink-muted">Day balances</summary><div className="mt-4 max-h-80 overflow-y-auto space-y-3">{days.map(day => <div key={`${day.phaseId}:${day.dayId}`} className="flex flex-wrap justify-between gap-3 text-xs text-ink-muted"><span>{day.dayId} · {phaseLabel(day.phaseId)}</span><span className="text-ink">Start <MoneyValue value={day.startingCash} /> · {day.state === 'IN_PROGRESS' ? 'Current' : 'End'} cash <MoneyValue value={day.endingCash} /> · equity <MoneyValue value={day.endingEquity} /></span></div>)}</div></details></Panel></section>;
}
function TradeResults({ trades }: { trades: readonly ChallengeReportTrade[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const columns: Column<ChallengeReportTrade>[] = [
    textColumn({ key: 'side', header: 'Side · phase', value: row => `${row.side.toUpperCase()} · ${phaseLabel(row.phaseId)}` }),
    { key: 'entry', header: 'First entry', sortable: true, sortValue: row => row.entryAt, cell: row => <Cell><div>{formatReplayMoment(row.entryAt)}</div><Num.Price value={Number(row.entryPrice)} precision={2} className="text-ink-muted" /></Cell> },
    { key: 'qty', header: 'Entry quantity', align: 'right', cell: row => <Cell align="right"><Num.Qty value={Number(row.entryQuantity)} unit="BTC" precision={8} /></Cell> },
    { key: 'exit', header: 'Final exit', cell: row => <Cell>{row.exitAt === null ? <span className="text-ink-faint">IN PROGRESS</span> : <><div>{formatReplayMoment(row.exitAt)}</div><Num.Price value={Number(row.exitPrice)} precision={2} className="text-ink-muted" /></>}</Cell> },
    metricColumn('gross', 'Gross', row => row.grossPnl, true), metricColumn('fees', 'Fees', row => row.entryFees + row.exitFees), metricColumn('net', 'Net', row => row.netPnl, true),
    textColumn({ key: 'reason', header: 'Close reason', value: row => reasonLabel(row.exitReason), sortable: true }),
    textColumn({ key: 'history', header: 'Lifecycle', value: row => [row.partialClose ? 'Partial' : '', row.reversal ? 'Reversal' : '', row.protection?.trailingEnabled ? 'Trailing' : ''].filter(Boolean).join(' · ') || row.status }),
  ];
  const trade = trades.find(item => item.lifecycleId === selected);
  return <section aria-labelledby="trade-lifecycles-heading"><SectionHeading id="trade-lifecycles-heading" eyebrow="Execution history" title="Trade lifecycles" detail="Select a row to inspect every fill" /><Panel className="p-6 sm:p-7"><div className="max-h-[440px]"><DataTable columns={columns} rows={[...trades]} rowKey={row => row.lifecycleId} minWidth={1140} density="comfortable" virtualize={trades.length > 100} onRowClick={row => setSelected(row.lifecycleId)} empty="No executed trade lifecycles in this branch." /></div>{trade && <div className="mt-6 border-t border-line pt-5"><div className="flex justify-between"><h3 className="text-sm font-semibold">{trade.side.toUpperCase()} · {phaseLabel(trade.phaseId)} · {trade.status}</h3><button onClick={() => setSelected(null)} className="focus-ring rounded text-xs text-ink-muted">Close details</button></div><p className="mt-2 text-xs text-ink-muted">Duration {Math.floor(trade.durationMs / 60_000)} min · {trade.fills.length} fills · Closed quantity <Num.Qty value={Number(trade.closedQuantity)} unit="BTC" precision={8} /></p><div className="mt-4 space-y-3">{trade.fills.map(fill => <div key={fill.fillId} className="flex flex-wrap justify-between gap-3 border-b border-line/40 pb-3 text-xs"><span className="text-ink-muted">{formatReplayMoment(fill.occurredAt)} · {fill.classification} · {reasonLabel(fill.reason)}</span><span><Num.Qty value={Number(fill.quantity)} unit="BTC" precision={8} /> @ <Num.Price value={Number(fill.price)} precision={2} /> · fee <MoneyValue value={fill.commission} /></span></div>)}</div><div className="mt-4 text-xs leading-6 text-ink-muted">{trade.protectionHistory.length ? trade.protectionHistory.map((event, index) => <div key={index}>{formatReplayMoment(event.occurredAt)} · {event.source} · SL {event.after.stopLoss ? <Num.Price value={Number(event.after.stopLoss)} precision={2} /> : 'none'} · TP {event.after.takeProfit ? <Num.Price value={Number(event.after.takeProfit)} precision={2} /> : 'none'} · trailing {event.after.trailingEnabled ? 'on' : 'off'}</div>) : 'No protective levels were recorded.'}</div>{trade.reversal && <div className="mt-3 text-xs text-ink-muted">Reversal opened a separate opposite lifecycle; protection was reset. Related lifecycle evidence: {trade.relatedLifecycleIds.length}.</div>}</div>}</Panel></section>;
}
function OutcomeAnalysis({ report }: { report: ChallengeReportReadModel }) {
  const failure = report.failureAnalysis;
  const pass = report.passAnalysis;
  if (!failure && !pass) return <section aria-labelledby="outcome-heading"><SectionHeading id="outcome-heading" eyebrow="Outcome" title="Evaluation in progress" /><p className="max-w-2xl text-sm leading-6 text-ink-muted">This branch has no terminal result. Targets and day requirements remain subject to the next canonical checkpoint; touching a target does not force a close.</p></section>;
  const breach = failure?.primaryBreach;
  return <section aria-labelledby="outcome-heading"><SectionHeading id="outcome-heading" eyebrow="Outcome evidence" title={failure ? 'Failure analysis' : 'Pass analysis'} /><Panel className={`p-7 sm:p-9 ${failure ? 'border-bear/30' : 'border-bull/25'}`}>
    <div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${failure ? 'text-bear-bright' : 'text-bull-bright'}`}>{failure ? <AlertOctagon className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{failure ? 'Hard breach recorded' : 'Challenge passed'}</div>
    <h3 className="mt-4 text-2xl font-semibold tracking-tight">{breach ? breach.ruleKind === 'inactivity' ? 'Inactivity limit exceeded' : breach.ruleId.includes('daily') ? 'Daily loss limit exceeded' : 'Maximum loss limit exceeded' : 'All evaluation requirements satisfied'}</h3>
    {breach && <><div className="mt-8 grid gap-6 sm:grid-cols-3"><div><div className="mb-2 text-[10px] uppercase text-ink-faint">Observed {breach.metric}</div><EvidenceValue value={breach.actual} /></div><div><div className="mb-2 text-[10px] uppercase text-ink-faint">Allowed floor / deadline</div><EvidenceValue value={breach.threshold} /></div><div><div className="mb-2 text-[10px] uppercase text-ink-faint">Exceeded by</div><EvidenceValue value={breach.excess} /></div></div><div className="mt-7 flex flex-wrap gap-x-8 gap-y-3 border-t border-line/60 pt-5 text-xs text-ink-muted"><span>{formatReplayMoment(Number(breach.occurredAt))}</span><span>{phaseLabel(String(breach.phaseId))}</span><span>Prior headroom <EvidenceValue value={failure!.priorHeadroom} /></span></div><div className="mt-6 text-xs leading-6 text-ink-muted">{failure!.precedingRisk.length ? failure!.precedingRisk.map(event => <div key={event.decisionId}><span className={tone(event.status)}>{event.status}</span> preceded the breach at {formatReplayMoment(event.occurredAt)} · headroom <EvidenceValue value={event.headroom} /></div>) : 'No preceding warning or danger transition was recorded for the primary rule.'}{failure!.relevantLifecycleId && <a href="#trade-lifecycles-heading" className="focus-ring mt-3 inline-block rounded text-accent">Inspect the relevant trade lifecycle above</a>}</div></>}
    {pass && <><div className="mt-8 grid gap-7 sm:grid-cols-3"><Metric label="Final cash" value={pass.finalCash} /><Metric label="Target achieved" value={pass.targetAmount} /><Metric label="Excess over target" value={pass.excess} signed /></div><div className="mt-7 flex flex-wrap gap-7 border-t border-line/60 pt-5 text-xs text-ink-muted"><span>{pass.activeDays} active days</span><span>{pass.profitableDays} profitable days</span><span>{pass.completedLifecycles} completed lifecycles</span><span>Commissions <MoneyValue value={pass.totalFees} /></span></div><div className="mt-6 space-y-2 text-xs text-ink-muted">{pass.phaseTimeline.map(phase => <div key={phase.phaseId}>{phaseLabel(phase.phaseId)} completed {phase.endedAt === null ? 'Pending' : formatReplayMoment(phase.endedAt)}</div>)}</div></>}
  </Panel></section>;
}
function EvidenceDetails({ report }: { report: ChallengeReportReadModel }) {
  const p = report.provenance;
  const entries: [string, string][] = [['Report policy', p.reportVersion], ['Checkpoint', p.checkpointId], ['Attempt revision', String(p.attemptRevision)], ['Ledger hash', p.ledgerHash], ['Definition hash', p.definitionHash], ['Dataset', p.datasetId], ['Dataset hash', p.datasetHash], ['Branch', p.branchId], ['Generation', String(p.generation)], ['Commit', p.commitKey], ['State witness', p.stateWitnessHash], ...Object.entries(p.versions)];
  if (report.failureAnalysis) entries.unshift(['Breach checkpoint', report.failureAnalysis.checkpoint.checkpointId], ['Breach account revision', String(report.failureAnalysis.checkpoint.accountRevision)]);
  return <details className="border-t border-line/70 pt-6"><summary className="focus-ring cursor-pointer rounded text-xs font-semibold text-ink-muted">Evidence & technical details</summary><p className="mt-4 text-xs leading-6 text-ink-faint">Regenerated from the frozen definition and this branch’s persisted journal. Reports are read-only.</p><dl className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">{entries.map(([label, value], index) => <div key={`${label}:${index}`}><dt className="text-[10px] text-ink-faint">{label}</dt><dd className="mt-1 break-all font-mono text-[10px] leading-5 text-ink-muted">{value}</dd></div>)}</dl></details>;
}
