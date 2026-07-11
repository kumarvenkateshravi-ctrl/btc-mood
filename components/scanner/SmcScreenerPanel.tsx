'use client';

// SMC Screener — render-only UI over lib/smc/screener.ts.
//
// Three tabs:
//  - Live Screener: the gate-based evaluation (narrative, phase, workflow,
//    gates, context, missing, invalidation, trade plan).
//  - Institutional Long/Short Workflow: permanent reference checklists that
//    TEACH the process (SMCProcess.md) — same engine, direction forced, so
//    every condition ticks live against the current market.
//
// The panel computes nothing itself; reports are cached per closed-bar
// signature + tab (indicator tick-perf rule).

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpenText,
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
  type ScreenerItemStatus,
  type ScreenerReport,
  type ScreenerStatus,
} from '@/lib/smc/screener';

const SIG_TFS: Timeframe[] = ['1d', '4h', '1h', '15m'];

type TabId = 'live' | 'long' | 'short';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'live', label: 'Live Screener' },
  { id: 'long', label: 'Institutional Long Workflow' },
  { id: 'short', label: 'Institutional Short Workflow' },
];

const STATUS_STYLE: Record<ScreenerStatus, { label: string; cls: string }> = {
  NO_TRADE: { label: 'NO TRADE', cls: 'bg-bear/15 text-bear-bright border-bear/30' },
  WATCH: { label: 'WATCH', cls: 'bg-surface-3 text-ink-muted border-line' },
  BUILDING: { label: 'BUILDING', cls: 'bg-regime-hot/15 text-regime-hot border-regime-hot/30' },
  READY: { label: 'READY', cls: 'bg-bull/15 text-bull-bright border-bull/30' },
  CONFIRMED: { label: 'CONFIRMED', cls: 'bg-accent/15 text-accent border-accent/30' },
};

function ItemIcon({ status }: { status: ScreenerItemStatus }) {
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

// ------------------------------------------------------------ live screener

function LiveScreenerView({ r, symbol, evalTf }: { r: ScreenerReport; symbol: string; evalTf: Timeframe }) {
  const st = STATUS_STYLE[r.status];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      {/* Headline: narrative + status + score + phase */}
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
  );
}

// ------------------------------------------------- reference workflow tabs

interface ChecklistRow { label: string; status: ScreenerItemStatus }
interface ChecklistSection { title: string; rows: ChecklistRow[] }

/** Map the live report onto the SMCProcess.md reference checklist rows. */
function buildChecklist(r: ScreenerReport, dir: 'long' | 'short'): ChecklistSection[] {
  const items = new Map<string, ScreenerItem>();
  for (const g of [...r.hardGates, ...r.contextChecks]) for (const it of g.items) items.set(it.id, it);
  const stage = (id: string) => r.workflow.find((s) => s.id === id);
  const it = (id: string, label?: string): ChecklistRow => {
    const found = items.get(id);
    return { label: label ?? found?.label ?? id, status: found?.status ?? 'na' };
  };
  const stageRow = (id: string, label: string): ChecklistRow => ({
    label,
    status: stage(id)?.state === 'done' ? 'pass' : 'fail',
  });
  const long = dir === 'long';
  const D = long ? 'Bullish' : 'Bearish';
  const side = long ? 'Sell-side' : 'Buy-side';

  return [
    { title: 'Trend', rows: [
      it('trend_1d', `Daily Trend ${D}`),
      it('trend_4h', `4H Trend ${D}`),
      it('trend_1h', `1H Trend ${D}`),
      it('trend_15m', 'EMA Alignment (15m EMA20 vs EMA50)'),
    ]},
    { title: 'Momentum', rows: [
      it('rsi', long ? 'RSI > 55' : 'RSI < 45'),
      it('macd', `MACD ${D}`),
      it('adx', 'ADX > 25'),
    ]},
    { title: 'Volatility', rows: [
      it('atr_rising', 'ATR Rising'),
      it('bb_expanding', 'Bollinger Width Expanding'),
    ]},
    { title: 'Market Structure', rows: [
      stageRow('liquidity_building', `${side} Liquidity Built`),
      it('sweep', `${side} Liquidity Swept`),
      it('choch', `${D} CHoCH`),
      it('bos', `${D} BOS`),
      it('swing_trend', long ? 'HH / HL Structure' : 'LH / LL Structure'),
    ]},
    { title: 'Order Block', rows: [
      it('ob_fresh', `Fresh ${D} Order Block`),
      it('ob_strength', 'Strength ≥ 80'),
      it('ob_active', 'Not Mitigated'),
    ]},
    { title: 'Fair Value Gap', rows: [
      it('fvg_unfilled', `${D} FVG`),
      it('fvg_overlap', `FVG overlaps ${D} OB`),
    ]},
    { title: 'Premium / Discount', rows: [
      it('zone', long ? 'Price in Discount Zone' : 'Price in Premium Zone'),
    ]},
    { title: 'Volume', rows: [
      it('vol_above', 'Volume > SMA20'),
      it('pressure', long ? 'Buying Pressure Increasing' : 'Selling Pressure Increasing'),
    ]},
    { title: 'Trade Entry', rows: [
      stageRow('retest', `Price retests ${D} OB`),
      { label: 'Risk Reward > 3', status: r.tradePlan ? (r.tradePlan.rr >= 3 ? 'pass' : 'fail') : 'fail' },
      { label: 'Entry Confirmed', status: r.status === 'CONFIRMED' ? 'pass' : 'fail' },
    ]},
  ];
}

function WorkflowChecklistView({ r, dir }: { r: ScreenerReport; dir: 'long' | 'short' }) {
  const sections = buildChecklist(r, dir);
  const rows = sections.flatMap((s) => s.rows).filter((row) => row.status !== 'na');
  const passed = rows.filter((row) => row.status === 'pass').length;
  const D = dir === 'long' ? 'Long' : 'Short';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface-1 p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <BookOpenText className="h-4 w-4 text-accent" />
          Institutional {D} Workflow
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          This is the process institutions follow to build a {dir} position — in this exact order.
          The trend gives permission, liquidity provides the fuel, the {dir === 'long' ? 'sell-side' : 'buy-side'} sweep
          collects stops, CHoCH signals the shift, BOS confirms it, and only then does the Order Block
          become an entry zone worth waiting for. The Live Screener automates this checklist — every
          box below ticks in real time against the current market, so you can learn the process by
          watching it unfold.
        </p>
      </div>

      {sections.map((s) => (
        <div key={s.title} className="rounded-xl border border-line bg-surface-1 p-4">
          <p className="mb-2 border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {s.title}
          </p>
          <ul className="space-y-2">
            {s.rows.map((row) => (
              <li key={row.label} className="flex items-center gap-2.5 text-[13px]">
                <span className={[
                  'inline-flex h-[18px] w-[18px] items-center justify-center rounded border',
                  row.status === 'pass'
                    ? 'border-bull/50 bg-bull/15 text-bull-bright'
                    : row.status === 'warn'
                      ? 'border-regime-hot/50 bg-regime-hot/10 text-regime-hot'
                      : 'border-line bg-base text-transparent',
                ].join(' ')}>
                  {row.status === 'pass' ? <Check className="h-3 w-3" /> : row.status === 'warn' ? <AlertTriangle className="h-2.5 w-2.5" /> : null}
                </span>
                <span className={row.status === 'pass' ? 'text-ink' : 'text-ink-muted'}>{row.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="rounded-xl border border-line bg-surface-1 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Status</span>
          <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">
            ✓ {passed} / {rows.length} Conditions Passed
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- panel

export default function SmcScreenerPanel({
  candlesByTf,
  evalTf,
  symbol,
}: {
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  symbol: string;
}) {
  const [tab, setTab] = useState<TabId>('live');

  // Closed-bar cache per tab: in-bar ticks reuse the reports.
  const sig = `${evalTf}:${SIG_TFS.map((tf) => {
    const s = candlesByTf[tf];
    return s && s.length ? `${s.length}.${s[s.length - 1].time}` : '0';
  }).join('|')}`;
  const cacheRef = useRef<{ sig: string; reports: Partial<Record<TabId, ScreenerReport>> }>({ sig: '', reports: {} });
  if (cacheRef.current.sig !== sig) cacheRef.current = { sig, reports: {} };
  if (!cacheRef.current.reports[tab]) {
    cacheRef.current.reports[tab] = evaluateSmcScreener(
      candlesByTf,
      evalTf,
      tab === 'live' ? undefined : { forceDirection: tab },
    );
  }
  const r = cacheRef.current.reports[tab]!;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-base p-4">
      <div className="mx-auto mb-4 flex max-w-5xl items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'focus-ring -mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === t.id
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'live' ? (
        <LiveScreenerView r={r} symbol={symbol} evalTf={evalTf} />
      ) : (
        <WorkflowChecklistView r={r} dir={tab} />
      )}
    </div>
  );
}
