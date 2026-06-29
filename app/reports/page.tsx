'use client';

import { useState } from 'react';
import {
  Bitcoin, ChevronDown, Bell, RefreshCw, GitCompare, Download, Sparkles,
  Check, Shield, Star, TrendingUp, MoreHorizontal, FileText, FileSpreadsheet, Plus,
} from 'lucide-react';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import {
  KPIS, PERF, PORTFOLIO, STRATEGY_ROWS, STACK_SCORE_ROWS, MTF_ROWS, REGIME_ROWS, TIMEFRAME_ROWS,
  RISK, EMOTIONS, DISCIPLINE, MISTAKES, AI_COACH, MISSED, GOALS, CALENDAR, EXPORTS,
  EXEC_SUMMARY, SAVED_REPORTS, ACCOUNT_OVERVIEW, TABS, type Kpi, type StrategyRow, type BandRow, type MtfRow, type RegimeRow, type TfRow, type MistakeRow, type MissedRow, type AssetRow,
} from '@/lib/reportsEngine';

// DataTable column sets (DataTable -> Column Presets -> Financial Cells -> Num).
// A colored band/alignment dot is the one custom cell; everything else is a preset.
const bandDot = (label: string, tone: 'bull' | 'warn' | 'bear') => (
  <Cell align="left"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: toneCls(tone) }} />{label}</span></Cell>
);

const STRATEGY_COLS: Column<StrategyRow>[] = [
  textColumn({ key: 'name', header: 'Strategy', value: (r) => r.name, className: 'font-medium text-regime-hot' }),
  numColumn({ key: 'trades', header: 'Trades', value: (r) => r.trades }),
  percentColumn({ key: 'winRate', header: 'Win Rate', value: (r) => r.winRate, plain: true, precision: 1 }),
  pnlColumn({ key: 'profit', header: 'Profit', value: (r) => r.profit }),
  numColumn({ key: 'avgRR', header: 'Avg. R', value: (r) => r.avgRR, precision: 2 }),
  numColumn({ key: 'pf', header: 'PF', value: (r) => r.pf, precision: 2 }),
  percentColumn({ key: 'maxDD', header: 'Max DD', value: (r) => r.maxDD, precision: 2 }),
];
const STACK_COLS: Column<BandRow>[] = [
  { key: 'band', header: 'Stack Score', align: 'left', cell: (r) => bandDot(r.band, r.tone) },
  numColumn({ key: 'trades', header: 'Trades', value: (r) => r.trades }),
  percentColumn({ key: 'winRate', header: 'Win Rate', value: (r) => r.winRate, plain: true, precision: 1 }),
  pnlColumn({ key: 'profit', header: 'Profit', value: (r) => r.profit }),
  numColumn({ key: 'avgRR', header: 'Avg. R', value: (r) => r.avgRR, precision: 2 }),
  numColumn({ key: 'pf', header: 'PF', value: (r) => r.pf, precision: 2 }),
];
const MTF_COLS: Column<MtfRow>[] = [
  { key: 'alignment', header: 'Alignment', align: 'left', cell: (r) => bandDot(r.alignment, r.tone) },
  numColumn({ key: 'trades', header: 'Trades', value: (r) => r.trades }),
  percentColumn({ key: 'winRate', header: 'Win Rate', value: (r) => r.winRate, plain: true, precision: 1 }),
  pnlColumn({ key: 'profit', header: 'Profit', value: (r) => r.profit }),
  textColumn({ key: 'hold', header: 'Avg. Hold', value: (r) => r.hold }),
  numColumn({ key: 'pf', header: 'PF', value: (r) => r.pf, precision: 2 }),
];
const REGIME_COLS: Column<RegimeRow>[] = [
  textColumn({ key: 'regime', header: 'Market Regime', value: (r) => r.regime, className: 'text-ink-muted' }),
  percentColumn({ key: 'occurrence', header: 'Occurrence', value: (r) => r.occurrence, plain: true, precision: 0 }),
  percentColumn({ key: 'winRate', header: 'Win Rate', value: (r) => r.winRate, plain: true, precision: 1 }),
  pnlColumn({ key: 'profit', header: 'Profit', value: (r) => r.profit }),
  numColumn({ key: 'pf', header: 'PF', value: (r) => r.pf, precision: 2 }),
];
const TIMEFRAME_COLS: Column<TfRow>[] = [
  textColumn({ key: 'tf', header: 'Timeframe', value: (r) => r.tf, className: 'font-medium' }),
  pnlColumn({ key: 'profit', header: 'Profit', value: (r) => r.profit }),
  percentColumn({ key: 'winRate', header: 'Win Rate', value: (r) => r.winRate, plain: true, precision: 1 }),
  textColumn({ key: 'hold', header: 'Avg. Hold', value: (r) => r.hold, align: 'right', className: 'text-ink-faint' }),
];
const MISTAKE_COLS: Column<MistakeRow>[] = [
  textColumn({ key: 'mistake', header: 'Mistake', value: (r) => r.mistake, className: 'text-ink-muted' }),
  numColumn({ key: 'frequency', header: 'Frequency', value: (r) => r.frequency }),
  pnlColumn({ key: 'cost', header: 'Cost', value: (r) => r.cost }),
  { key: 'trend', header: 'Trend', align: 'right', cell: () => <Cell align="right"><TrendingUp className="ml-auto h-3 w-3 text-bull-bright" /></Cell> },
];
const PORTFOLIO_COLS: Column<AssetRow>[] = [
  { key: 'asset', header: 'Asset', align: 'left', cell: (r) => <Cell align="left"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.asset}</span></Cell> },
  percentColumn({ key: 'allocation', header: 'Allocation', value: (r) => r.allocation, plain: true, precision: 1 }),
  pnlColumn({ key: 'profit', header: 'Profit', value: (r) => r.profit }),
  percentColumn({ key: 'contribution', header: 'Contribution', value: (r) => r.contribution, plain: true, precision: 1 }),
];
const MISSED_COLS: Column<MissedRow>[] = [
  textColumn({ key: 'opportunity', header: 'Opportunity', value: (r) => r.opportunity, className: 'text-regime-hot' }),
  textColumn({ key: 'symbol', header: 'Symbol', value: (r) => r.symbol, className: 'font-medium' }),
  textColumn({ key: 'setup', header: 'Setup', value: (r) => r.setup, className: 'text-ink-faint' }),
  textColumn({ key: 'missedOn', header: 'Missed On', value: (r) => r.missedOn, align: 'right', className: 'text-bull-bright' }),
  textColumn({ key: 'potential', header: 'Potential', value: (r) => r.profit, align: 'right', className: 'text-bull-bright' }),
];
import StackSidebar from '@/components/stack/StackSidebar';
import { Panel, FootLink, KpiCard, Num, DataTable, Cell, type Column, numColumn, percentColumn, pnlColumn, textColumn, AICard, type AICardData, type AIEvidence } from '@/components/ui';
import { formatNumber } from '@/lib/format';

const TRADING_COACH: AICardData = {
  title: 'AI Trading Coach',
  verdict: 'June: A grade, refine your exits',
  confidence: 82,
  evidence: AI_COACH.map((c): AIEvidence => ({
    factor: c.text,
    weight: c.tone === 'bull' ? 80 : c.tone === 'warn' ? 50 : 55,
    direction: c.tone === 'warn' ? 'oppose' : 'support',
  })),
  risk: 'Performance dips after consecutive losses.',
  historical: 'Overall grade A; top 18% of MyCryptoStack traders.',
  uncertainty: 'Edge concentrated in trending regimes.',
  sources: ['Journal', 'Trades', 'Discipline', 'Backtests'],
  timestamp: 'Jun 2025',
  action: { label: 'View Full AI Analysis', tone: 'accent' },
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtN = (n: number, d = 1) => formatNumber(n, { precision: d });
const sgn = (n: number) => (n >= 0 ? '+' : '');
/** Round an SVG path coordinate to 1dp — geometry, not a financial value. */
const r1 = (n: number) => Math.round(n * 10) / 10;
const tone = (n: number) => (n >= 0 ? 'text-bull-bright' : 'text-bear-bright');
const toneCls = (t: 'bull' | 'warn' | 'bear') => (t === 'bull' ? '#26A69A' : t === 'warn' ? '#f0a020' : '#f23645');

export default function ReportsPage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const { candlesByTf, status } = useMarketData(symbol);
  const { prices, changes } = useMoodEngine(candlesByTf, []);
  const price = prices['5m'] ?? prices['1d'] ?? 0;
  const change = changes['1d'] ?? 0;
  const [tab, setTab] = useState('Executive');
  const [perfTab, setPerfTab] = useState('Equity Curve');

  const sidebarExtra = (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Account Overview</div>
      {ACCOUNT_OVERVIEW.map((r) => <SRow key={r.k} k={r.k} v={r.v} c={r.pos ? 'text-bull-bright' : undefined} />)}
      <div className="mt-4 overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-b from-accent/10 to-accent/[0.02] p-3 text-center">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">AI Performance Grade</div>
        <GradeRing grade="A" />
        <Stars value={5} />
        <div className="mt-1 text-xs font-semibold text-bull-bright">Excellent Performance</div>
        <div className="mt-0.5 text-[10px] leading-snug text-ink-faint">You are in the top 18% of all MyCryptoStack traders.</div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-[100dvh] w-full bg-base text-ink">
      <StackSidebar extra={sidebarExtra} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2">
          <button className="flex items-center gap-1.5 rounded-lg border border-line bg-base px-2.5 py-1.5 text-sm"><Bitcoin className="h-4 w-4 text-regime-hot" /><span className="font-semibold">{symbol}</span><ChevronDown className="h-3.5 w-3.5 text-ink-faint" /></button>
          <span className="font-mono text-lg font-semibold tabular-nums">{fmtN(price)}</span>
          <span className={['font-mono text-sm tabular-nums', tone(change)].join(' ')}>{sgn(change)}{fmtN((price * change) / 100, 2)} ({sgn(change)}{fmtN(change, 2)}%)</span>
          <div className="ml-auto flex items-center gap-2">
            <button className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line bg-base px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink">Jun 1 – Jun 30, 2025 <RefreshCw className="h-3.5 w-3.5" /></button>
            <button className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"><GitCompare className="h-3.5 w-3.5" /> Compare</button>
            <button className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"><Download className="h-3.5 w-3.5" /> Export</button>
            <div className="relative"><Bell className="h-4 w-4 text-ink-muted" /><span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bear text-[8px] font-bold text-white">3</span></div>
            <div className="flex items-center gap-2"><div className="h-7 w-7 rounded-full bg-gradient-to-br from-accent to-regime-hot" /><div className="hidden leading-tight sm:block"><div className="text-xs font-semibold">John Doe</div><div className="text-[10px] text-ink-faint">Pro Trader</div></div></div>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-auto p-3">
          {/* Title + tabs + AI exec */}
          <div className="flex flex-wrap items-start gap-3">
            <div>
              <div className="flex items-center gap-2"><h1 className="text-xl font-bold tracking-tight text-ink">Reports</h1><span className="text-xs text-ink-faint">Trading Intelligence &amp; Performance Analytics</span><span className="rounded border border-regime-hot/40 bg-regime-hot/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-regime-hot" title="Representative monthly review. Live aggregation arrives once trade history is persisted.">Representative</span></div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={['rounded-lg px-2.5 py-1 text-[11px] font-medium transition', tab === t ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink'].join(' ')}>{t}</button>)}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3 rounded-xl border border-accent/30 bg-gradient-to-r from-accent/10 to-transparent px-3 py-2">
              <Sparkles className="h-4 w-4 text-accent" /><span className="text-xs font-semibold text-ink">AI Executive Summary</span>
              <button className="focus-ring rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90">Generate</button>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {KPIS.map((k) => (
              <KpiCard
                key={k.key}
                label={k.label}
                value={k.text ?? <KpiValue k={k} />}
                valueTone={k.key === 'dd' ? 'bear' : k.key === 'risk' ? 'bull' : 'neutral'}
                sub={k.sub}
                delta={k.delta}
                deltaPercent={k.deltaPercent}
                ring={k.kind === 'ring' ? k.ringValue : undefined}
                spark={k.kind === 'spark' ? (k.down ? SPARK_DOWN : SPARK_UP) : undefined}
                sparkColor={k.down ? 'var(--bear-bright)' : 'var(--bull-bright)'}
                accessory={k.kind === 'shield' ? <span className="relative flex h-9 w-9 items-center justify-center"><Shield className="h-9 w-9 text-bull/20" /><Check className="absolute h-3.5 w-3.5 text-bull-bright" /></span> : undefined}
              />
            ))}
          </div>

          {/* Row: Performance | Portfolio | Strategy */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <Panel n={1} title="Performance Overview" info>
              <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-base p-0.5 text-[10px]">
                {['Equity Curve', 'Cumulative Return', 'Rolling Return', 'Monthly Return'].map((t) => <button key={t} onClick={() => setPerfTab(t)} className={['rounded px-2 py-1 font-medium transition', perfTab === t ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink'].join(' ')}>{t}</button>)}
              </div>
              <div className="mb-1 flex flex-wrap gap-3 text-[10px]">
                <Legend c="#6aa6ff" l="My Equity" /><Legend c="#a855f7" l="Buy & Hold (BTC)" /><Legend c="#8b93a7" l="Benchmark (Total Crypto)" />
              </div>
              <PerfChart />
              <div className="mt-2 grid grid-cols-5 gap-1.5 border-t border-line/60 pt-2">
                {PERF.bottom.map((b) => <div key={b.k} className="text-center"><div className="text-[8px] uppercase tracking-wider text-ink-faint">{b.k}</div><div className={['font-mono text-[11px] font-semibold', b.pos ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{b.v}</div></div>)}
              </div>
            </Panel>

            <Panel n={2} title="Portfolio Performance" info>
              <div className="flex items-center gap-3">
                <PortfolioDonut />
                <DataTable className="flex-1" columns={PORTFOLIO_COLS} rows={PORTFOLIO.rows} rowKey={(r) => r.asset} />
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5 border-t border-line/60 pt-2">{PORTFOLIO.bottom.map((b) => <div key={b.k} className="text-center"><div className="text-[8px] uppercase tracking-wider text-ink-faint">{b.k}</div><div className="font-mono text-[11px] font-semibold text-ink">{b.v}</div></div>)}</div>
            </Panel>

            <Panel n={3} title="Strategy Performance" info footer={<FootLink>View Full Strategy Report</FootLink>}>
              <DataTable columns={STRATEGY_COLS} rows={STRATEGY_ROWS} rowKey={(r) => r.name} initialSort={{ key: 'profit', dir: 'desc' }} />
            </Panel>
          </div>

          {/* Row: Stack Score | MTF | Regime | Timeframe */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <Panel n={4} title="Stack Score Analysis" info footer={<FootLink>View Full Stack Score Report</FootLink>}>
              <DataTable columns={STACK_COLS} rows={STACK_SCORE_ROWS} rowKey={(r) => r.band} />
            </Panel>
            <Panel n={5} title="Multi-Timeframe Alignment" info footer={<FootLink>View Full Alignment Report</FootLink>}>
              <DataTable columns={MTF_COLS} rows={MTF_ROWS} rowKey={(r) => r.alignment} />
            </Panel>
            <Panel n={6} title="Market Regime Performance" info footer={<FootLink>View Full Market Regime Report</FootLink>}>
              <DataTable columns={REGIME_COLS} rows={REGIME_ROWS} rowKey={(r) => r.regime} />
            </Panel>
            <Panel n={7} title="Timeframe Performance" info footer={<FootLink>View Full Timeframe Report</FootLink>}>
              <DataTable columns={TIMEFRAME_COLS} rows={TIMEFRAME_ROWS} rowKey={(r) => r.tf} />
            </Panel>
          </div>

          {/* Row: Risk | Emotion | Discipline | Mistakes | AI Coach */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <Panel n={8} title="Risk Analytics" info footer={<FootLink>View Full Risk Report</FootLink>}>
              <div className="flex items-center gap-3">
                <ul className="flex-1 space-y-1 text-[11px]">{RISK.metrics.map((m) => <li key={m.k} className="flex items-center justify-between"><span className="text-ink-faint">{m.k}</span><span className="font-mono font-semibold text-ink">{m.v}</span></li>)}</ul>
                <div className="shrink-0 text-center"><Gauge value={RISK.score} color="#26A69A" /><div className="text-[10px] text-bull-bright">{RISK.label}</div></div>
              </div>
            </Panel>

            <Panel n={9} title="Emotional Intelligence" info footer={<FootLink>View Full Emotional Report</FootLink>}>
              <div className="text-[9px] text-ink-faint">Win Rate by Emotion (Before Trade)</div>
              <EmotionBars />
            </Panel>

            <Panel n={10} title="Discipline Report" footer={<FootLink>View Full Discipline Report</FootLink>}>
              <div className="flex items-center gap-3">
                <div className="shrink-0 text-center"><Gauge value={DISCIPLINE.score} color="#26A69A" big /><div className="text-[10px] font-semibold text-bull-bright">{DISCIPLINE.label}</div></div>
                <ul className="flex-1 space-y-1 text-[10px]">{DISCIPLINE.checks.map((c) => <li key={c.k} className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5 text-ink-muted"><Check className="h-3 w-3 text-bull-bright" />{c.k}</span><span className="font-mono text-ink-faint">{c.v}%</span></li>)}</ul>
              </div>
            </Panel>

            <Panel n={11} title="Mistake Analysis" footer={<FootLink>View Full Mistake Report</FootLink>}>
              <DataTable columns={MISTAKE_COLS} rows={MISTAKES} rowKey={(m) => m.mistake} />
            </Panel>

            <AICard {...TRADING_COACH} onWhy={() => {}} onWhatChanged={() => {}} />
          </div>

          {/* Row: Missed | Goals | Calendar */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <Panel n={13} title="Opportunity Missed" footer={<FootLink>View All Missed Opportunities</FootLink>}>
              <DataTable columns={MISSED_COLS} rows={MISSED} rowKey={(m) => m.symbol} />
            </Panel>

            <Panel n={14} title="Goal Achievement" badge="June" footer={<FootLink>View All Goals</FootLink>}>
              <ul className="space-y-2.5">
                {GOALS.map((g) => (
                  <li key={g.label}>
                    <div className="flex items-center justify-between text-[10px]"><span className="text-ink-muted">{g.label}</span><span className="font-mono text-ink-faint">{g.current} / {g.target}</span></div>
                    <div className="mt-1 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${Math.min(100, g.progress)}%`, background: g.progress >= 100 ? '#26A69A' : '#f0a020' }} /></div><span className={['w-9 text-right font-mono text-[10px] font-semibold', g.progress >= 100 ? 'text-bull-bright' : 'text-ink'].join(' ')}>{g.progress}%</span></div>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel n={15} title="Trading Calendar" badge="June" footer={<FootLink>View Full Calendar</FootLink>}>
              <Calendar />
            </Panel>
          </div>

          {/* Row: Export | Executive Summary | Report Builder */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <Panel n={16} title="Export Center" footer={<FootLink>View All Exports</FootLink>}>
              <ul className="space-y-1.5">
                {EXPORTS.map((e) => { const Icon = e.format === 'Excel' ? FileSpreadsheet : FileText; return (
                  <li key={e.name} className="flex items-center gap-2 rounded-lg bg-base/50 px-2 py-1.5 text-[11px]">
                    <Icon className={['h-3.5 w-3.5', e.format === 'PDF' ? 'text-bear-bright' : e.format === 'Excel' ? 'text-bull-bright' : 'text-accent'].join(' ')} />
                    <span className="flex-1 text-ink-muted">{e.name}</span><span className="text-[9px] text-ink-faint">({e.format})</span>
                    <button className="focus-ring inline-flex items-center gap-1 text-[10px] font-medium text-accent transition hover:opacity-80"><Download className="h-3 w-3" /> Download</button>
                  </li>
                ); })}
              </ul>
            </Panel>

            <Panel n={17} title="Executive Summary" footer={<FootLink>View Full Executive Summary</FootLink>}>
              <div className="text-xs font-semibold text-ink">{EXEC_SUMMARY.title}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{EXEC_SUMMARY.body}</p>
              <div className="mt-2 grid grid-cols-4 gap-1.5">{EXEC_SUMMARY.stats.map((s) => <div key={s.k} className="rounded bg-base/60 py-1 text-center"><div className="text-[8px] uppercase tracking-wider text-ink-faint">{s.k}</div><div className={['font-mono text-[11px] font-bold', s.pos ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{s.v}</div></div>)}</div>
              <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2 text-[10px]">
                <div><span className="text-ink-faint">Best Strategy</span><div className="font-semibold text-ink">{EXEC_SUMMARY.bestStrategy}</div></div>
                <div className="text-center"><span className="text-ink-faint">Discipline</span><div className="font-semibold text-bull-bright">{EXEC_SUMMARY.discipline}</div></div>
                <div className="text-center"><span className="text-ink-faint">Overall Grade</span><div className="font-mono text-base font-bold text-bull-bright">{EXEC_SUMMARY.grade}</div></div>
              </div>
            </Panel>

            <Panel n={18} title="Report Builder" footer={<FootLink>Manage All Reports</FootLink>}>
              <p className="text-[11px] text-ink-muted">Create custom reports with the metrics that matter most to you.</p>
              <button className="focus-ring mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-accent/50 bg-accent/[0.06] py-2 text-[11px] font-semibold text-accent transition hover:bg-accent/10"><Plus className="h-3.5 w-3.5" /> Create New Report</button>
              <div className="mt-2 text-[9px] uppercase tracking-wider text-ink-faint">Saved Reports</div>
              <ul className="mt-1 space-y-1">{SAVED_REPORTS.map((r) => <li key={r} className="flex items-center justify-between rounded bg-base/50 px-2 py-1 text-[11px] text-ink-muted"><span>{r}</span><MoreHorizontal className="h-3.5 w-3.5 text-ink-faint" /></li>)}</ul>
            </Panel>
          </div>
        </div>

        <footer className="flex items-center gap-4 border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bull" /> {status === 'live' ? 'Live market data' : status}</span>
          <span className="mx-auto hidden italic md:block">Reports do not just show what happened, they explain why and what to improve next.</span>
          <span className="ml-auto inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-accent" /> Trading Intelligence Center™</span>
        </footer>
      </div>
    </div>
  );
}

// ---- widgets / atoms ----
// Widget replaced by the shared @/components/ui Panel (n prop); FootLink shared too.
function SRow({ k, v, c }: { k: string; v: string; c?: string }) { return <div className="flex items-center justify-between py-0.5 text-xs"><span className="text-ink-faint">{k}</span><span className={['font-mono font-semibold tabular-nums', c ?? 'text-ink'].join(' ')}>{v}</span></div>; }
function Legend({ c, l }: { c: string; l: string }) { return <span className="inline-flex items-center gap-1.5 text-ink-faint"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>; }
function Stars({ value }: { value: number }) { return <div className="mt-1 inline-flex items-center gap-0.5">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className={['h-3 w-3', i < value ? 'fill-regime-hot text-regime-hot' : 'text-line'].join(' ')} />)}</div>; }

// KPI cards now use the shared @/components/ui KpiCard driven by Num.* (MDS Pass-2).
const SPARK_UP = [9, 11, 10, 13, 12, 15, 14, 17, 16, 20];
const SPARK_DOWN = [18, 16, 17, 14, 15, 12, 13, 11, 12, 8];
function KpiValue({ k }: { k: Kpi }) {
  if (k.variant === 'money') return <Num.Money value={k.value} />;
  if (k.variant === 'pct') return <Num.Pct value={k.value} signed={false} />;
  if (k.variant === 'score') return <Num.Score value={k.value} />;
  return <Num value={k.value} />;
}
// (local MiniSpark removed — KPI sparks now use the shared Sparkline via KpiCard)
function Gauge({ value, color, small, big }: { value: number; color: string; small?: boolean; big?: boolean }) {
  const v = clamp(value, 0, 100), r = 13, c = 2 * Math.PI * r, sz = small ? 'h-9 w-9' : big ? 'h-16 w-16' : 'h-12 w-12';
  return <span className={['relative inline-flex items-center justify-center', sz].join(' ')}><svg viewBox="0 0 36 36" className="-rotate-90"><circle cx="18" cy="18" r={r} fill="none" stroke="#2a3247" strokeWidth="3.5" /><circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} style={{ filter: `drop-shadow(0 0 2px ${color}80)` }} /></svg><span className={['absolute font-mono font-bold', big ? 'text-lg' : small ? 'text-[9px]' : 'text-xs'].join(' ')} style={{ color }}>{v}</span></span>;
}
function GradeRing({ grade }: { grade: string }) {
  return <span className="relative mx-auto flex h-16 w-16 items-center justify-center"><svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90"><circle cx="32" cy="32" r="28" fill="none" stroke="#2a3247" strokeWidth="4" /><circle cx="32" cy="32" r="28" fill="none" stroke="#a855f7" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${0.92 * 176} 176`} /></svg><span className="absolute font-mono text-2xl font-bold text-ink">{grade}</span></span>;
}
function EmotionBars() {
  return (
    <div className="mt-1 flex items-end justify-between gap-1.5" style={{ height: 110 }}>
      {EMOTIONS.map((e) => (
        <div key={e.label} className="flex flex-1 flex-col items-center justify-end">
          <span className="mb-1 font-mono text-[9px] font-semibold text-ink">{e.winRate}%</span>
          <div className="w-full rounded-t" style={{ height: `${e.winRate}%`, background: `linear-gradient(180deg, ${e.color}, ${e.color}99)` }} />
          <span className="mt-1 text-[8px] text-ink-faint">{e.label}</span>
        </div>
      ))}
    </div>
  );
}
function PortfolioDonut() {
  const r = 26, c = 2 * Math.PI * r;
  const angles = PORTFOLIO.rows.map((s) => (s.allocation / 100) * c);
  const offsets = angles.map((_, i) => angles.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90"><circle cx="40" cy="40" r={r} fill="none" stroke="#2a3247" strokeWidth="10" />{PORTFOLIO.rows.map((s, i) => <circle key={s.asset} cx="40" cy="40" r={r} fill="none" stroke={s.color} strokeWidth="10" strokeDasharray={`${angles[i]} ${c}`} strokeDashoffset={-offsets[i]} />)}</svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[8px] text-ink-faint">Total</span><span className="font-mono text-[10px] font-bold text-ink">${fmtN(PORTFOLIO.total, 2)}</span></div>
    </div>
  );
}
function PerfChart() {
  const W = 360, H = 150, pad = 4;
  const all = [...PERF.equity, ...PERF.benchmark, ...PERF.buyhold, -2000];
  const hi = Math.max(...all), lo = Math.min(...all, 0), range = hi - lo || 1;
  const x = (i: number) => pad + (i / (PERF.equity.length - 1)) * (W - 2 * pad), y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad);
  const path = (s: number[]) => s.map((v, i) => `${i === 0 ? 'M' : 'L'} ${r1(x(i))} ${r1(y(v))}`).join(' ');
  const yTicks = [30000, 20000, 10000, 0, -10000];
  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col justify-between py-0.5 text-right font-mono text-[8px] text-ink-faint" style={{ height: H }}>{yTicks.map((t) => <span key={t}>{t < 0 ? '-' : ''}${Math.abs(t) / 1000}K</span>)}</div>
      <div className="min-w-0 flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" preserveAspectRatio="none">
          {yTicks.map((t) => <line key={t} x1={pad} y1={y(t)} x2={W - pad} y2={y(t)} stroke="#2a3247" strokeWidth="0.4" strokeDasharray="2 3" />)}
          <path d={path(PERF.benchmark)} fill="none" stroke="#8b93a7" strokeWidth="1.2" />
          <path d={path(PERF.buyhold)} fill="none" stroke="#a855f7" strokeWidth="1.2" />
          <path d={path(PERF.equity)} fill="none" stroke="#6aa6ff" strokeWidth="1.7" />
        </svg>
        <div className="mt-1 flex justify-between font-mono text-[8px] text-ink-faint">{['Jun 1', 'Jun 6', 'Jun 11', 'Jun 16', 'Jun 21', 'Jun 26', 'Jun 30'].map((d) => <span key={d}>{d}</span>)}</div>
      </div>
    </div>
  );
}
function Calendar() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const col = (b: number) => (b === 2 ? '#1f6f5c' : b === 1 ? '#26A69A' : b === -1 ? '#c9851f' : b === -2 ? '#f23645' : '#2a3247');
  return (
    <div>
      <div className="grid grid-cols-[auto_repeat(7,1fr)] gap-1 text-center text-[8px] text-ink-faint">
        <span />{days.map((d) => <span key={d} className="py-0.5">{d}</span>)}
        {CALENDAR.map((week, wi) => (
          <Row key={wi} wi={wi} week={week} col={col} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[8px] text-ink-faint">
        <Lg c="#1f6f5c" l="> +1%" /><Lg c="#26A69A" l="0% to +1%" /><Lg c="#c9851f" l="-1% to 0%" /><Lg c="#f23645" l="< -1%" /><Lg c="#2a3247" l="No Trades" />
      </div>
    </div>
  );
}
function Row({ wi, week, col }: { wi: number; week: number[]; col: (b: number) => string }) {
  return (
    <>
      <span className="flex items-center py-0.5 pr-1 text-left text-ink-faint">Week {wi + 1}</span>
      {week.map((b, di) => <span key={di} className="aspect-square rounded" style={{ background: col(b) }} />)}
    </>
  );
}
function Lg({ c, l }: { c: string; l: string }) { return <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: c }} />{l}</span>; }
