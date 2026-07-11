'use client';

// SMC Screener — render-only checklist UI over lib/smc/screener.ts.
// Narrative first, then status (independent of score), hard gates, context
// layer, missing conditions, trade plan. The panel computes nothing itself;
// the report is cached on a closed-bar signature (indicator tick-perf rule).

import { useRef } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Minus,
  Radar,
  ShieldAlert,
  Star,
  Target,
  XCircle,
} from 'lucide-react';
import type { Candle, Timeframe } from '@/lib/types';
import {
  evaluateSmcScreener,
  type ScreenerGroup,
  type ScreenerItem,
  type ScreenerReport,
  type ScreenerStatus,
} from '@/lib/smc/screener';

const SIG_TFS: Timeframe[] = ['1d', '4h', '1h', '15m'];

const STATUS_STYLE: Record<ScreenerStatus, { label: string; cls: string }> = {
  NO_TRADE: { label: 'NO TRADE', cls: 'bg-bear/15 text-bear-bright border-bear/30' },
  WATCH: { label: 'WATCH', cls: 'bg-surface-3 text-ink-muted border-line' },
  BUILDING: { label: 'BUILDING', cls: 'bg-regime-hot/15 text-regime-hot border-regime-hot/30' },
  READY: { label: 'READY', cls: 'bg-bull/15 text-bull-bright border-bull/30' },
  CONFIRMED: { label: 'CONFIRMED', cls: 'bg-accent/15 text-accent border-accent/30' },
};

function ItemIcon({ status }: { status: ScreenerItem['status'] }) {
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-bull-bright" />;
  if (status === 'fail') return <XCircle className="h-3.5 w-3.5 shrink-0 text-bear-bright" />;
  if (status === 'warn') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-regime-hot" />;
  return <Minus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />;
}

function GroupCard({ group, hard }: { group: ScreenerGroup; hard?: boolean }) {
  return (
    <div className={[
      'rounded-lg border bg-surface-1 p-3',
      hard ? (group.pass ? 'border-bull/25' : 'border-bear/30') : 'border-line',
    ].join(' ')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{group.name}</span>
        {hard ? (
          <span className={[
            'rounded px-1.5 py-0.5 text-[10px] font-bold',
            group.pass ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright',
          ].join(' ')}>
            {group.pass ? 'PASS' : 'FAIL'}
          </span>
        ) : (
          <span className="font-mono text-[10px] tabular-nums text-ink-faint">{group.score}</span>
        )}
      </div>
      <ul className="space-y-1.5">
        {group.items.map((it) => (
          <li key={it.id} className="flex items-start gap-2 text-[12px] leading-tight">
            <ItemIcon status={it.status} />
            <span className={it.status === 'na' ? 'text-ink-faint' : 'text-ink'}>
              {it.label}
              {it.detail && <span className="ml-1.5 font-mono text-[10px] text-ink-faint">{it.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SmcScreenerPanel({
  candlesByTf,
  evalTf,
  symbol,
}: {
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  symbol: string;
}) {
  // Closed-bar cache: in-bar ticks reuse the report.
  const sig = `${evalTf}:${SIG_TFS.map((tf) => {
    const s = candlesByTf[tf];
    return s && s.length ? `${s.length}.${s[s.length - 1].time}` : '0';
  }).join('|')}`;
  const cacheRef = useRef<{ sig: string; report: ScreenerReport } | null>(null);
  if (!cacheRef.current || cacheRef.current.sig !== sig) {
    cacheRef.current = { sig, report: evaluateSmcScreener(candlesByTf, evalTf) };
  }
  const r = cacheRef.current.report;
  const st = STATUS_STYLE[r.status];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-base p-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        {/* Headline: narrative + status + score */}
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <Radar className="h-4 w-4 text-accent" />
              SMC Screener · {symbol} · {evalTf}
            </span>
            {r.direction && (
              <span className={[
                'rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase',
                r.direction === 'long' ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright',
              ].join(' ')}>
                {r.direction}
              </span>
            )}
            <span className={`ml-auto rounded-md border px-2.5 py-1 text-[12px] font-bold ${st.cls}`}>{st.label}</span>
            <span className="rounded-md border border-line bg-base px-2.5 py-1 font-mono text-[12px] tabular-nums text-ink">
              Institutional Score {r.score}<span className="text-ink-faint">/100</span>
            </span>
          </div>
          <ul className="space-y-1">
            {r.narrative.map((line, i) => (
              <li key={i} className="text-[13px] leading-snug text-ink-muted">{line}</li>
            ))}
          </ul>
          {/* Current Phase — the actionable headline. If the trader reads one
              line, it's this one, not the status. */}
          <div className="mt-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Current Phase</p>
            <p className="mt-0.5 text-[15px] font-semibold text-ink">{r.currentPhase}</p>
            <p className="mt-1 text-[12px] text-ink-muted">
              Next expected event: <span className="text-ink">{r.nextExpectedEvent}</span>
            </p>
          </div>
          {r.blockingReason && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-[13px] text-bear-bright">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {r.blockingReason}
            </div>
          )}
        </div>

        {/* Institutional Workflow — one journey instead of extra percentages */}
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Institutional Workflow
          </p>
          <ol className="grid grid-cols-4 gap-x-3 gap-y-3 xl:grid-cols-8">
            {r.workflow.map((s) => (
              <li key={s.id} className="flex flex-col items-start gap-1">
                <span
                  className={[
                    'inline-flex h-6 w-6 items-center justify-center rounded-full border',
                    s.state === 'done'
                      ? 'border-bull/40 bg-bull/15 text-bull-bright'
                      : s.state === 'active'
                        ? 'border-regime-hot/50 bg-regime-hot/15 text-regime-hot'
                        : 'border-line bg-surface-2 text-ink-faint',
                  ].join(' ')}
                >
                  {s.state === 'done' ? <Check className="h-3.5 w-3.5" /> : s.state === 'active' ? <Clock className="h-3.5 w-3.5" /> : <Circle className="h-2 w-2" />}
                </span>
                <span className={`text-[11px] leading-tight ${s.state === 'pending' ? 'text-ink-faint' : 'text-ink'}`}>
                  {s.label}
                </span>
                <span className="font-mono text-[9px] text-ink-faint">
                  {s.state === 'done' ? (s.barsAgo != null ? `${s.barsAgo} bars ago` : 'in place') : s.state === 'active' ? 'pending…' : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Hard gates */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Hard gates — all must pass
          </p>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {r.hardGates.map((g) => <GroupCard key={g.id} group={g} hard />)}
          </div>
        </div>

        {/* Context layer */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Context layer — confidence, not eligibility
          </p>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            {r.contextChecks.map((g) => <GroupCard key={g.id} group={g} />)}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Missing conditions (list only — the workflow IS the progress) + invalidation */}
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-line bg-surface-1 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Missing conditions</span>
              {r.missing.length === 0 ? (
                <p className="mt-2 text-[13px] text-bull-bright">All tracked conditions are met.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {r.missing.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-ink-muted">
                      <Circle className="mt-1 h-2.5 w-2.5 shrink-0 text-ink-faint" />
                      {m}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {r.invalidation.length > 0 && (
              <div className="rounded-xl border border-line bg-surface-1 p-4">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  <ShieldAlert className="h-3.5 w-3.5 text-bear-bright" />
                  Invalidation — what would make this idea wrong
                </span>
                <ul className="mt-2 space-y-1.5">
                  {r.invalidation.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-ink-muted">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bear-bright/70" />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Trade plan */}
          <div className="rounded-xl border border-line bg-surface-1 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Target className="h-4 w-4 text-accent" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Trade plan</span>
              {r.tradePlan && (
                <span className="ml-auto inline-flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={`h-3.5 w-3.5 ${s <= r.tradePlan!.quality ? 'fill-regime-hot text-regime-hot' : 'text-ink-faint'}`}
                    />
                  ))}
                </span>
              )}
            </div>
            {r.tradePlan ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[13px] tabular-nums">
                <div><dt className="text-[10px] uppercase text-ink-faint">Entry</dt><dd className="text-ink">{r.tradePlan.entry.toFixed(1)}</dd></div>
                <div><dt className="text-[10px] uppercase text-ink-faint">Stop</dt><dd className="text-bear-bright">{r.tradePlan.stop.toFixed(1)}</dd></div>
                <div>
                  <dt className="text-[10px] uppercase text-ink-faint">Target</dt>
                  <dd className="text-bull-bright">
                    {r.tradePlan.target.toFixed(1)}
                    <span className="ml-1.5 font-sans text-[10px] text-ink-faint">{r.tradePlan.targetLabel}</span>
                  </dd>
                </div>
                <div><dt className="text-[10px] uppercase text-ink-faint">Risk / Reward</dt><dd className="text-ink">{r.tradePlan.rr.toFixed(1)}R</dd></div>
              </dl>
            ) : (
              <p className="text-[13px] text-ink-faint">
                Unlocks when all hard gates pass — the screener never plans a trade the market hasn’t earned.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
