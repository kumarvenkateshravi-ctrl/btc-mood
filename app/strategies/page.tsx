'use client';

import { useMemo, useState } from 'react';
import {
  Bitcoin, ChevronDown, Bell, Info, Search, SlidersHorizontal, LayoutGrid, List, RefreshCw,
  Star, Crown, ArrowRight, Sparkles, Wrench, FlaskConical, Play, FileText, BookOpen,
} from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { ema } from '@/lib/indicators';
import { computeAtr } from '@/lib/indicators/atr';
import { computeAdx } from '@/lib/indicators/adx';
import { computeSuperTrend } from '@/lib/indicators/superTrend';
import {
  STRATEGIES, CATEGORIES, comparisonRows, OPPORTUNITIES, LESSONS,
  healthLabel, type Strategy, type Category, type CompareRow,
} from '@/lib/strategiesEngine';
import StackSidebar from '@/components/stack/StackSidebar';
import { Panel, Pill, FootLink, Cell, DataTable, textColumn, numColumn, percentColumn, AICard, type AICardData, type Column } from '@/components/ui';
import { formatNumber } from '@/lib/format';

const STRATEGY_COACH: AICardData = {
  title: 'AI Strategy Coach',
  verdict: 'Trend Continuation has the highest probability today',
  confidence: 88,
  direction: 'Bullish',
  evidence: [
    { factor: 'Market in a strong trending phase', weight: 85, direction: 'support' },
    { factor: 'Momentum aligns across 5/6 timeframes', weight: 78, direction: 'support' },
    { factor: 'Volume above average', weight: 72, direction: 'support' },
    { factor: 'Extended above mean, pullback risk', weight: 35, direction: 'oppose' },
  ],
  risk: 'Thesis fails if the trend breaks; avoid ranging markets.',
  historical: 'Trend Continuation: 74% win rate over 642 trades.',
  uncertainty: 'Strongest on 1H-4H; weaker intraday.',
  sources: ['Market regime', 'Multi-TF alignment', 'Volume', 'Stack Score'],
  action: { label: 'Focus: Trend Continuation & Pullback', tone: 'bull' },
};

const STRATEGY_COMPARE_COLS: Column<CompareRow>[] = [
  textColumn({ key: 'name', header: 'Strategy', value: (r) => r.name, className: 'font-medium text-regime-hot' }),
  percentColumn({ key: 'winRate', header: 'Win Rate', value: (r) => r.winRate, plain: true, precision: 1 }),
  numColumn({ key: 'profitFactor', header: 'Profit Factor', value: (r) => r.profitFactor, precision: 2 }),
  numColumn({ key: 'avgRR', header: 'Avg. R:R', value: (r) => r.avgRR, precision: 2 }),
  percentColumn({ key: 'maxDD', header: 'Max DD', value: (r) => r.maxDD, plain: true, precision: 1 }),
  { key: 'difficulty', header: 'Difficulty', align: 'right', cell: (r) => <Cell align="right" className={r.difficulty === 'Easy' ? 'text-bull-bright' : r.difficulty === 'Medium' ? 'text-regime-hot' : 'text-bear-bright'}>{r.difficulty}</Cell> },
];

const TF_LABEL: Record<Timeframe, string> = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtN = (n: number, d = 1) => formatNumber(n, { precision: d });
const sgn = (n: number) => (n >= 0 ? '+' : '');
const tone = (n: number) => (n >= 0 ? 'text-bull-bright' : 'text-bear-bright');
const compactVol = (n: number) => (n >= 1e6 ? `${formatNumber(n / 1e6, { precision: 2 })}M` : n >= 1e3 ? `${formatNumber(n / 1e3, { precision: 2 })}K` : formatNumber(n, { precision: 1 }));
/** Round an SVG path coordinate to 1dp — geometry, not a financial value. */
const r1 = (n: number) => Math.round(n * 10) / 10;
function lastFinite(data: readonly unknown[] | undefined): number | null {
  if (!data) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    if (typeof d === 'number' && Number.isFinite(d)) return d;
    if (d && typeof d === 'object' && 'value' in d) { const v = (d as { value: number }).value; if (Number.isFinite(v)) return v; }
  }
  return null;
}
const DETAIL_TABS = ['Overview', 'Entry Rules', 'Exit Rules', 'Risk Management', 'Performance', 'Market Suitability', 'Examples', 'Backtest', 'Optimization', 'Settings'];
const MY_STRATEGIES = [['Favorite Strategies', '12'], ['My Custom Strategies', '8'], ['Backtested Strategies', '14'], ['Deployed Strategies', '5']];

export default function StrategiesPage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const { candlesByTf, status } = useMarketData(symbol);
  const { prices, changes } = useMoodEngine(candlesByTf, []);
  const price = prices['5m'] ?? prices['1d'] ?? 0;
  const change = changes['1d'] ?? 0;

  const [cat, setCat] = useState<Category | 'All'>('All');
  const [selId, setSelId] = useState('trend-continuation');
  const [tab, setTab] = useState('Overview');
  const [grid, setGrid] = useState(false);
  const sel = STRATEGIES.find((s) => s.id === selId)!;
  const cards = useMemo(() => (cat === 'All' ? STRATEGIES : STRATEGIES.filter((s) => s.categories.includes(cat))), [cat]);

  // Live BTC indicator stack (1H).
  const indicators = useMemo(() => {
    const c = candlesByTf['1h'] ?? [];
    if (c.length < 30) return null;
    const closes = c.map((k) => k.close);
    const last = closes[closes.length - 1];
    const e20 = lastFinite(ema(closes, 20)), e50 = lastFinite(ema(closes, 50)), e200 = lastFinite(ema(closes, 200));
    const st = lastFinite(computeSuperTrend(c).plots[0]?.data);
    const adx = lastFinite(computeAdx(c).plots[0]?.data);
    const atr = lastFinite(computeAtr(c).plots[0]?.data);
    const vols = c.map((k) => k.volume), vol = vols[vols.length - 1];
    const volAvg = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length);
    const bull = (x: number | null) => (x != null && last > x);
    return [
      { label: 'EMA 20', value: e20 != null ? fmtN(e20) : '—', sig: bull(e20) ? 'Bullish' : 'Bearish', good: bull(e20) },
      { label: 'EMA 50', value: e50 != null ? fmtN(e50) : '—', sig: bull(e50) ? 'Bullish' : 'Bearish', good: bull(e50) },
      { label: 'EMA 200', value: e200 != null ? fmtN(e200) : '—', sig: bull(e200) ? 'Bullish' : 'Bearish', good: bull(e200) },
      { label: 'Supertrend (10, 3)', value: st != null ? fmtN(st) : '—', sig: bull(st) ? 'Bullish' : 'Bearish', good: bull(st) },
      { label: 'ADX (14)', value: adx != null ? fmtN(adx) : '—', sig: (adx ?? 0) > 25 ? 'Strong Trend' : 'Weak Trend', good: (adx ?? 0) > 25 },
      { label: 'Volume', value: compactVol(vol), sig: vol > volAvg ? 'Above Avg' : 'Below Avg', good: vol > volAvg },
      { label: 'ATR (14)', value: atr != null ? fmtN(atr) : '—', sig: 'Normal', good: null as boolean | null },
    ];
  }, [candlesByTf]);

  const sidebarExtra = (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">My Strategies</div>
      {MY_STRATEGIES.map(([k, v], i) => (
        <div key={k} className="flex items-center justify-between py-1 text-xs">
          <span className="text-ink-muted">{k}</span>
          <span className="inline-flex items-center gap-1 font-mono font-semibold text-ink">{i === 0 && <Star className="h-3 w-3 fill-regime-hot text-regime-hot" />}{v}</span>
        </div>
      ))}
      <div className="mt-4 overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-b from-accent/15 to-accent/5 p-3 text-center">
        <Crown className="mx-auto h-5 w-5 text-regime-hot" />
        <div className="mt-1 text-xs font-bold text-ink">Unlock Full Power</div>
        <div className="mt-0.5 text-[10px] leading-snug text-ink-faint">Build unlimited strategies, run advanced backtests and get AI optimization.</div>
        <button className="focus-ring mt-2 w-full rounded-lg bg-accent py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90">Go Premium</button>
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
          <div className="ml-4 hidden items-center gap-0.5 rounded-lg border border-line bg-base p-0.5 md:flex">
            {TIMEFRAMES.map((tf) => <span key={tf} className={['rounded-md px-2.5 py-1 text-xs font-medium', tf === '1h' ? 'bg-accent/20 text-accent' : 'text-ink-faint'].join(' ')}>{TF_LABEL[tf]}</span>)}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button className="focus-ring hidden items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink lg:inline-flex"><Wrench className="h-3.5 w-3.5" /> Strategy Builder</button>
            <button className="focus-ring hidden items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink lg:inline-flex"><FlaskConical className="h-3.5 w-3.5" /> Backtester</button>
            <div className="relative"><Bell className="h-4 w-4 text-ink-muted" /><span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bear text-[8px] font-bold text-white">3</span></div>
            <div className="flex items-center gap-2"><div className="h-7 w-7 rounded-full bg-gradient-to-br from-accent to-regime-hot" /><div className="hidden leading-tight sm:block"><div className="text-xs font-semibold">John Doe</div><div className="text-[10px] text-ink-faint">Pro Trader</div></div><ChevronDown className="h-3.5 w-3.5 text-ink-faint" /></div>
          </div>
        </header>

        <div className="flex min-w-0 flex-1 gap-3 overflow-auto p-3">
          {/* MAIN */}
          <div className="min-w-0 flex-1 space-y-3">
            {/* Title row */}
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-ink">Strategies</h1>
              <span className="text-xs text-ink-faint">Professional Trading Playbook™</span>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-line bg-base px-2.5 py-1.5 text-xs text-ink-faint"><Search className="h-3.5 w-3.5" /> Search strategies...</div>
                <button className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"><SlidersHorizontal className="h-3.5 w-3.5" /> Filters</button>
              </div>
            </div>

            {/* Category tabs */}
            <div className="flex items-center gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['All', ...CATEGORIES] as const).map((c) => (
                  <button key={c} onClick={() => setCat(c)} className={['rounded-lg px-2.5 py-1 text-[11px] font-medium transition', cat === c ? 'bg-accent/20 text-accent' : 'border border-line text-ink-faint hover:text-ink'].join(' ')}>{c}</button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-base p-0.5">
                <button onClick={() => setGrid(true)} className={['rounded p-1', grid ? 'bg-accent/20 text-accent' : 'text-ink-faint'].join(' ')}><LayoutGrid className="h-3.5 w-3.5" /></button>
                <button onClick={() => setGrid(false)} className={['rounded p-1', !grid ? 'bg-accent/20 text-accent' : 'text-ink-faint'].join(' ')}><List className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            {/* Strategy cards carousel */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {cards.map((s) => <StrategyCard key={s.id} s={s} active={s.id === selId} onClick={() => setSelId(s.id)} />)}
            </div>

            {/* Detail tabs */}
            <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-line bg-surface-1 p-1 text-[11px]">
              {DETAIL_TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={['shrink-0 rounded-lg px-3 py-1.5 font-medium transition', tab === t ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink'].join(' ')}>{t}</button>)}
            </div>

            {tab !== 'Overview' ? (
              <Panel><div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-ink-faint"><Info className="h-5 w-5" /><span>{tab} for {sel.name} opens in the full strategy workspace.</span></div></Panel>
            ) : (
              <>
                {/* Section title */}
                <div className="flex items-center gap-2"><h2 className="text-base font-bold text-ink">{sel.name}</h2><Star className="h-4 w-4 fill-regime-hot text-regime-hot" /></div>

                {/* DNA + attributes + Quick Stats */}
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.05fr_1.1fr_1.15fr]">
                  <Panel title="Strategy DNA" action={<FootLink>View Full DNA Profile</FootLink>}><RadarDNA dna={sel.dna} /></Panel>

                  <Panel>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                      <Attr k="Strategy Type" v={sel.type} />
                      <Attr k="Best Market" v={sel.bestMarket} tone="bull" />
                      <Attr k="Ideal Timeframes" v={sel.idealTfs} />
                      <Attr k="Avg Hold Time" v={sel.avgHold} />
                      <Attr k="Win Rate (Historic)" v={sel.winRateHist} />
                      <Attr k="Avg. Risk:Reward" v={sel.avgRR} />
                      <Attr k="Max Drawdown" v={sel.maxDD} />
                      <Attr k="Volatility Req." v={sel.volReq} />
                      <Attr k="Volume Requirement" v={sel.volumeReq} />
                      <Attr k="Experience Level" v={sel.experience} />
                      <Attr k="Emotional Demand" v={sel.emotional} />
                      <Attr k="Automation Ready" v={sel.automation} tone="bull" />
                    </div>
                  </Panel>

                  <Panel title="Quick Stats" badge="All Time">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                      <Stat k="Total Trades" v={String(sel.quick.totalTrades)} />
                      <Stat k="Win Rate" v={`${sel.quick.winRate}%`} />
                      <Stat k="Profit Factor" v={`${sel.quick.profitFactor}`} />
                      <Stat k="Average R:R" v={`${sel.quick.avgRR}`} />
                      <Stat k="Net Profit" v={`${sgn(sel.quick.netProfit)}${sel.quick.netProfit}%`} c="text-bull-bright" />
                      <Stat k="Max Drawdown" v={`${sel.quick.maxDrawdown}%`} />
                      <Stat k="Expectancy" v={`${sgn(sel.quick.expectancy)}${sel.quick.expectancy}R`} c="text-bull-bright" />
                      <Stat k="Sharpe Ratio" v={`${sel.quick.sharpe}`} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line/60 pt-3">
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Best Performing Markets</div>
                        <div className="flex items-center gap-2"><MarketsDonut slices={sel.bestMarkets} /><ul className="flex-1 space-y-0.5 text-[10px]">{sel.bestMarkets.map((m) => <li key={m.label} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: m.color }} /><span className="flex-1 text-ink-muted">{m.label}</span><span className="font-mono text-ink-faint">{m.pct}%</span></li>)}</ul></div>
                      </div>
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Best Timeframes</div>
                        <ul className="space-y-1.5">{sel.bestTimeframes.map((t) => <li key={t.label} className="flex items-center gap-2 text-[10px]"><span className="w-6 text-ink-muted">{t.label}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-bull" style={{ width: `${t.pct}%` }} /></div><span className="w-7 text-right font-mono text-ink-faint">{t.pct}%</span></li>)}</ul>
                      </div>
                    </div>
                  </Panel>
                </div>

                {/* Suitability + Indicator stack + Health */}
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  <Panel title="Market Suitability">
                    <ul className="space-y-2">
                      {sel.suitability.map((r) => (
                        <li key={r.label} className="flex items-center gap-2 text-[11px]">
                          <span className="w-28 shrink-0 text-ink-muted">{r.label}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${r.bar}%`, background: r.bar >= 60 ? '#26A69A' : r.bar >= 40 ? '#f0a020' : '#8b93a7' }} /></div>
                          <Stars value={r.stars} />
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-3">
                      <span className="text-xs font-medium text-ink-muted">Current Market Fit</span>
                      <span className="inline-flex items-center gap-2"><FitBadge value={sel.marketFit} /><span className={['text-xs font-semibold', sel.marketFit >= 75 ? 'text-bull-bright' : sel.marketFit >= 50 ? 'text-regime-hot' : 'text-bear-bright'].join(' ')}>{healthLabel(sel.marketFit)}</span></span>
                    </div>
                  </Panel>

                  <Panel title="Indicator Stack" badge="Live Readings">
                    <ul className="space-y-1.5">
                      {(indicators ?? []).map((r) => (
                        <li key={r.label} className="flex items-center justify-between border-b border-line/40 py-1 text-[11px] last:border-0">
                          <span className="inline-flex items-center gap-1.5 text-ink-muted"><span className="h-1.5 w-1.5 rounded-full" style={{ background: r.good == null ? '#8b93a7' : r.good ? '#26A69A' : '#f23645' }} />{r.label}</span>
                          <span className="flex items-center gap-3"><span className="font-mono text-ink">{r.value}</span><span className={['w-20 text-right text-[10px] font-semibold', r.good == null ? 'text-ink-faint' : r.good ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{r.sig}</span></span>
                        </li>
                      ))}
                      {!indicators && <li className="py-6 text-center text-[11px] text-ink-faint">Loading live readings…</li>}
                    </ul>
                  </Panel>

                  <Panel title="Strategy Health Score™" badge="Live">
                    <HealthGauge value={sel.health} />
                    <div className="mt-2 grid grid-cols-4 gap-1.5 text-center text-[9px]">
                      {([['Trend', sel.health7.trend], ['Alignment', sel.health7.alignment], ['Momentum', sel.health7.momentum], ['Volume', sel.health7.volume], ['Stack Score', sel.health7.stackScore], ['Stack', sel.health7.stack], ['Risk', sel.health7.risk]] as const).map(([k, v]) => (
                        <div key={k} className="rounded bg-base/60 py-1"><div className="font-mono text-xs font-bold text-ink">{v}</div><div className="text-ink-faint">{k}</div></div>
                      ))}
                    </div>
                    <div className="mt-2 text-center text-[10px] text-ink-faint">High probability conditions for this strategy right now.</div>
                  </Panel>
                </div>

                {/* Comparison + Recent perf + Builder */}
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  <Panel title="Strategy Comparison" action={<Pill tone="accent">Compare (3)</Pill>}>
                    <DataTable columns={STRATEGY_COMPARE_COLS} rows={comparisonRows()} rowKey={(r) => r.name} />
                  </Panel>

                  <Panel title="Recent Performance" badge="This Month">
                    <div className="mb-1 grid grid-cols-4 gap-2 text-center">
                      <MiniStat k="Trades" v={String(sel.recent.trades)} />
                      <MiniStat k="Win Rate" v={`${sel.recent.winRate}%`} />
                      <MiniStat k="Profit" v={`${sgn(sel.recent.profit)}${sel.recent.profit}%`} c="text-bull-bright" />
                      <MiniStat k="Avg. R:R" v={`${sel.recent.avgRR}R`} />
                    </div>
                    <PerfChart series={sel.recent.series} />
                  </Panel>

                  <Panel title="Strategy Builder™">
                    <p className="text-[11px] text-ink-muted">Create your own strategy using our visual builder.</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">{['No Coding', 'Drag & Drop', 'Backtest Instantly'].map((t) => <span key={t} className="rounded border border-line bg-base px-1.5 py-0.5 text-[10px] text-ink-muted">{t}</span>)}</div>
                    <div className="my-3 grid grid-cols-3 gap-1.5 opacity-80">{['#26A69A', '#6aa6ff', '#f0a020', '#a855f7', '#26A69A', '#6aa6ff'].map((c, i) => <div key={i} className="rounded-md border border-line bg-base/60 p-1.5"><div className="h-1 w-6 rounded-full" style={{ background: c }} /><div className="mt-1 h-1 w-8 rounded-full bg-surface-3" /></div>)}</div>
                    <button className="focus-ring inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-xs font-semibold text-white transition hover:opacity-90">Build Strategy <ArrowRight className="h-3.5 w-3.5" /></button>
                  </Panel>
                </div>
              </>
            )}
          </div>

          {/* RIGHT RAIL */}
          <aside className="hidden w-[300px] shrink-0 space-y-3 xl:block">
            <AICard {...STRATEGY_COACH} onWhy={() => {}} onWhatChanged={() => {}} />

            <Panel title="Live Opportunity Scanner" action={<RefreshCw className="h-3.5 w-3.5 text-ink-faint" />} footer={<FootLink>View All Opportunities</FootLink>}>
              <ul className="space-y-2">
                {OPPORTUNITIES.map((o, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-base/50 p-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[8px] font-bold text-ink-muted">{o.symbol.slice(0, 1)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between"><span className="truncate text-[11px] font-medium text-ink">{o.strategy}</span><span className={['text-[9px] font-semibold', o.grade === 'High' ? 'text-bull-bright' : 'text-regime-hot'].join(' ')}>{o.grade}</span></div>
                      <div className="text-[10px] text-ink-faint">{o.symbol} · {o.tf}</div>
                    </div>
                    <Spark color={o.color} />
                    <span className="w-6 text-right font-mono text-xs font-bold" style={{ color: o.color }}>{o.health}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Learning Center" footer={<FootLink>View All Lessons</FootLink>}>
              <ul className="space-y-2">
                {LESSONS.map((l) => { const Icon = l.kind === 'Video' ? Play : l.kind === 'Article' ? FileText : BookOpen; return (
                  <li key={l.title} className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium text-ink">{l.title}</div><div className="text-[10px] text-ink-faint">{l.kind} · {l.meta}</div></div>
                  </li>
                ); })}
              </ul>
            </Panel>
          </aside>
        </div>

        <footer className="flex items-center gap-4 border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bull" /> {status === 'live' ? 'Live market data' : status}</span>
          <span className="mx-auto hidden italic md:block">The right strategy for the current market beats the perfect strategy for the wrong one.</span>
          <span className="ml-auto inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-accent" /> Strategy Intelligence Center™</span>
        </footer>
      </div>
    </div>
  );
}

// ---- cards / atoms ----
function StrategyCard({ s, active, onClick }: { s: Strategy; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={['group relative overflow-hidden rounded-xl border p-3 text-left transition-colors duration-300', active ? 'border-accent bg-accent/[0.06]' : 'border-line bg-gradient-to-b from-surface-1 to-surface-1/50 hover:border-accent/40'].join(' ')}>
      <div className="flex items-start justify-between gap-2">
        <div><div className="text-sm font-bold leading-tight text-ink">{s.name}</div><div className="text-[10px] text-ink-faint">{s.tagline}</div></div>
        {s.topPick && <span className="shrink-0 rounded bg-bull/15 px-1.5 py-0.5 text-[9px] font-semibold text-bull-bright">Top Pick</span>}
      </div>
      <div className="my-2 flex items-center gap-1.5"><Stars value={s.rating} /><span className="font-mono text-[10px] text-ink-muted">{s.rating} ({s.reviews})</span><Spark color={s.sparkColor} wide /></div>
      <div className="grid grid-cols-2 gap-2 border-t border-line/50 pt-2">
        <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">Win Rate</div><div className="font-mono text-base font-bold text-bull-bright">{s.winRate}%</div></div>
        <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">Profit Factor</div><div className="font-mono text-base font-bold text-ink">{s.profitFactor}</div></div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 border-t border-line/50 pt-2 text-[9px]">
        <div><div className="text-ink-faint">Best Market</div><div className="font-medium text-bull-bright">{s.bestMarket}</div></div>
        <div><div className="text-ink-faint">Difficulty</div><div className={['font-medium', s.difficulty === 'Easy' ? 'text-bull-bright' : s.difficulty === 'Medium' ? 'text-regime-hot' : 'text-bear-bright'].join(' ')}>{s.difficulty}</div></div>
        <div><div className="text-ink-faint">Best TF</div><div className="font-medium text-ink-muted">{s.bestTf}</div></div>
      </div>
    </button>
  );
}
// Panel, Pill, FootLink now imported from @/components/ui (MDS Phase C migration).
function Attr({ k, v, tone: t }: { k: string; v: string; tone?: 'bull' }) { return <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">{k}</div><div className={['text-[11px] font-semibold', t === 'bull' ? 'text-bull-bright' : 'text-ink'].join(' ')}>{v}</div></div>; }
function Stat({ k, v, c }: { k: string; v: string; c?: string }) { return <div className="flex items-center justify-between"><span className="text-ink-faint">{k}</span><span className={['font-mono font-semibold', c ?? 'text-ink'].join(' ')}>{v}</span></div>; }
function MiniStat({ k, v, c }: { k: string; v: string; c?: string }) { return <div className="rounded-lg bg-base/60 py-1.5"><div className="text-[9px] uppercase tracking-wider text-ink-faint">{k}</div><div className={['font-mono text-sm font-bold', c ?? 'text-ink'].join(' ')}>{v}</div></div>; }
function Stars({ value }: { value: number }) {
  return <span className="inline-flex items-center gap-0.5">{[0, 1, 2, 3, 4].map((i) => { const fill = clamp(value - i, 0, 1); return <span key={i} className="relative inline-block h-3 w-3"><Star className="absolute inset-0 h-3 w-3 text-line" /><span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}><Star className="h-3 w-3 fill-regime-hot text-regime-hot" /></span></span>; })}</span>;
}
function Spark({ color, wide }: { color: string; wide?: boolean }) {
  const pts = [8, 10, 9, 12, 11, 14, 13, 16];
  const W = wide ? 48 : 36, H = 16, max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / (pts.length - 1)) * W} ${H - ((p - min) / range) * H}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} className={['ml-auto h-4 shrink-0', wide ? 'w-12' : 'w-9'].join(' ')}><path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function FitBadge({ value }: { value: number }) {
  const v = clamp(value, 0, 100), r = 13, c = 2 * Math.PI * r, col = v >= 75 ? '#26A69A' : v >= 50 ? '#f0a020' : '#f23645';
  return <span className="relative inline-flex h-9 w-9 items-center justify-center"><svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90"><circle cx="18" cy="18" r={r} fill="none" stroke="#2a3247" strokeWidth="3.5" /><circle cx="18" cy="18" r={r} fill="none" stroke={col} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} /></svg><span className="absolute font-mono text-[10px] font-bold" style={{ color: col }}>{v}</span></span>;
}
function RadarDNA({ dna }: { dna: Strategy['dna'] }) {
  const axes = [['Trend Strength', dna.trendStrength], ['Momentum', dna.momentum], ['Risk/Reward', dna.riskReward], ['Ease of Use', dna.easeOfUse], ['Win Rate', dna.winRate], ['Consistency', dna.consistency]] as const;
  const cx = 130, cy = 120, R = 78;
  const pt = (i: number, rad: number) => { const a = (-90 + i * 60) * (Math.PI / 180); return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]; };
  const ring = (frac: number) => axes.map((_, i) => pt(i, R * frac).join(',')).join(' ');
  const poly = axes.map(([, v], i) => pt(i, (v / 10) * R).join(',')).join(' ');
  return (
    <svg viewBox="0 0 260 240" className="w-full">
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke="#2a3247" strokeWidth="0.6" />)}
      {axes.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#2a3247" strokeWidth="0.5" />; })}
      <polygon points={poly} fill="rgba(38,166,154,0.22)" stroke="#26A69A" strokeWidth="1.6" />
      {axes.map(([, v], i) => { const [x, y] = pt(i, (v / 10) * R); return <circle key={i} cx={x} cy={y} r="2" fill="#26A69A" />; })}
      {axes.map(([label, v], i) => { const [x, y] = pt(i, R + 22); return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-ink-faint" style={{ fontSize: 8 }}>{label} <tspan className="fill-ink" style={{ fontWeight: 700 }}>{v}</tspan></text>; })}
    </svg>
  );
}
function MarketsDonut({ slices }: { slices: Strategy['bestMarkets'] }) {
  const r = 20, c = 2 * Math.PI * r;
  const angles = slices.map((s) => (s.pct / 100) * c);
  const offsets = angles.map((_, i) => angles.slice(0, i).reduce((a, b) => a + b, 0));
  return <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90 shrink-0"><circle cx="28" cy="28" r={r} fill="none" stroke="#2a3247" strokeWidth="8" />{slices.map((s, i) => <circle key={s.label} cx="28" cy="28" r={r} fill="none" stroke={s.color} strokeWidth="8" strokeDasharray={`${angles[i]} ${c}`} strokeDashoffset={-offsets[i]} />)}</svg>;
}
function HealthGauge({ value }: { value: number }) {
  const v = clamp(value, 0, 100), angle = -90 + (v / 100) * 180;
  const color = v >= 90 ? '#26A69A' : v >= 75 ? '#9acd32' : v >= 60 ? '#f0a020' : '#f23645';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-36">
        <defs><filter id="shglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke="#2a3247" strokeWidth="13" strokeLinecap="round" />
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${(v / 100) * 267} 400`} style={{ filter: 'url(#shglow)' }} />
        <g transform={`rotate(${angle} 100 105)`}><line x1="100" y1="105" x2="100" y2="42" stroke="#e9eef7" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="105" r="5" fill="#e9eef7" /></g>
      </svg>
      <div className="-mt-5 font-mono text-3xl font-bold" style={{ color }}>{v}</div>
      <div className="text-xs font-semibold" style={{ color }}>{healthLabel(v)}</div>
    </div>
  );
}
function PerfChart({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const W = 320, H = 110, pad = 4;
  const hi = Math.max(...series, 0), lo = Math.min(...series, 0), range = hi - lo || 1;
  const x = (i: number) => pad + (i / (series.length - 1)) * (W - 2 * pad), y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad);
  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${r1(x(i))} ${r1(y(v))}`).join(' ');
  const zero = y(0);
  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col justify-between py-0.5 text-right font-mono text-[8px] text-ink-faint" style={{ height: H }}>{[hi, hi / 2, 0, lo].map((t, i) => <span key={i}>{Math.round(t)}%</span>)}</div>
      <div className="min-w-0 flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[110px] w-full" preserveAspectRatio="none">
          <defs><linearGradient id="perff" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#26A69A" stopOpacity="0.22" /><stop offset="100%" stopColor="#26A69A" stopOpacity="0" /></linearGradient></defs>
          <line x1={pad} y1={zero} x2={W - pad} y2={zero} stroke="#2a3247" strokeWidth="0.5" strokeDasharray="3 3" />
          <path d={`${line} L ${x(series.length - 1)} ${zero} L ${pad} ${zero} Z`} fill="url(#perff)" />
          <path d={line} fill="none" stroke="#26A69A" strokeWidth="1.6" />
        </svg>
        <div className="mt-1 flex justify-between font-mono text-[8px] text-ink-faint"><span>May 20</span><span>May 27</span><span>Jun 3</span><span>Jun 10</span><span>Jun 18</span></div>
      </div>
    </div>
  );
}
