'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bitcoin, ChevronDown, Bell, Info, Plus, Filter, Calendar as CalIcon, Maximize2,
  ChevronLeft, ChevronRight, Sparkles, Play, ArrowRight, Check, AlertTriangle,
  Flame, Eye, Move, Clock, Zap, type LucideIcon,
} from 'lucide-react';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { usePaperStore } from '@/lib/paperStore';
import {
  generateSampleEntries, mapPaperTrades, analyzeJournal,
  type JournalEntry, type JournalAnalysis, type Setup,
} from '@/lib/journalEngine';
import StackSidebar from '@/components/stack/StackSidebar';

const TF_LABEL: Record<Timeframe, string> = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtN = (n: number, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (n: number) => (n >= 0 ? '+' : '');
const usd = (n: number) => `${sgn(n)}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}K` : `${Math.round(n)}`);
const dDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const hold = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.round((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const tone = (n: number) => (n >= 0 ? 'text-bull-bright' : 'text-bear-bright');

const MISTAKE_ICON: Record<string, LucideIcon> = { 'Exited Early': Zap, 'Ignored Volume': Eye, 'Moved Stop Loss': Move, 'Entered Late': Clock, 'FOMO Trading': Flame };
const EMO_COLOR: Record<string, string> = { Calm: '#26A69A', Confident: '#6aa6ff', Excited: '#f0a020', Fearful: '#f23645', FOMO: '#a855f7' };
const SETUP_COLOR: Record<Setup, string> = { 'Trend Continuation': '#26A69A', Breakout: '#6aa6ff', Pullback: '#f0a020', Reversal: '#f23645', Scalping: '#a855f7', Swing: '#2dd4bf' };

export default function JournalPage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const { candlesByTf, status } = useMarketData(symbol);
  const { prices, changes } = useMoodEngine(candlesByTf, []);
  const paper = usePaperStore();
  const price = prices['5m'] ?? prices['1d'] ?? 0;
  const change = changes['1d'] ?? 0;
  const [clock, setClock] = useState('--:--:--');
  useEffect(() => { const t = () => setClock(new Date().toLocaleTimeString('en-GB')); t(); const id = setInterval(t, 1000); return () => clearInterval(id); }, []);

  // Fixed sample anchor (Jun 18, 2025) keeps SSR/client render identical and matches the mockup.
  const SAMPLE_NOW = Date.UTC(2025, 5, 18, 16, 0, 0);
  const real = useMemo(() => mapPaperTrades(paper.trades, symbol), [paper.trades, symbol]);
  const usingSample = real.length < 10;
  const entries = useMemo<JournalEntry[]>(() => (usingSample ? generateSampleEntries(268, 42, SAMPLE_NOW) : real), [usingSample, real, SAMPLE_NOW]);
  const a = useMemo(() => analyzeJournal(entries), [entries]);
  const p = a.performance;
  const recent = useMemo(() => [...entries].sort((x, y) => y.date - x.date).slice(0, 6), [entries]);
  const replayCandles = (candlesByTf['1h'] ?? []).slice(-44);

  const sidebarExtra = (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Journal Overview</div>
      <SRow k="Total Trades" v={String(p.total)} />
      <SRow k="Winning Trades" v={`${p.winning} (${p.winRate}%)`} c="text-bull-bright" />
      <SRow k="Losing Trades" v={`${p.losing} (${((p.losing / Math.max(1, p.total)) * 100).toFixed(1)}%)`} c="text-bear-bright" />
      <SRow k="Breakeven Trades" v={`${p.breakeven} (${((p.breakeven / Math.max(1, p.total)) * 100).toFixed(1)}%)`} />
      <div className="my-1.5 h-px bg-line" />
      <SRow k="Total P&L" v={`${usd(p.netProfit)} USDT`} c="text-bull-bright" />
      <SRow k="Average Win" v={`+${p.avgWin}R`} c="text-bull-bright" />
      <SRow k="Average Loss" v={`${p.avgLoss}R`} c="text-bear-bright" />

      <div className="mb-1 mt-4 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Discipline Score <Info className="h-3 w-3" /></div>
      <DisciplineGauge value={p.total ? a.discipline.score : 0} rating={a.discipline.rating} />
      <div className="mt-2 space-y-1 border-t border-line pt-2">
        <SRow k="This Month" v={`${sgn(a.discipline.delta)}${a.discipline.delta}`} c={tone(a.discipline.delta)} />
        <SRow k="vs Last Month" v={`${a.discipline.lastMonth}`} />
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
            <span className={['inline-flex items-center gap-1.5 text-xs', status === 'live' ? 'text-bull-bright' : 'text-regime-hot'].join(' ')}><span className={['h-2 w-2 rounded-full', status === 'live' ? 'bg-bull' : 'bg-regime-hot'].join(' ')} />{status === 'live' ? 'Live' : status}</span>
            <div className="relative"><Bell className="h-4 w-4 text-ink-muted" /><span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bear text-[8px] font-bold text-white">3</span></div>
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-accent to-regime-hot" />
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-auto p-3">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-ink">Trading Journal</h1>
            <span className="text-xs text-ink-faint">Track. Review. Improve. Repeat.</span>
            {usingSample && <span className="rounded border border-regime-hot/40 bg-regime-hot/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-regime-hot" title="Your real trades populate this as you close paper trades in MyStack.">Sample data</span>}
            <div className="ml-auto flex items-center gap-2">
              <button className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Add Trade</button>
              <button className="focus-ring inline-flex items-center justify-center rounded-lg border border-line p-2 text-ink-muted transition hover:bg-surface-2 hover:text-ink"><Maximize2 className="h-3.5 w-3.5" /></button>
              <button className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"><CalIcon className="h-3.5 w-3.5" /> May 20 – Jun 18, 2025 <ChevronDown className="h-3 w-3" /></button>
              <button className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"><Filter className="h-3.5 w-3.5" /> Filters</button>
            </div>
          </div>

          {/* Performance cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <PerfCard k="Total Trades" v={String(p.total)} delta={`${sgn(a.deltas.trades)}${a.deltas.trades} vs last month`} dPos={a.deltas.trades >= 0} chart="up" color="#6aa6ff" />
            <PerfCard k="Win Rate" v={`${p.winRate}%`} delta={`${sgn(a.deltas.winRate)}${a.deltas.winRate}% vs last month`} dPos={a.deltas.winRate >= 0} ring={p.winRate} />
            <PerfCard k="Net Profit" v={usd(p.netProfit)} unit="USDT" delta={`${sgn(a.deltas.netProfit)}${a.deltas.netProfit}% vs last month`} dPos={a.deltas.netProfit >= 0} chart="up" color="#26A69A" valTone="bull" />
            <PerfCard k="Profit Factor" v={`${p.profitFactor}`} delta={`${sgn(a.deltas.profitFactor)}${a.deltas.profitFactor} vs last month`} dPos={a.deltas.profitFactor >= 0} chart="up" color="#26A69A" />
            <PerfCard k="Expectancy" v={`+${p.expectancy}R`} delta={`${sgn(a.deltas.expectancy)}${a.deltas.expectancy}R vs last month`} dPos={a.deltas.expectancy >= 0} chart="up" color="#a855f7" valTone="bull" />
            <PerfCard k="Avg. R:R" v={`${p.avgRR}R`} delta={`${sgn(a.deltas.avgRR)}${a.deltas.avgRR}R vs last month`} dPos={a.deltas.avgRR >= 0} chart="up" color="#6aa6ff" />
            <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/50 p-3 transition-colors duration-300 hover:border-accent/30">
              <div className="absolute -right-3 -top-3 h-12 w-12 rounded-full bg-bull/10 blur-xl" />
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">Best Setup</div>
              <div className="mt-1.5 text-[15px] font-bold leading-tight text-ink">{p.bestSetup.setup}</div>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-bull/10 px-1.5 py-0.5 text-xs font-semibold text-bull-bright">{p.bestSetup.winRate}% Win Rate</div>
            </div>
          </div>

          {/* Recent trades | Equity | Calendar */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1.3fr_1fr]">
            <Panel title="Recent Trades" action={<><Pill>View All Trades <ChevronDown className="h-3 w-3" /></Pill><span className="px-1 text-ink-faint">···</span></>}>
              <table className="w-full text-left text-[11px]">
                <thead className="text-[9px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1 font-medium">Date</th><th className="py-1 font-medium">Asset</th><th className="py-1 font-medium">Direction</th><th className="py-1 font-medium">Setup</th><th className="py-1 font-medium">Entry / Exit</th><th className="py-1 text-right font-medium">R:R</th><th className="py-1 text-right font-medium">P&amp;L</th><th className="py-1 text-right font-medium">Outcome</th></tr></thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id} className="border-t border-line/50 hover:bg-surface-2/30">
                      <td className="py-1.5 whitespace-nowrap text-ink-faint">{dDate(e.date)}</td>
                      <td className="py-1.5 font-medium">{e.asset}</td>
                      <td className="py-1.5"><span className={['font-medium', e.direction === 'Long' ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{e.direction}</span></td>
                      <td className="py-1.5"><SetupBadge setup={e.setup} /></td>
                      <td className="py-1.5 whitespace-nowrap font-mono text-ink-muted">{Math.round(e.entry).toLocaleString()} / {Math.round(e.exit).toLocaleString()}</td>
                      <td className="py-1.5 text-right font-mono">{e.rr}R</td>
                      <td className={['py-1.5 text-right font-mono', tone(e.pnl)].join(' ')}>{usd(e.pnl)}</td>
                      <td className="py-1.5 text-right"><span className={['rounded px-1.5 py-0.5 text-[10px] font-semibold', e.outcome === 'Win' ? 'bg-bull/15 text-bull-bright' : e.outcome === 'Loss' ? 'bg-bear/15 text-bear-bright' : 'bg-surface-3 text-ink-faint'].join(' ')}>{e.outcome}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title="Equity Curve" info action={<Pill>Compare <ChevronDown className="h-3 w-3" /></Pill>}>
              <div className="mb-2 flex flex-wrap gap-4 text-[11px]">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bull" /> My Equity <span className="font-mono font-semibold text-ink">{a.equity.length ? fmtN(a.equity[a.equity.length - 1].equity, 2) : 0} USDT</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: '#6aa6ff' }} /> Buy &amp; Hold (BTC) <span className="font-mono font-semibold text-ink">{a.equity.length ? fmtN(a.equity[a.equity.length - 1].benchmark, 2) : 0} USDT</span></span>
              </div>
              <EquityChart points={a.equity} />
            </Panel>

            <Panel title="Trading Calendar"><CalendarView analysis={a} /></Panel>
          </div>

          {/* Breakdown | Mistakes | Emotions | AI Coach */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <Breakdown a={a} />

            <Panel title="Mistake Tracker" info action={<Pill>Most Common <ChevronDown className="h-3 w-3" /></Pill>} footer={<FootLink>View All Mistakes</FootLink>}>
              <ul className="space-y-3">
                {a.mistakes.slice(0, 5).map((m, i) => {
                  const Icon = MISTAKE_ICON[m.mistake] ?? Flame;
                  const max = a.mistakes[0]?.count || 1;
                  return (
                    <li key={m.mistake} className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bear/10"><Icon className={['h-3.5 w-3.5', i === 0 ? 'text-bear-bright' : 'text-regime-hot'].join(' ')} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-[11px]"><span className="text-ink-muted">{m.mistake}</span><span className="font-mono text-ink-faint">{m.count} times</span></div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${(m.count / max) * 100}%`, background: i === 0 ? '#f23645' : '#f0a020' }} /></div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel title="Emotional Journal" info action={<Pill>This Month <ChevronDown className="h-3 w-3" /></Pill>} footer={<FootLink>View Emotion Analytics</FootLink>}><EmotionDonut a={a} /></Panel>

            <Panel title="AI Coach" badge="Beta" footer={<FootLink>View Full Report</FootLink>}>
              <ul className="space-y-2.5 text-[11px]">
                {a.insights.map((t, i) => <li key={i} className="flex items-start gap-2 text-ink-muted"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /><span>{t}</span></li>)}
              </ul>
            </Panel>
          </div>

          {/* Replay | Setup&TF perf | Discipline | Goals */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-[1.7fr_1.2fr_1.1fr_1fr]">
            <Panel title="Trade Replay™" info footer={<FootLink>View All Replays</FootLink>}>
              {recent[0] && (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]"><span className="font-semibold">{recent[0].asset}</span><span className={recent[0].direction === 'Long' ? 'text-bull-bright' : 'text-bear-bright'}>{recent[0].direction}</span><span className="text-ink-faint">{dDate(recent[0].date)}</span><SetupBadge setup={recent[0].setup} /></div>
                  <div className="mb-2 grid grid-cols-4 gap-2">
                    <KV k="Entry" v={Math.round(recent[0].entry).toLocaleString()} />
                    <KV k="Exit" v={Math.round(recent[0].exit).toLocaleString()} />
                    <KV k="R:R" v={`${recent[0].rr}R`} />
                    <KV k="P&L" v={usd(recent[0].pnl)} c={tone(recent[0].pnl)} />
                  </div>
                  <ReplayChart candles={replayCandles} entry={recent[0].entry} exit={recent[0].exit} dir={recent[0].direction} />
                  <div className="mt-2 flex items-center gap-2">
                    <button className="focus-ring flex h-8 w-8 items-center justify-center rounded-full bg-regime-hot text-white"><Play className="h-4 w-4 fill-white" /></button>
                    {['0.5x', '1x', '2x', '4x'].map((s) => <span key={s} className={['rounded px-2 py-1 text-[10px] font-medium', s === '1x' ? 'bg-accent/20 text-accent' : 'border border-line text-ink-faint'].join(' ')}>{s}</span>)}
                  </div>
                </>
              )}
            </Panel>

            <Panel title="Setup & Timeframe Performance" action={<Pill>This Month <ChevronDown className="h-3 w-3" /></Pill>} footer={<FootLink>View Full Analysis</FootLink>}>
              <table className="w-full text-left text-[11px]">
                <thead className="text-[9px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1 font-medium">Timeframe</th><th className="py-1 text-right font-medium">Trades</th><th className="py-1 text-right font-medium">Win Rate</th><th className="py-1 text-right font-medium">Net Profit</th><th className="py-1 text-right font-medium">Avg. Hold</th></tr></thead>
                <tbody>{a.byTimeframe.map((b) => <tr key={b.label} className="border-t border-line/50"><td className="py-1.5 font-medium">{b.label}</td><td className="py-1.5 text-right">{b.trades}</td><td className="py-1.5 text-right">{b.winRate}%</td><td className={['py-1.5 text-right font-mono', tone(b.netProfit)].join(' ')}>{usd(b.netProfit)}</td><td className="py-1.5 text-right text-ink-faint">{hold(b.avgHoldMin)}</td></tr>)}</tbody>
              </table>
            </Panel>

            <Panel title="Discipline Breakdown" action={<Pill>This Month <ChevronDown className="h-3 w-3" /></Pill>} footer={<FootLink>View Discipline Analytics</FootLink>}>
              <ul className="space-y-2 text-xs">
                {a.discipline.checks.map((c) => (
                  <li key={c.label} className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-ink-muted">{c.warn ? <AlertTriangle className="h-3.5 w-3.5 text-regime-hot" /> : <Check className="h-3.5 w-3.5 text-bull-bright" />}{c.label}</span>
                    <span className="font-mono text-ink-faint">{c.passed} / {c.total}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Goals Progress" action={<Pill>This Month <ChevronDown className="h-3 w-3" /></Pill>} footer={<FootLink>View Goal Settings</FootLink>}>
              <ul className="space-y-2.5">
                {a.goals.map((g) => (
                  <li key={g.label}>
                    <div className="flex items-center justify-between text-[11px]"><span className="text-ink-muted">{g.label}</span></div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="w-24 shrink-0 font-mono text-[10px] text-ink-faint">{g.current} / {g.target}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${Math.min(100, g.progress)}%`, background: g.progress >= 100 ? 'linear-gradient(90deg,#1d8a7f,#26A69A)' : 'linear-gradient(90deg,#d98a1a,#f0a020)' }} /></div>
                      <span className={['w-9 text-right font-mono text-[11px] font-semibold', g.progress >= 100 ? 'text-bull-bright' : 'text-ink'].join(' ')}>{g.progress}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center gap-4 border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-[9px] font-bold text-accent">N</span><span className="font-semibold text-ink-muted">MY STACK</span><span className="font-mono text-ink">28</span><span className="text-regime-hot">Caution</span></span>
          <span className="mx-auto hidden italic md:block">“The goal is not to be right all the time, but to be consistent over time.” — MyCryptoStack</span>
          <span className="ml-auto inline-flex items-center gap-3"><span>Data Source: Binance</span><span className="inline-flex items-center gap-1.5"><span className={['h-2 w-2 rounded-full', status === 'live' ? 'bg-bull' : 'bg-regime-hot'].join(' ')} />{status === 'live' ? 'Connected' : status}</span><span>Last Update: {clock}</span></span>
        </footer>
      </div>
    </div>
  );
}

// ---- shared bits ----
function Panel({ title, info, badge, action, footer, children }: { title?: string; info?: boolean; badge?: string; action?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-3 transition-colors duration-300 hover:border-line/80">
      {title && (
        <div className="mb-2.5 flex items-center gap-2">
          <h3 className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink">{title}{info && <Info className="h-3 w-3 text-ink-faint" />}</h3>
          {badge && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">{badge}</span>}
          {action && <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-faint">{action}</span>}
        </div>
      )}
      <div className="flex-1">{children}</div>
      {footer && <div className="mt-3 border-t border-line/60 pt-2 text-center">{footer}</div>}
    </section>
  );
}
function Pill({ children }: { children: React.ReactNode }) { return <span className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-[10px] text-ink-muted">{children}</span>; }
function FootLink({ children }: { children: React.ReactNode }) { return <button className="inline-flex items-center gap-1 text-[11px] font-medium text-regime-hot transition hover:opacity-80">{children}<ArrowRight className="h-3 w-3" /></button>; }
function SRow({ k, v, c }: { k: string; v: string; c?: string }) { return <div className="flex items-center justify-between py-0.5 text-xs"><span className="text-ink-faint">{k}</span><span className={['font-mono font-semibold tabular-nums', c ?? 'text-ink'].join(' ')}>{v}</span></div>; }
function KV({ k, v, c }: { k: string; v: string; c?: string }) { return <div className="rounded-md bg-base px-2 py-1"><div className="text-[9px] uppercase tracking-wider text-ink-faint">{k}</div><div className={['font-mono text-xs font-semibold', c ?? 'text-ink'].join(' ')}>{v}</div></div>; }
function SetupBadge({ setup }: { setup: Setup }) { const col = SETUP_COLOR[setup]; return <span className="inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium" style={{ color: col, borderColor: `${col}66`, background: `${col}14` }}>{setup}</span>; }

function PerfCard({ k, v, unit, delta, dPos, ring, chart, color, valTone }: { k: string; v: string; unit?: string; delta: string; dPos: boolean; ring?: number; chart?: 'up'; color?: string; valTone?: 'bull' }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/50 p-3 transition-colors duration-300 hover:border-accent/30">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{k}</div>
      <div className="mt-1.5 flex items-start justify-between gap-1">
        <div className={['font-mono text-2xl font-bold leading-none tracking-tight', valTone === 'bull' ? 'text-bull-bright' : 'text-ink'].join(' ')}>{v}{unit && <span className="ml-1 text-[10px] font-medium text-ink-faint">{unit}</span>}</div>
        {ring != null ? <Ring value={ring} /> : chart ? <MiniSpark color={color ?? '#26A69A'} /> : null}
      </div>
      <div className={['mt-2 inline-flex items-center gap-0.5 text-[10px] font-medium', dPos ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}><span className="text-[8px]">{dPos ? '▲' : '▼'}</span>{delta}</div>
    </div>
  );
}
function Ring({ value }: { value: number }) {
  const r = 13, c = 2 * Math.PI * r, dash = (clamp(value, 0, 100) / 100) * c;
  return (
    <div className="relative h-9 w-9 shrink-0">
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90"><circle cx="18" cy="18" r={r} fill="none" stroke="#2a3247" strokeWidth="4" /><circle cx="18" cy="18" r={r} fill="none" stroke="#26A69A" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} style={{ filter: 'drop-shadow(0 0 2px rgba(38,166,154,0.5))' }} /></svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[8px] font-semibold text-bull-bright">{Math.round(value)}</span>
    </div>
  );
}
function MiniSpark({ color }: { color: string }) {
  const pts = [10, 12, 9, 13, 11, 15, 14, 16, 15, 20];
  const W = 56, H = 26, max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1;
  const X = (i: number) => (i / (pts.length - 1)) * W, Y = (pt: number) => H - 2 - ((pt - min) / range) * (H - 4);
  const line = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(pt).toFixed(1)}`).join(' ');
  const id = `sp${color.replace('#', '')}`;
  const lx = X(pts.length - 1), ly = Y(pts[pts.length - 1]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-14 shrink-0 overflow-visible">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="1.7" fill={color} />
    </svg>
  );
}
function DisciplineGauge({ value, rating }: { value: number; rating: string }) {
  const v = clamp(value, 0, 100), angle = -90 + (v / 100) * 180;
  const color = v >= 90 ? '#26A69A' : v >= 75 ? '#9acd32' : v >= 60 ? '#f0a020' : '#f23645';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-32">
        <defs><filter id="dglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke="#2a3247" strokeWidth="13" strokeLinecap="round" />
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${(v / 100) * 267} 400`} style={{ filter: 'url(#dglow)' }} />
        <g transform={`rotate(${angle} 100 105)`}><line x1="100" y1="105" x2="100" y2="42" stroke="#e9eef7" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="105" r="5" fill="#e9eef7" /></g>
      </svg>
      <div className="-mt-3 font-mono text-2xl font-bold" style={{ color }}>{v}<span className="text-xs text-ink-faint">/100</span></div>
      <div className="text-xs font-semibold" style={{ color }}>{rating}</div>
    </div>
  );
}
function EquityChart({ points }: { points: JournalAnalysis['equity'] }) {
  if (points.length < 2) return <div className="flex h-[170px] items-center justify-center text-xs text-ink-faint">No data</div>;
  const W = 340, H = 150, pad = 4;
  const all = [...points.map((pt) => pt.equity), ...points.map((pt) => pt.benchmark), 0];
  const hi = Math.max(...all), lo = Math.min(...all), range = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad), y = (val: number) => pad + (1 - (val - lo) / range) * (H - 2 * pad);
  const path = (key: 'equity' | 'benchmark') => points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(pt[key]).toFixed(1)}`).join(' ');
  const yTicks = [0, 1, 2, 3].map((i) => lo + (range * i) / 3);
  const xIdx = [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3), points.length - 1];
  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col justify-between py-0.5 text-right font-mono text-[9px] text-ink-faint" style={{ height: 150 }}>{[...yTicks].reverse().map((t, i) => <span key={i}>{compact(t)}</span>)}</div>
      <div className="min-w-0 flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#26A69A" stopOpacity="0.24" /><stop offset="100%" stopColor="#26A69A" stopOpacity="0" /></linearGradient>
            <filter id="eqglow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {yTicks.map((t, i) => <line key={i} x1={pad} y1={y(t)} x2={W - pad} y2={y(t)} stroke="#2a3247" strokeWidth="0.4" strokeDasharray="2 3" />)}
          <path d={`${path('equity')} L ${x(points.length - 1)} ${H - pad} L ${pad} ${H - pad} Z`} fill="url(#eqfill)" />
          <path d={path('benchmark')} fill="none" stroke="#6aa6ff" strokeWidth="1.3" strokeOpacity="0.85" />
          <path d={path('equity')} fill="none" stroke="#26A69A" strokeWidth="1.7" style={{ filter: 'url(#eqglow)' }} />
        </svg>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-ink-faint">{xIdx.map((i) => <span key={i}>{new Date(points[i].time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>)}</div>
      </div>
    </div>
  );
}
function CalendarView({ analysis }: { analysis: JournalAnalysis }) {
  const map = new Map(analysis.calendar.map((d) => [Math.floor(d.date / 86_400_000), d]));
  const last = analysis.calendar.length ? analysis.calendar[analysis.calendar.length - 1].date : Date.now();
  const ref = new Date(last);
  const year = ref.getFullYear(), month = ref.getMonth(), todayDay = ref.getDate();
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span><span className="flex items-center gap-1"><ChevronLeft className="h-4 w-4 rounded border border-line p-0.5 text-ink-faint" /><ChevronRight className="h-4 w-4 rounded border border-line p-0.5 text-ink-faint" /></span></div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] text-ink-faint">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div key={d} className="py-0.5">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day == null) return <div key={i} />;
          const cd = map.get(Math.floor(new Date(year, month, day).getTime() / 86_400_000));
          const today = day === todayDay;
          const dot = !cd ? 'bg-surface-3' : cd.outcome === 'win' ? 'bg-bull' : cd.outcome === 'loss' ? 'bg-bear' : 'bg-neutral';
          return (
            <div key={i} className="flex flex-col items-center gap-0.5 py-1" title={cd ? `${cd.trades} trades · ${usd(cd.pnl)}` : ''}>
              <span className={['flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium', today ? 'bg-regime-hot font-bold text-white' : 'text-ink-muted'].join(' ')}>{day}</span>
              <span className={['h-1 w-1 rounded-full', cd ? dot : 'bg-transparent'].join(' ')} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-ink-faint"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-bull" /> Win</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-bear" /> Loss</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-surface-3" /> No Trades</span></div>
    </div>
  );
}
function Breakdown({ a }: { a: JournalAnalysis }) {
  const [tab, setTab] = useState<'setup' | 'tf' | 'regime'>('setup');
  type Row = { label: string; trades: number; winRate: number; netProfit: number; avgRR: number; profitFactor: number };
  const rows: Row[] = tab === 'setup' ? a.bySetup : tab === 'regime' ? a.byRegime : a.byTimeframe.map((b) => ({ label: b.label, trades: b.trades, winRate: b.winRate, netProfit: b.netProfit, avgRR: 0, profitFactor: 0 }));
  const head = tab === 'setup' ? 'Setup' : tab === 'regime' ? 'Regime' : 'Timeframe';
  return (
    <Panel title="Performance Breakdown" info footer={<FootLink>View Full Breakdown</FootLink>}>
      <div className="mb-3 flex items-center gap-1 rounded-lg border border-line bg-base p-0.5 text-[11px]">
        {([['setup', 'By Setup'], ['tf', 'By Timeframe'], ['regime', 'By Regime']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={['flex-1 rounded px-1 py-1 font-medium transition', tab === k ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink'].join(' ')}>{l}</button>)}
      </div>
      <table className="w-full text-left text-[11px]">
        <thead className="text-[9px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1 font-medium">{head}</th><th className="py-1 text-right font-medium">Trades</th><th className="py-1 text-right font-medium">Win Rate</th><th className="py-1 text-right font-medium">Net Profit</th><th className="py-1 text-right font-medium">Avg R:R</th><th className="py-1 text-right font-medium">PF</th></tr></thead>
        <tbody>{rows.map((b) => <tr key={b.label} className="border-t border-line/50"><td className="py-1.5 font-medium">{b.label}</td><td className="py-1.5 text-right">{b.trades}</td><td className="py-1.5 text-right">{b.winRate}%</td><td className={['py-1.5 text-right font-mono', tone(b.netProfit)].join(' ')}>{usd(b.netProfit)}</td><td className="py-1.5 text-right font-mono text-ink-muted">{tab === 'tf' ? '—' : `${b.avgRR}R`}</td><td className={['py-1.5 text-right font-mono', tab === 'tf' ? 'text-ink-faint' : b.profitFactor >= 1.5 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{tab === 'tf' ? '—' : b.profitFactor}</td></tr>)}</tbody>
      </table>
    </Panel>
  );
}
function EmotionDonut({ a }: { a: JournalAnalysis }) {
  const r = 34, c = 2 * Math.PI * r; let off = 0;
  const top = [...a.emotions].sort((x, y) => y.pct - x.pct)[0];
  const gap = 1.5; // small separator between segments
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[116px] w-[116px] shrink-0">
        <svg viewBox="0 0 116 116" className="h-full w-full -rotate-90"><circle cx="58" cy="58" r={r} fill="none" stroke="#2a3247" strokeWidth="13" />{a.emotions.map((e) => { const dash = Math.max(0, (e.pct / 100) * c - gap); const el = <circle key={e.emotion} cx="58" cy="58" r={r} fill="none" stroke={EMO_COLOR[e.emotion]} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-off} />; off += (e.pct / 100) * c; return el; })}</svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-bold leading-none" style={{ color: EMO_COLOR[top.emotion] }}>{top.pct}%</span>
          <span className="mt-0.5 text-[9px] text-ink-faint">{top.emotion}</span>
        </div>
      </div>
      <ul className="flex-1 space-y-1.5 text-[11px]">
        {a.emotions.map((e) => <li key={e.emotion} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: EMO_COLOR[e.emotion] }} /><span className="flex-1 text-ink-muted">{e.emotion}</span><span className="font-mono text-ink-faint">{e.pct}%</span></li>)}
      </ul>
    </div>
  );
}
function ReplayChart({ candles, entry, exit, dir }: { candles: Candle[]; entry: number; exit: number; dir: 'Long' | 'Short' }) {
  if (candles.length < 2) return <div className="flex h-[150px] items-center justify-center text-[11px] text-ink-faint">No data</div>;
  const W = 300, H = 150, pad = 4, extra = [entry, exit];
  const hi = Math.max(...candles.map((c) => c.high), ...extra), lo = Math.min(...candles.map((c) => c.low), ...extra), range = hi - lo || 1;
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad), cw = (W - 2 * pad) / candles.length;
  const tp = dir === 'Long' ? Math.max(entry, exit) : Math.min(entry, exit);
  const sl = dir === 'Long' ? Math.min(entry, exit) : Math.max(entry, exit);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" preserveAspectRatio="none">
        {candles.map((c, i) => { const x = pad + i * cw + cw / 2, up = c.close >= c.open, col = up ? '#26A69A' : '#f23645'; const bt = y(Math.max(c.open, c.close)), bb = y(Math.min(c.open, c.close)); return <g key={i}><line x1={x} y1={y(c.high)} x2={x} y2={y(c.low)} stroke={col} strokeWidth="0.7" opacity="0.85" /><rect x={x - cw * 0.3} y={bt} width={cw * 0.6} height={Math.max(1, bb - bt)} fill={col} /></g>; })}
        <line x1={pad} y1={y(tp)} x2={W - pad} y2={y(tp)} stroke="#26A69A" strokeWidth="1" strokeDasharray="4 3" />
        <line x1={pad} y1={y(entry)} x2={W - pad} y2={y(entry)} stroke="#6aa6ff" strokeWidth="1" strokeDasharray="4 3" />
        <line x1={pad} y1={y(sl)} x2={W - pad} y2={y(sl)} stroke="#f23645" strokeWidth="1" strokeDasharray="4 3" />
      </svg>
      <span className="absolute right-1 -translate-y-1/2 rounded bg-bull/90 px-1 text-[8px] font-semibold text-white" style={{ top: `${(y(tp) / H) * 100}%` }}>Take Profit</span>
      <span className="absolute left-1 -translate-y-1/2 rounded bg-accent/90 px-1 text-[8px] font-semibold text-white" style={{ top: `${(y(entry) / H) * 100}%` }}>Entry</span>
      <span className="absolute right-1 -translate-y-1/2 rounded bg-bear/90 px-1 text-[8px] font-semibold text-white" style={{ top: `${(y(sl) / H) * 100}%` }}>Stop Loss</span>
    </div>
  );
}
