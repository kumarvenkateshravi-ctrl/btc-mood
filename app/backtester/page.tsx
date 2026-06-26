'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bitcoin, Info, Play, Check, X, Plus, Save, FilePlus, TrendingUp, Sparkles, Calendar, type LucideIcon } from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import {
  runSetupBacktest, optimizeEntry, monteCarlo, confidenceScore, generateInsights, cid,
  type BacktestConfig, type Condition, type Operator, type BTrade, type EquityPoint,
} from '@/lib/setupBacktest';
import StackSidebar from '@/components/stack/StackSidebar';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtN = (n: number, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (n: number) => (n >= 0 ? '+' : '');
const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString('en-CA');
const TF_LABEL: Record<Timeframe, string> = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
const DATE_RANGES: [string, number][] = [['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365], ['2Y', 730], ['3Y', 1095], ['5Y', 1825]];
const DATA_SOURCES = ['Binance', 'Coinbase', 'Bybit'];

const ENTRY_METRICS = ['Stack Score', 'MTF Alignment', 'Trend Strength', 'Volume', 'Market Regime'];
const EXIT_METRICS = ['Take Profit', 'Stack Score', 'MTF Alignment', 'Stop Loss'];
const OPS_BY_METRIC: Record<string, Operator[]> = {
  'Stack Score': ['Greater Than', 'Less Than', 'At Least'], 'Trend Strength': ['Greater Than', 'Less Than', 'At Least'],
  'MTF Alignment': ['At Least', 'Greater Than', 'Less Than'], Volume: ['Above SMA20'], 'Market Regime': ['Is Trending'],
  'Take Profit': ['RR Greater Than'], 'Stop Loss': ['Fixed'],
};
const NO_VALUE: Operator[] = ['Above SMA20', 'Is Trending'];
const isApprox = (metric: string) => metric === 'MTF Alignment';

const C = (metric: string, operator: Operator, value: number): Condition => ({ id: cid(), enabled: true, metric, operator, value });
const initialEntry = (): Condition[] => [
  C('Stack Score', 'Greater Than', 75), C('MTF Alignment', 'At Least', 4), C('Trend Strength', 'Greater Than', 60),
  C('Volume', 'Above SMA20', 0), C('Market Regime', 'Is Trending', 20),
];
const initialExit = (): Condition[] => [
  C('Take Profit', 'RR Greater Than', 2.5), C('Stack Score', 'Less Than', 50), C('MTF Alignment', 'Less Than', 3), C('Stop Loss', 'Fixed', 1.5),
];

interface SavedStrategy { name: string; entry: Condition[]; exit: Condition[] }
const LIBRARY = [
  { name: 'Scalper Pro', win: 62.4, pf: 2.15, score: 65, mtf: 4, trend: 55, tp: 1.5, sl: 1 },
  { name: 'Swing Trend', win: 65.8, pf: 2.48, score: 72, mtf: 5, trend: 65, tp: 3, sl: 1.5 },
  { name: 'Trend Continuation', win: 67.3, pf: 2.67, score: 70, mtf: 5, trend: 60, tp: 2.5, sl: 1.5 },
  { name: 'Pullback Hunter', win: 61.1, pf: 1.98, score: 75, mtf: 4, trend: 55, tp: 2, sl: 1.2 },
  { name: 'Breakout Hunter', win: 58.9, pf: 1.84, score: 80, mtf: 5, trend: 70, tp: 3, sl: 1.8 },
  { name: 'Reversal Setup', win: 55.2, pf: 1.62, score: 30, mtf: 2, trend: 40, tp: 2.5, sl: 1.5 },
];
function presetConds(p: typeof LIBRARY[number]) {
  return {
    entry: [C('Stack Score', 'Greater Than', p.score), C('MTF Alignment', 'At Least', p.mtf), C('Trend Strength', 'Greater Than', p.trend), C('Volume', 'Above SMA20', 0), C('Market Regime', 'Is Trending', 20)],
    exit: [C('Take Profit', 'RR Greater Than', p.tp), C('Stack Score', 'Less Than', 50), C('MTF Alignment', 'Less Than', 3), C('Stop Loss', 'Fixed', p.sl)],
  };
}

const SAVED_KEY = 'mcs:strategies:v1';
function loadSaved(): SavedStrategy[] { if (typeof window === 'undefined') return []; try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; } }
function persistSaved(s: SavedStrategy[]) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(s)); } catch {} }

export default function BacktesterPage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const { candlesByTf, status } = useMarketData(symbol);
  const { prices } = useMoodEngine(candlesByTf, []);
  const [btf, setBtf] = useState<Timeframe>('1h');
  const [name, setName] = useState('Trend Continuation Pro');
  const [entry, setEntry] = useState<Condition[]>(initialEntry);
  const [exit, setExit] = useState<Condition[]>(initialExit);
  const [risk, setRisk] = useState({ riskPct: 1, initialCapital: 10_000, commissionPct: 0.1, slippagePct: 0.05, leverage: 5, allowShort: true });
  const [rangeDays, setRangeDays] = useState(1095);
  const [source, setSource] = useState('Binance');
  const [saved, setSaved] = useState<SavedStrategy[]>([]);
  const [libFilter, setLibFilter] = useState('All Strategies');
  const [runs, setRuns] = useState(0);
  const [running, setRunning] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setSaved(loadSaved()); }, []);
  useEffect(() => { setRuns((r) => r + 1); }, [btf]); // re-run counter when a fresh dataset/strategy is loaded

  const onRun = () => {
    setRunning(true);
    setRuns((r) => r + 1);
    window.setTimeout(() => {
      setRunning(false);
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 450);
  };

  const cfg: BacktestConfig = useMemo(() => ({ entryConditions: entry, exitConditions: exit, ...risk }), [entry, exit, risk]);
  const rawCandles = candlesByTf[btf] ?? [];
  const candles = useMemo(() => { if (!rawCandles.length) return rawCandles; const cutoff = rawCandles[rawCandles.length - 1].time - rangeDays * 86400; return rawCandles.filter((c) => c.time >= cutoff); }, [rawCandles, rangeDays]);
  const ready = rawCandles.length > 0;

  const result = useMemo(() => runSetupBacktest(candles, cfg), [candles, cfg]);
  const opt = useMemo(() => optimizeEntry(candles, cfg), [candles, cfg]);
  const mc = useMemo(() => monteCarlo(result, cfg), [result, cfg]);
  const confidence = useMemo(() => confidenceScore(result), [result]);
  const insights = useMemo(() => generateInsights(result), [result]);
  const hasTrades = result.trades.length > 0;
  const tpR = exit.find((c) => c.enabled && c.metric === 'Take Profit')?.value ?? 2.5;

  const price = prices['5m'] ?? prices['1d'] ?? 0;

  // ---- Sidebar: Quick Stats + Data Coverage (image-faithful) ----
  const avgWin = LIBRARY.reduce((s, l) => s + l.win, 0) / LIBRARY.length;
  const bestPF = Math.max(...LIBRARY.map((l) => l.pf));
  const spanDays = result.coverage.bars > 1 ? Math.max(1, Math.round((result.coverage.to - result.coverage.from) / 86400)) : 0;
  const histLabel = spanDays >= 365 ? `${(spanDays / 365).toFixed(1)} Years` : `${spanDays} Days`;
  const sidebarExtra = (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Quick Stats</div>
      <SRow k="Total Strategies" v={String(LIBRARY.length + saved.length)} />
      <SRow k="Backtests Run" v={String(runs)} />
      <SRow k="Winning Strategies" v={String(LIBRARY.filter((l) => l.pf >= 1.5).length + saved.length)} />
      <SRow k="Avg Win Rate" v={`${avgWin.toFixed(1)}%`} tone="bull" />
      <SRow k="Best Profit Factor" v={bestPF.toFixed(2)} tone="bull" />
      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Data Coverage</div>
      <SRow k="Symbols Supported" v="5" />
      <SRow k="Historical Data" v={histLabel} tone="bull" />
      <SRow k="Timeframes" v={String(TIMEFRAMES.length)} />
      <SRow k="Data Quality" v={`${result.coverage.quality}%`} tone="bull" />
    </>
  );

  // ---- condition helpers ----
  const upd = (set: typeof setEntry) => (id: string, patch: Partial<Condition>) => set((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const del = (set: typeof setEntry) => (id: string) => set((l) => l.filter((c) => c.id !== id));
  const add = (set: typeof setEntry, metrics: string[]) => set((l) => [...l, C(metrics[0], OPS_BY_METRIC[metrics[0]][0], 50)]);

  const saveStrategy = (asNew: boolean) => {
    const s: SavedStrategy = { name: asNew ? `${name} Copy` : name, entry, exit };
    const next = asNew ? [...saved, s] : [...saved.filter((x) => x.name !== name), s];
    setSaved(next); persistSaved(next); if (asNew) setName(s.name);
  };
  const createNew = () => { setName('New Strategy'); setEntry([C('Stack Score', 'Greater Than', 70)]); setExit([C('Take Profit', 'RR Greater Than', 2), C('Stop Loss', 'Fixed', 1.5)]); };

  return (
    <div className="flex min-h-[100dvh] w-full bg-base text-ink">
      <StackSidebar extra={sidebarExtra} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-1.5"><Bitcoin className="h-4 w-4 text-regime-hot" /><span className="font-semibold">{symbol}</span></div>
          <span className="font-mono text-lg font-semibold tabular-nums">{fmtN(price)}</span>
          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1.5"><span className={['h-2 w-2 rounded-full', status === 'live' ? 'bg-bull' : 'bg-regime-hot'].join(' ')} />{status === 'live' ? 'Live' : status}</span>
            <Link href="/app" className="rounded-md border border-line px-2 py-1 transition hover:text-ink">Chart →</Link>
          </div>
        </header>

        {!ready ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading historical data…</div>
        ) : (
          <div className="flex-1 space-y-3 overflow-auto p-3">
            <div className="flex items-baseline gap-2"><h1 className="text-base font-bold tracking-wide text-accent">BACKTESTER</h1><span className="text-xs text-ink-faint">Test your setup signals against historical data and improve your edge</span></div>

            {/* Wizard */}
            <div className="grid grid-cols-4 gap-2">
              {[['1', 'Strategy Setup', 'Build or choose strategy'], ['2', 'Configure', 'Set data & risk parameters'], ['3', 'Run Backtest', 'Execute & generate results'], ['4', 'Analyze', 'Review performance & insights']].map(([n, t, s], i) => (
                <div key={n} className={['flex items-center gap-2 rounded-lg border px-3 py-2', i === 3 && hasTrades ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface-1'].join(' ')}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">{n}</span>
                  <div className="min-w-0"><div className="truncate text-xs font-semibold">{t}</div><div className="truncate text-[10px] text-ink-faint">{s}</div></div>
                </div>
              ))}
            </div>

            {/* Config row */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr_1fr_1fr]">
              {/* Strategy Builder */}
              <Panel title="Strategy Builder">
                <div className="mb-3 flex items-center gap-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 flex-1 rounded-lg border border-line bg-base px-2 text-sm text-ink outline-none focus:border-line-strong" />
                  <button onClick={() => saveStrategy(false)} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:bg-surface-2 hover:text-ink"><Save className="h-3.5 w-3.5" /> Save</button>
                  <button onClick={() => saveStrategy(true)} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:bg-surface-2 hover:text-ink"><FilePlus className="h-3.5 w-3.5" /> Save As New</button>
                </div>

                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-bull-bright">Entry Conditions <span className="text-ink-faint">(All must be true)</span></div>
                <div className="space-y-1.5">
                  {entry.map((c) => <CondRow key={c.id} c={c} metrics={ENTRY_METRICS} onChange={upd(setEntry)} onDelete={del(setEntry)} good />)}
                  <AddBtn onClick={() => add(setEntry, ENTRY_METRICS)} />
                </div>

                <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-bear-bright">Exit Conditions <span className="text-ink-faint">(Any can be true)</span></div>
                <div className="space-y-1.5">
                  {exit.map((c) => <CondRow key={c.id} c={c} metrics={EXIT_METRICS} onChange={upd(setExit)} onDelete={del(setExit)} />)}
                  <AddBtn onClick={() => add(setExit, EXIT_METRICS)} />
                </div>
              </Panel>

              {/* Setup Library */}
              <Panel title="Setup Library">
                <select value={libFilter} onChange={(e) => setLibFilter(e.target.value)} className="mb-2 h-8 w-full rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-line-strong [color-scheme:dark]">
                  {['All Strategies', 'My Saved', 'Built-in'].map((o) => <option key={o}>{o}</option>)}
                </select>
                <div className="max-h-[260px] space-y-1.5 overflow-y-auto">
                  {libFilter !== 'Built-in' && saved.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5">
                      <Save className="h-4 w-4 text-accent" /><div className="min-w-0 flex-1 truncate text-xs font-medium">{s.name}</div>
                      <button onClick={() => { setEntry(s.entry.map((c) => ({ ...c, id: cid() }))); setExit(s.exit.map((c) => ({ ...c, id: cid() }))); setName(s.name); }} className="focus-ring rounded border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:bg-surface-2 hover:text-ink">Use</button>
                    </div>
                  ))}
                  {libFilter !== 'My Saved' && LIBRARY.map((p) => (
                    <div key={p.name} className="flex items-center gap-2 rounded-lg border border-line bg-base/40 px-2.5 py-1.5">
                      <TrendingUp className="h-4 w-4 text-accent" />
                      <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{p.name}</div><div className="text-[10px] text-ink-faint">Win {p.win}% · PF {p.pf}</div></div>
                      <button onClick={() => { const c = presetConds(p); setEntry(c.entry); setExit(c.exit); setName(p.name); }} className="focus-ring rounded border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:bg-surface-2 hover:text-ink">Use</button>
                    </div>
                  ))}
                </div>
                <button onClick={createNew} className="focus-ring mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"><FilePlus className="h-3.5 w-3.5" /> Create New Strategy</button>
              </Panel>

              {/* Data Configuration */}
              <Panel title="Data Configuration">
                <div className="space-y-2 text-xs">
                  <Field label="Symbol"><div className="flex h-9 items-center rounded-lg border border-line bg-base px-2">{symbol}</div></Field>
                  <Field label="Timeframe">
                    <div className="flex items-center gap-1 rounded-lg border border-line bg-base p-0.5">{TIMEFRAMES.map((tf) => <button key={tf} onClick={() => setBtf(tf)} className={['flex-1 rounded px-1 py-1 text-[11px] font-medium transition', btf === tf ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink'].join(' ')}>{TF_LABEL[tf]}</button>)}</div>
                  </Field>
                  <Field label="Date Range">
                    <div className="mb-1 flex h-9 items-center gap-1.5 rounded-lg border border-line bg-base px-2 text-ink-muted"><Calendar className="h-3.5 w-3.5" />{fmtDate(result.coverage.from)} → {fmtDate(result.coverage.to)}</div>
                    <div className="flex flex-wrap gap-1">{DATE_RANGES.map(([l, d]) => <button key={l} onClick={() => setRangeDays(d)} className={['rounded px-2 py-0.5 text-[10px] font-medium transition', rangeDays === d ? 'bg-accent/20 text-accent' : 'border border-line text-ink-faint hover:text-ink'].join(' ')}>{l}</button>)}</div>
                  </Field>
                  <Field label="Data Source"><select value={source} onChange={(e) => setSource(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-line-strong [color-scheme:dark]">{DATA_SOURCES.map((s) => <option key={s} value={s} disabled={s !== 'Binance'}>{s}{s !== 'Binance' ? ' (soon)' : ''}</option>)}</select></Field>
                  <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint">Data Loaded</div>
                    <div className="font-mono text-base font-bold text-bull-bright">{result.coverage.bars.toLocaleString()} bars</div>
                    <div className="text-[10px] text-ink-faint">{result.coverage.quality}% quality · loaded window</div>
                  </div>
                </div>
              </Panel>

              {/* Risk Configuration */}
              <Panel title="Risk Configuration">
                <div className="space-y-2 text-xs">
                  <Field label="Initial Capital (USDT)"><Num value={risk.initialCapital} onChange={(v) => setRisk((r) => ({ ...r, initialCapital: v }))} step={1000} wide /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Risk Per Trade %"><Num value={risk.riskPct} onChange={(v) => setRisk((r) => ({ ...r, riskPct: v }))} step={0.5} wide /></Field>
                    <Field label="Leverage"><Num value={risk.leverage} onChange={(v) => setRisk((r) => ({ ...r, leverage: v }))} wide /></Field>
                    <Field label="Commission %"><Num value={risk.commissionPct} onChange={(v) => setRisk((r) => ({ ...r, commissionPct: v }))} step={0.05} wide /></Field>
                    <Field label="Slippage %"><Num value={risk.slippagePct} onChange={(v) => setRisk((r) => ({ ...r, slippagePct: v }))} step={0.05} wide /></Field>
                  </div>
                  <label className="flex items-center justify-between rounded-lg border border-line bg-base px-2 py-1.5"><span className="text-ink-muted">Allow Shorts</span><input type="checkbox" checked={risk.allowShort} onChange={(e) => setRisk((r) => ({ ...r, allowShort: e.target.checked }))} className="accent-[var(--accent,#6aa6ff)]" /></label>
                  <button onClick={onRun} disabled={running} className="focus-ring mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-70">
                    {running ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Running…</> : <><Play className="h-4 w-4" /> Run Backtest</>}
                  </button>
                </div>
              </Panel>
            </div>

            <div ref={resultsRef} className="scroll-mt-4 space-y-3">
            {!hasTrades ? (
              <Panel><p className="py-6 text-center text-sm text-ink-faint">No trades for these rules on the loaded window. Lower the Setup Score / MTF thresholds, widen the date range, or load more history.</p></Panel>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.6fr_1fr_1fr]">
                  <div className="space-y-3">
                    <Panel title="Performance Overview">
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        <Metric k="Total Return" v={`${sgn(result.metrics.totalReturnPct)}${result.metrics.totalReturnPct}%`} sub={`${sgn(result.metrics.totalReturnAbs)}${Math.round(result.metrics.totalReturnAbs)}`} tone={result.metrics.totalReturnPct >= 0 ? 'bull' : 'bear'} />
                        <Metric k="Win Rate" v={`${result.metrics.winRate}%`} />
                        <Metric k="Profit Factor" v={`${result.metrics.profitFactor}`} tone={result.metrics.profitFactor >= 1.5 ? 'bull' : 'bear'} />
                        <Metric k="Sharpe" v={`${result.metrics.sharpe}`} />
                        <Metric k="Max DD" v={`${result.metrics.maxDrawdownPct}%`} tone="bear" />
                        <Metric k="Expectancy" v={`${result.metrics.expectancy}R`} tone={result.metrics.expectancy >= 0 ? 'bull' : 'bear'} />
                      </div>
                    </Panel>
                    <Panel title="Equity Curve"><EquityChart points={result.equity} initial={risk.initialCapital} /></Panel>
                  </div>
                  <div className="space-y-3">
                    <Panel title="Trade Distribution"><Distribution d={result.distribution} /></Panel>
                    <Panel title="Drawdown Analysis">
                      <div className="space-y-1 text-xs">
                        <KV k="Max Drawdown" v={`${result.drawdown.maxPct}%`} tone="bear" /><KV k="Average Drawdown" v={`${result.drawdown.avgPct}%`} />
                        <KV k="Max DD Duration" v={`${result.drawdown.maxDurationBars} bars`} /><KV k="Recovery Factor" v={`${result.drawdown.recoveryFactor}`} tone="bull" />
                      </div>
                      <DrawdownChart points={result.equity} />
                    </Panel>
                  </div>
                  <Panel title="Trade List (recent 10)">
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[9px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Date</th><th className="py-1">Side</th><th className="py-1 text-right">Entry</th><th className="py-1 text-right">Exit</th><th className="py-1 text-right">R</th><th className="py-1 text-right">PnL</th></tr></thead>
                      <tbody>{result.trades.slice(-10).reverse().map((t, i) => <TradeRow key={i} t={t} />)}</tbody>
                    </table>
                  </Panel>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
                  <Panel title="Setup Breakdown" approx>
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[9px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Alignment</th><th className="py-1 text-right">Trades</th><th className="py-1 text-right">Win%</th><th className="py-1 text-right">PF</th><th className="py-1 text-right">RR</th></tr></thead>
                      <tbody>{result.setupBreakdown.map((b) => <tr key={b.label} className="border-t border-line/50"><td className="py-1.5">{b.label}</td><td className="py-1.5 text-right">{b.trades}</td><td className="py-1.5 text-right">{b.winRate}%</td><td className={['py-1.5 text-right font-mono', b.profitFactor >= 1.5 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{b.profitFactor}</td><td className="py-1.5 text-right font-mono">{b.avgRR}R</td></tr>)}</tbody>
                    </table>
                  </Panel>
                  <Panel title="Parameter Optimization">
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[9px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Parameter</th><th className="py-1 text-right">Current</th><th className="py-1 text-right">Optimal</th><th className="py-1 text-right">Improve</th></tr></thead>
                      <tbody>
                        <tr className="border-t border-line/50"><td className="py-1.5">Stack Score ≥</td><td className="py-1.5 text-right font-mono">{opt.current}</td><td className="py-1.5 text-right font-mono text-accent">{opt.optimal}</td><td className={['py-1.5 text-right font-mono', opt.improvementPct >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{sgn(opt.improvementPct)}{opt.improvementPct}%</td></tr>
                        <tr className="border-t border-line/50"><td className="py-1.5">Take Profit (R)</td><td className="py-1.5 text-right font-mono">{tpR}</td><td className="py-1.5 text-right font-mono text-ink-faint">tune</td><td className="py-1.5 text-right text-ink-faint">—</td></tr>
                        <tr className="border-t border-line/50"><td className="py-1.5">Risk Per Trade</td><td className="py-1.5 text-right font-mono">{risk.riskPct}%</td><td className="py-1.5 text-right font-mono text-ink-faint">tune</td><td className="py-1.5 text-right text-ink-faint">—</td></tr>
                      </tbody>
                    </table>
                    {opt.optimal !== opt.current && <button onClick={() => setEntry((l) => l.map((c) => (c.metric === 'Stack Score' ? { ...c, value: opt.optimal } : c)))} className="focus-ring mt-2 w-full rounded-lg border border-accent/40 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/10">Apply optimal threshold</button>}
                  </Panel>
                  <Panel title="Monte Carlo (1000 runs)">
                    <BellCurve worst={mc.worst} expected={mc.expected} best={mc.best} />
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                      <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">Worst (5%)</div><div className="font-mono font-bold text-bear-bright">{sgn(mc.worst)}{mc.worst}%</div></div>
                      <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">Expected</div><div className="font-mono font-bold">{sgn(mc.expected)}{mc.expected}%</div></div>
                      <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">Best (95%)</div><div className="font-mono font-bold text-bull-bright">{sgn(mc.best)}{mc.best}%</div></div>
                    </div>
                  </Panel>
                  <Panel title="AI Insights">
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-base/40 px-2.5 py-2"><Sparkles className="h-4 w-4 text-accent" /><div><div className="text-[10px] uppercase tracking-wider text-ink-faint">Setup Confidence</div><div className={['font-mono text-lg font-bold', confidence >= 80 ? 'text-bull-bright' : confidence >= 60 ? 'text-regime-hot' : 'text-bear-bright'].join(' ')}>{confidence}/100</div></div></div>
                    <ul className="space-y-1.5 text-[11px]">{insights.map((t, i) => <li key={i} className="flex items-start gap-2 text-ink-muted"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bull-bright" />{t}</li>)}</ul>
                  </Panel>
                </div>
              </>
            )}
            </div>
          </div>
        )}
        <footer className="flex items-center justify-between border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span className="italic">“In testing you trust, in live trading you execute.”</span>
          <span className="inline-flex items-center gap-2"><Info className="h-3 w-3" /> {source} · {status === 'live' ? 'Connected' : status} · MTF Alignment is approx</span>
        </footer>
      </div>
    </div>
  );
}

// ---- condition row ----
function CondRow({ c, metrics, onChange, onDelete, good }: { c: Condition; metrics: string[]; onChange: (id: string, p: Partial<Condition>) => void; onDelete: (id: string) => void; good?: boolean }) {
  const ops = OPS_BY_METRIC[c.metric] ?? ['Greater Than'];
  const hideVal = NO_VALUE.includes(c.operator);
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-line bg-base/40 px-2 py-1.5">
      <button onClick={() => onChange(c.id, { enabled: !c.enabled })} className={['flex h-4 w-4 shrink-0 items-center justify-center rounded-full', c.enabled ? (good ? 'bg-bull/20 text-bull-bright' : 'bg-bear/20 text-bear-bright') : 'border border-line text-transparent'].join(' ')}><Check className="h-3 w-3" /></button>
      <select value={c.metric} onChange={(e) => { const metric = e.target.value; onChange(c.id, { metric, operator: OPS_BY_METRIC[metric][0] }); }} className="h-7 min-w-0 flex-1 rounded border border-line bg-base px-1 text-[11px] text-ink outline-none [color-scheme:dark]">{metrics.map((m) => <option key={m}>{m}</option>)}</select>
      {isApprox(c.metric) && <span className="rounded bg-regime-hot/15 px-1 py-0.5 text-[8px] font-bold uppercase text-regime-hot">approx</span>}
      <select value={c.operator} onChange={(e) => onChange(c.id, { operator: e.target.value as Operator })} className="h-7 min-w-0 flex-1 rounded border border-line bg-base px-1 text-[11px] text-ink outline-none [color-scheme:dark]">{ops.map((o) => <option key={o}>{o}</option>)}</select>
      {!hideVal && <input type="number" step="any" value={c.value} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(c.id, { value: n }); }} className="h-7 w-12 shrink-0 rounded border border-line bg-base px-1 text-right font-mono text-[11px] text-ink outline-none" />}
      <button onClick={() => onDelete(c.id)} className="shrink-0 rounded p-0.5 text-ink-faint transition hover:text-bear-bright"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}
function AddBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="focus-ring flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-line py-1 text-[11px] text-accent transition hover:bg-accent/5"><Plus className="h-3.5 w-3.5" /> Add Condition</button>;
}

// ---- shared helpers (charts/panels) ----
function Panel({ title, approx, children }: { title?: string; approx?: boolean; children: React.ReactNode }) {
  return <section className="rounded-xl border border-line bg-surface-1 p-3">{title && <div className="mb-2 flex items-center gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">{title}</h3>{approx && <span className="rounded bg-regime-hot/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-regime-hot">approx alignment</span>}</div>}{children}</section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>{children}</label>; }
function SRow({ k, v, tone }: { k: string; v: string; tone?: 'bull' }) {
  return <div className="flex items-center justify-between py-0.5 text-xs"><span className="text-ink-faint">{k}</span><span className={['font-mono font-semibold tabular-nums', tone === 'bull' ? 'text-bull-bright' : 'text-ink'].join(' ')}>{v}</span></div>;
}
function Num({ value, onChange, step = 1, wide }: { value: number; onChange: (v: number) => void; step?: number; wide?: boolean }) {
  return <input type="number" step={step} value={value} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} className={['h-8 rounded border border-line bg-base px-1.5 text-right font-mono text-xs text-ink outline-none focus:border-line-strong', wide ? 'w-full' : 'w-16'].join(' ')} />;
}
function KV({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return <div className="flex items-center justify-between"><span className="text-ink-faint">{k}</span><span className={['font-mono tabular-nums', c].join(' ')}>{v}</span></div>;
}
function Metric({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: 'bull' | 'bear' }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return <div className="rounded-lg border border-line bg-base/40 px-2 py-2 text-center"><div className="text-[9px] uppercase tracking-wider text-ink-faint">{k}</div><div className={['font-mono text-base font-bold', c].join(' ')}>{v}</div>{sub && <div className="text-[9px] text-ink-faint">{sub}</div>}</div>;
}
function TradeRow({ t }: { t: BTrade }) {
  return (
    <tr className="border-t border-line/50">
      <td className="py-1.5 font-mono text-ink-faint">{fmtDate(t.date)}</td>
      <td className={['py-1.5 font-medium', t.side === 'Long' ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{t.side}</td>
      <td className="py-1.5 text-right font-mono">{fmtN(t.entry, 0)}</td><td className="py-1.5 text-right font-mono">{fmtN(t.exit, 0)}</td>
      <td className={['py-1.5 text-right font-mono', t.rr >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{sgn(t.rr)}{t.rr}R</td>
      <td className={['py-1.5 text-right font-mono', t.pnl >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{sgn(t.pnl)}{Math.round(t.pnl)}</td>
    </tr>
  );
}
function Distribution({ d }: { d: { wins: number; losses: number; breakeven: number; total: number } }) {
  const r = 34, c = 2 * Math.PI * r, segs = [{ v: d.wins, color: '#26A69A' }, { v: d.losses, color: '#f23645' }, { v: d.breakeven, color: '#9ab2d7' }];
  let off = 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[92px] w-[92px] shrink-0"><svg viewBox="0 0 92 92" className="h-full w-full -rotate-90"><circle cx="46" cy="46" r={r} fill="none" stroke="#2a3247" strokeWidth="9" />{segs.map((s, i) => { const dash = (d.total ? s.v / d.total : 0) * c; const el = <circle key={i} cx="46" cy="46" r={r} fill="none" stroke={s.color} strokeWidth="9" strokeDasharray={`${dash} ${c}`} strokeDashoffset={-off} />; off += dash; return el; })}</svg><div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[9px] text-ink-faint">Total</span><span className="text-xl font-bold">{d.total}</span></div></div>
      <ul className="space-y-1.5 text-xs">
        <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-bull" /> Wins <span className="ml-auto font-mono font-semibold">{d.wins} ({d.total ? ((d.wins / d.total) * 100).toFixed(1) : 0}%)</span></li>
        <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-bear" /> Losses <span className="ml-auto font-mono font-semibold">{d.losses} ({d.total ? ((d.losses / d.total) * 100).toFixed(1) : 0}%)</span></li>
        <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-neutral" /> Breakeven <span className="ml-auto font-mono font-semibold">{d.breakeven}</span></li>
      </ul>
    </div>
  );
}
function EquityChart({ points, initial }: { points: EquityPoint[]; initial: number }) {
  if (points.length < 2) return <div className="flex h-[160px] items-center justify-center text-xs text-ink-faint">No equity data</div>;
  const W = 640, H = 160, pad = 6, all = [...points.map((p) => p.equity), ...points.map((p) => p.benchmark), initial];
  const hi = Math.max(...all), lo = Math.min(...all), range = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad), y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad);
  const path = (key: 'equity' | 'benchmark') => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-[160px] w-full" preserveAspectRatio="none"><path d={`${path('equity')} L ${x(points.length - 1)} ${H - pad} L ${pad} ${H - pad} Z`} fill="#6aa6ff" opacity="0.08" /><path d={path('benchmark')} fill="none" stroke="#7b88a0" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" /><path d={path('equity')} fill="none" stroke="#6aa6ff" strokeWidth="1.6" /></svg>;
}
function DrawdownChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) return null;
  const W = 240, H = 56, pad = 3, minDD = Math.min(...points.map((p) => p.drawdownPct), -0.1);
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad), y = (v: number) => pad + (v / minDD) * (H - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.drawdownPct).toFixed(1)}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[56px] w-full" preserveAspectRatio="none"><path d={`${path} L ${x(points.length - 1)} ${pad} L ${pad} ${pad} Z`} fill="#f23645" opacity="0.15" /><path d={path} fill="none" stroke="#f23645" strokeWidth="1" /></svg>;
}
function BellCurve({ worst, expected, best }: { worst: number; expected: number; best: number }) {
  const W = 240, H = 70, pad = 4, lo = Math.min(worst, 0) - 5, hi = Math.max(best, 0) + 5, range = hi - lo || 1;
  const xpos = (v: number) => pad + ((v - lo) / range) * (W - 2 * pad), mu = xpos(expected), sigma = (xpos(best) - xpos(worst)) / 3.3 || 20;
  const pts = Array.from({ length: 60 }, (_, i) => { const px = pad + (i / 59) * (W - 2 * pad); const g = Math.exp(-((px - mu) ** 2) / (2 * sigma * sigma)); return `${px.toFixed(1)} ${(H - pad - g * (H - 2 * pad)).toFixed(1)}`; });
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-[70px] w-full"><path d={`M ${pad} ${H - pad} L ${pts.join(' L ')} L ${W - pad} ${H - pad} Z`} fill="#6aa6ff" opacity="0.18" /><polyline points={pts.join(' ')} fill="none" stroke="#6aa6ff" strokeWidth="1.4" /><line x1={mu} y1={pad} x2={mu} y2={H - pad} stroke="#e9eef7" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" /></svg>;
}
