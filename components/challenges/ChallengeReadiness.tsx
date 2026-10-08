import { Num, Panel } from '@/components/ui';
import type { ChallengeReadinessReadModel, ChallengeReadinessScopeResult, ReadinessComponent } from '@/lib/challenges/readiness';

const phaseLabel = (phaseId: string | null) => phaseId ? phaseId.replace('phase-', 'Phase ') : 'Overall';
const scoreTone = (score: number | null) => score === null ? 'text-ink-muted' : score >= 80 ? 'text-bull-bright' : score >= 60 ? 'text-regime-hot' : 'text-bear-bright';
const barTone = (score: number | null) => score === null ? 'bg-ink-faint/30' : score >= 80 ? 'bg-bull-bright' : score >= 60 ? 'bg-regime-hot' : 'bg-bear-bright';

function ComponentRow({ component }: { component: ReadinessComponent }) {
  const score = component.score;
  return <div className="grid gap-3 border-b border-line/50 py-4 last:border-0 sm:grid-cols-[180px_1fr_52px] sm:items-center sm:gap-6">
    <div><div className="text-xs font-medium text-ink">{component.label}</div><div className="mt-1 text-[10px] text-ink-faint">{component.weight}% weight · {component.weightedContribution === null ? 'withheld' : `${component.weightedContribution.toFixed(2)} pts`}</div></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true"><div className={`h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none ${barTone(score)}`} style={{ width: `${score ?? 0}%` }} /></div>
    <div className={`text-left sm:text-right ${scoreTone(score)}`}>{score === null ? <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">Pending</span> : <><Num.Score value={score} className="text-lg" /><span className="text-[10px] text-ink-faint"> / 100</span></>}</div>
  </div>;
}

function ScopePill({ result }: { result: ChallengeReadinessScopeResult }) {
  return <div className="min-w-[148px] border-l border-line/60 pl-4 first:border-0 first:pl-0">
    <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{phaseLabel(result.phaseId)}</div>
    <div className={`mt-2 flex items-baseline gap-1.5 ${scoreTone(result.score)}`}>{result.score === null ? <span className="text-xs font-semibold">Pending evidence</span> : <><Num.Score value={result.score} className="text-xl" /><span className="text-[10px] text-ink-faint">/ 100</span></>}</div>
    <div className="mt-1 text-[10px] text-ink-muted">{result.eligibility.status.replace('_', ' ')} · {result.evidenceCounts.completedLifecycles} trades · {result.evidenceCounts.finalizedActiveDays} days</div>
  </div>;
}

export function ChallengeReadinessSection({ readiness }: { readiness: ChallengeReadinessReadModel }) {
  const eligible = readiness.score !== null;
  return <section aria-labelledby="readiness-heading">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Performance quality</div><h2 id="readiness-heading" className="mt-2 text-xl font-semibold tracking-tight">Readiness</h2></div><div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${eligible ? scoreTone(readiness.score) : 'text-ink-muted'}`}>{readiness.finality} · {readiness.status.replace('_', ' ')}</div></div>
    <Panel className="overflow-hidden p-0">
      <div className="grid lg:grid-cols-[0.72fr_1.28fr]">
        <div className="border-b border-line/60 p-7 sm:p-9 lg:border-b-0 lg:border-r">
          {eligible ? <>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">{readiness.finality === 'FINAL' ? 'Final readiness' : 'Provisional readiness'}</div>
            <div className={`mt-5 flex items-end gap-3 ${scoreTone(readiness.score)}`}><Num.Score value={readiness.score!} className="text-5xl font-semibold tracking-[-0.05em] sm:text-6xl" /><span className="pb-1 text-sm text-ink-faint">/ 100</span></div>
            <div className={`mt-3 text-xs font-semibold uppercase tracking-[0.16em] ${scoreTone(readiness.score)}`}>{readiness.grade?.replace('_', ' ')}</div>
            <div className="mt-7 grid grid-cols-2 gap-5 border-t border-line/60 pt-5"><div><div className="text-[9px] uppercase tracking-[0.12em] text-ink-faint">Completed trades</div><div className="num mt-2 text-lg font-semibold">{readiness.evidenceCounts.completedLifecycles}</div></div><div><div className="text-[9px] uppercase tracking-[0.12em] text-ink-faint">Finalized active days</div><div className="num mt-2 text-lg font-semibold">{readiness.evidenceCounts.finalizedActiveDays}</div></div></div>
          </> : <>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">Readiness withheld</div><h3 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">More completed evidence is required.</h3><p className="mt-3 text-sm leading-6 text-ink-muted">The score appears after the deterministic minimum is met. No neutral score is substituted.</p>
            <div className="mt-7 space-y-3 border-t border-line/60 pt-5">{readiness.eligibility.gaps.map(gap => <div key={gap.code} className="text-xs text-ink-muted">{gap.label}</div>)}</div>
          </>}
        </div>
        <div className="p-7 sm:p-9"><div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">Component evidence</div><div className="mt-3">{readiness.components.map(item => <ComponentRow key={item.key} component={item} />)}</div></div>
      </div>
      {eligible && (readiness.strengths.length > 0 || readiness.weaknesses.length > 0) && <div className="grid border-t border-line/60 md:grid-cols-2">
        <div className="p-7 sm:px-9"><div className="text-[9px] font-semibold uppercase tracking-[0.15em] text-bull-bright">Strengths</div><div className="mt-4 space-y-3">{readiness.strengths.length ? readiness.strengths.map(item => <div key={item.code} className="text-xs leading-5 text-ink-muted">{item.label}</div>) : <div className="text-xs text-ink-faint">No component reached the strength threshold.</div>}</div></div>
        <div className="border-t border-line/60 p-7 sm:px-9 md:border-l md:border-t-0"><div className="text-[9px] font-semibold uppercase tracking-[0.15em] text-regime-hot">Watch</div><div className="mt-4 space-y-3">{readiness.weaknesses.length ? readiness.weaknesses.map(item => <div key={item.code} className="text-xs leading-5 text-ink-muted">{item.label}</div>) : <div className="text-xs text-ink-faint">No component weakness crossed the v1 threshold.</div>}</div></div>
      </div>}
      {readiness.phaseResults.length > 1 && <div className="flex gap-8 overflow-x-auto border-t border-line/60 px-7 py-5 sm:px-9">{readiness.phaseResults.map(result => <ScopePill key={result.phaseId} result={result} />)}</div>}
      <p className="border-t border-line/60 px-7 py-5 text-[10px] leading-5 text-ink-faint sm:px-9">Readiness Score measures performance quality and rule discipline within simulated Challenge evidence. It does not predict or guarantee results in a real evaluation.</p>
    </Panel>
  </section>;
}
