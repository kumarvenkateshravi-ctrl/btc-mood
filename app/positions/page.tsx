'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bitcoin, ChevronDown, Bell, Info, RefreshCw, Search, SlidersHorizontal, MoreHorizontal,
  ArrowUp, ArrowDown, Minus, ArrowRight, Check, X, Sparkles, Circle, CheckCircle2,
  AlertTriangle, TrendingUp, Bot, type LucideIcon,
} from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import {
  buildPortfolio, scenarios, riskReport, CORRELATION, CORR_ASSETS,
  type Position, type Arrow,
} from '@/lib/positionsEngine';
import StackSidebar from '@/components/stack/StackSidebar';

const TF_LABEL: Record<Timeframe, string> = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtN = (n: number, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (n: number) => (n >= 0 ? '+' : '');
const money = (n: number) => `${sgn(n)}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (n: number) => (n >= 0 ? 'text-bull-bright' : 'text-bear-bright');
const ALLOC = [{ k: 'BTC', v: 40, c: '#f7931a' }, { k: 'ETH', v: 25, c: '#6aa6ff' }, { k: 'SOL', v: 15, c: '#26A69A' }, { k: 'BNB', v: 10, c: '#f0a020' }, { k: 'Others', v: 10, c: '#8b93a7' }];

// Representative portfolio snapshot (matches the design). Live BTC ticker shown in the header.
const SNAP = {
  portfolioValue: 28430.75, todayPnl: 741.65, todayPnlPct: 2.68, openPnl: 1234.56, openPnlPct: 4.58,
  marginUsed: 8156.20, marginUsedPct: 28.69, freeMargin: 21016.20, freeMarginPct: 71.31,
  longExposurePct: 68.4, shortExposurePct: 31.6, equity: 29172.40, marginLevel: 358.35,
};

export default function PositionsPage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const { candlesByTf, status } = useMarketData(symbol);
  const { prices, changes } = useMoodEngine(candlesByTf, []);
  const price = prices['5m'] ?? prices['1d'] ?? 0;
  const change = changes['1d'] ?? 0;
  const [clock, setClock] = useState('--:--:--');
  useEffect(() => { const t = () => setClock(new Date().toLocaleTimeString('en-US')); t(); const id = setInterval(t, 1000); return () => clearInterval(id); }, []);

  const pf = useMemo(() => buildPortfolio(SNAP.portfolioValue, SNAP.todayPnl), []);
  const scen = useMemo(() => scenarios(pf), [pf]);
  const risk = useMemo(() => riskReport(pf), [pf]);
  const positions = pf.positions;
  const selected = positions[0];

  const sidebarExtra = (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Account Summary</div>
      <SRow k="Account Balance" v={`$${fmtN(SNAP.portfolioValue, 2)}`} />
      <SRow k="Equity" v={`$${fmtN(SNAP.equity, 2)}`} />
      <SRow k="Unrealized P&L" v={money(SNAP.todayPnl)} c="text-bull-bright" />
      <SRow k="Margin Used" v={`$${fmtN(SNAP.marginUsed, 2)}`} />
      <SRow k="Free Margin" v={`$${fmtN(SNAP.freeMargin, 2)}`} />
      <SRow k="Margin Level" v={`${fmtN(SNAP.marginLevel, 2)}%`} c="text-bull-bright" />

      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Portfolio Allocation</div>
      <div className="flex items-center gap-3">
        <AllocDonut />
        <ul className="flex-1 space-y-1 text-[11px]">
          {ALLOC.map((a) => <li key={a.k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: a.c }} /><span className="flex-1 text-ink-muted">{a.k}</span><span className="font-mono text-ink-faint">{a.v}.0%</span></li>)}
        </ul>
      </div>
      <div className="mt-3 text-center"><FootLink>View Full Allocation</FootLink></div>
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
            <button className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20"><RefreshCw className="h-3.5 w-3.5" /> Sync All</button>
            <div className="relative"><Bell className="h-4 w-4 text-ink-muted" /><span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bear text-[8px] font-bold text-white">3</span></div>
            <div className="flex items-center gap-2"><div className="h-7 w-7 rounded-full bg-gradient-to-br from-accent to-regime-hot" /><div className="hidden leading-tight sm:block"><div className="text-xs font-semibold">John Doe</div><div className="text-[10px] text-ink-faint">Pro Trader</div></div><ChevronDown className="h-3.5 w-3.5 text-ink-faint" /></div>
          </div>
        </header>

        {/* Title */}
        <div className="flex items-center gap-2 px-3 pt-3">
          <h1 className="text-xl font-bold tracking-tight text-ink">Positions</h1>
          <span className="text-xs text-ink-faint">Live Position Intelligence Center™</span>
          <span className="rounded border border-regime-hot/40 bg-regime-hot/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-regime-hot" title="Representative portfolio. Live multi-symbol position feeds arrive with broker integration.">Representative</span>
        </div>

        <div className="flex min-w-0 flex-1 gap-3 overflow-auto p-3">
          {/* LEFT MAIN */}
          <div className="min-w-0 flex-1 space-y-3">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <SumCard k="Portfolio Value" v={`$${fmtN(SNAP.portfolioValue, 2)}`} sub={`${sgn(SNAP.todayPnlPct)}${SNAP.todayPnlPct}%`} subPos spark="#6aa6ff" />
              <SumCard k="Today's P&L" v={money(SNAP.todayPnl)} sub={`${sgn(SNAP.todayPnlPct)}${SNAP.todayPnlPct}%`} subPos valTone="bull" spark="#26A69A" />
              <SumCard k="Open P&L" v={money(SNAP.openPnl)} sub={`${sgn(SNAP.openPnlPct)}${SNAP.openPnlPct}%`} subPos valTone="bull" spark="#26A69A" />
              <SumCard k="Open Positions" v={String(positions.length)} sub="Active" />
              <SumCard k="Margin Used" v={`$${fmtN(SNAP.marginUsed, 2)}`} sub={`${SNAP.marginUsedPct}%`} bar={SNAP.marginUsedPct} barColor="#6aa6ff" />
              <SumCard k="Free Margin" v={`$${fmtN(SNAP.freeMargin, 2)}`} sub={`${SNAP.freeMarginPct}%`} subPos bar={SNAP.freeMarginPct} barColor="#26A69A" />
              <SumCard k="Long Exposure" v={`${SNAP.longExposurePct}%`} half={SNAP.longExposurePct} halfColor="#26A69A" />
              <SumCard k="Short Exposure" v={`${SNAP.shortExposurePct}%`} half={SNAP.shortExposurePct} halfColor="#f23645" />
            </div>

            {/* Open positions | MTF monitor */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.7fr_1fr]">
              <Panel title="Open Positions" count={positions.length} action={<><Pill><Search className="h-3 w-3" /> Search</Pill><Pill><SlidersHorizontal className="h-3 w-3" /> Filters</Pill><MoreHorizontal className="h-4 w-4 text-ink-faint" /></>}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[11px]">
                    <thead className="text-[9px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1 font-medium">Symbol</th><th className="py-1 font-medium">Direction</th><th className="py-1 text-right font-medium">Entry Price</th><th className="py-1 text-right font-medium">Current Price</th><th className="py-1 text-right font-medium">Unrealized P&amp;L</th><th className="py-1 text-right font-medium">P&amp;L %</th><th className="py-1 text-right font-medium">R:R</th><th className="py-1 text-right font-medium">Leverage</th><th className="py-1 text-right font-medium">Holding</th><th className="py-1 text-center font-medium">Health</th><th className="py-1 text-center font-medium">Action</th></tr></thead>
                    <tbody>
                      {positions.map((p) => <PositionRow key={p.symbol} p={p} />)}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Live Multi-Timeframe Monitor" info footer={<FootLink>View Full MTF Analysis</FootLink>}>
                <table className="w-full text-left text-[11px]">
                  <thead className="text-[9px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1 font-medium">Symbol</th>{(['5m', '15m', '30m', '1H', '4H', '1D'] as const).map((t) => <th key={t} className="py-1 text-center font-medium">{t}</th>)}<th className="py-1 text-right font-medium">Alignment</th></tr></thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.symbol} className="border-t border-line/50">
                        <td className="py-1.5 font-medium">{p.symbol}</td>
                        {p.mtf.map((d, i) => <td key={i} className="py-1.5 text-center"><ArrowCell d={d} /></td>)}
                        <td className={['py-1.5 text-right font-mono font-semibold', p.alignment >= 5 ? 'text-bull-bright' : p.alignment >= 4 ? 'text-regime-hot' : 'text-ink-muted'].join(' ')}>{p.alignment}/6</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>

            {/* Lifecycle | Stop | TP | Timeline */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
              <Panel title="Trade Lifecycle" sym="BTCUSDT" footer={<FootLink>Manage Exits</FootLink>}>
                <Lifecycle />
                <div className="mt-3 rounded-lg border border-bull/30 bg-bull/[0.06] p-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-bull-bright"><CheckCircle2 className="h-3.5 w-3.5" /> TP1 Reached</div>
                  <div className="mt-0.5 text-[10px] text-ink-muted">30% Position Closed · <span className="font-mono text-bull-bright">+$231.15</span></div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <Mini k="Next Target (TP2)" v="64,200.0" sub="Probability 62%" />
                  <Mini k="Runner Target" v="65,800.0+" sub="Probability 38%" />
                </div>
              </Panel>

              <Panel title="Stop Loss Manager" sym="BTCUSDT" info footer={<FootLink>Stop Loss Settings</FootLink>}>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <Mini k="Current SL" v="61,200.0" />
                  <Mini k="Distance" v="1.92%" />
                </div>
                <div className="mt-2 rounded-lg border border-bull/30 bg-bull/[0.06] p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-ink-faint">Recommended Action</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-bull-bright"><TrendingUp className="h-4 w-4" /> Move SL to Break Even</div>
                  <div className="mt-1 text-[10px] text-ink-muted">Reason: Price secured above key structure with strong volume.</div>
                  <button className="focus-ring mt-2 w-full rounded-md bg-bull/20 py-1.5 text-[11px] font-semibold text-bull-bright transition hover:bg-bull/30">Move to BE</button>
                </div>
                <div className="mt-2 text-[9px] uppercase tracking-wider text-ink-faint">Advanced Trailing Options</div>
                <div className="mt-1 grid grid-cols-4 gap-1">{['ATR (14)', 'EMA 20', 'Swing Low', 'Custom'].map((o) => <span key={o} className="rounded border border-line bg-base px-1 py-1 text-center text-[9px] text-ink-muted">{o}</span>)}</div>
              </Panel>

              <Panel title="Take Profit Manager" sym="BTCUSDT" info footer={<FootLink>Edit Targets</FootLink>}>
                <ul className="space-y-2">
                  <TpRow tp="TP1" price="63,000.0" status="Reached · 30% Closed" badge={<Check className="h-3.5 w-3.5 text-bull-bright" />} reached />
                  <TpRow tp="TP2" price="64,200.0" status="62% Prob." badge={<span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold text-accent">Next</span>} />
                  <TpRow tp="TP3 (Runner)" price="65,800.0+" status="38% Prob." badge={<span className="rounded border border-regime-hot/40 px-1.5 py-0.5 text-[9px] font-semibold text-regime-hot">Open</span>} />
                </ul>
                <button className="focus-ring mt-3 w-full rounded-lg bg-accent py-2 text-xs font-semibold text-white transition hover:opacity-90">Close Partial (30%)</button>
              </Panel>

              <Panel title="Position Timeline" sym="BTCUSDT" info footer={<FootLink>View Full Timeline</FootLink>}>
                <ul className="space-y-2.5">
                  {[['08:15 AM', 'Position Planned', false], ['08:47 AM', 'Position Entered @ 62,350.0', false], ['10:32 AM', 'Price moved to 63,000.0 (TP1 Hit)', true], ['10:33 AM', '30% position closed (+$231.15)', true], ['10:45 AM', 'SL moved to Break Even', false], ['12:20 PM', 'High volume breakout', false], ['12:48 PM', 'Currently Holding', false]].map(([t, e, hot], i) => (
                    <li key={i} className="flex gap-2.5 text-[11px]">
                      <span className="relative flex flex-col items-center"><span className={['mt-0.5 h-2 w-2 rounded-full', hot ? 'bg-bull' : 'bg-accent'].join(' ')} />{i < 6 && <span className="mt-0.5 w-px flex-1 bg-line" />}</span>
                      <div className="-mt-0.5"><span className="font-mono text-[10px] text-ink-faint">{t}</span><div className={['leading-tight', hot ? 'text-bull-bright' : 'text-ink-muted'].join(' ')}>{e}</div></div>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            {/* Correlation | Analytics | Margin */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <Panel title="Correlation Analysis" footer={<FootLink>View Full Analysis</FootLink>}>
                <table className="w-full text-center text-[10px]">
                  <thead className="text-[9px] text-ink-faint"><tr><th className="py-1" />{CORR_ASSETS.map((a) => <th key={a} className="py-1 font-medium">{a}</th>)}</tr></thead>
                  <tbody>
                    {CORRELATION.map((row, i) => (
                      <tr key={i}><td className="py-1 pr-1 text-left font-medium text-ink-faint">{CORR_ASSETS[i]}</td>{row.map((v, j) => <td key={j} className="px-0.5 py-0.5"><span className="block rounded py-1 font-mono" style={corrStyle(v, i === j)}>{v.toFixed(2)}</span></td>)}</tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-regime-hot"><AlertTriangle className="h-3 w-3" /> High Correlation Detected: BTC, ETH, SOL</div>
              </Panel>

              <Panel title="Position Analytics" action={<Pill>This Month <ChevronDown className="h-3 w-3" /></Pill>} footer={<FootLink>View Full Analytics</FootLink>}>
                <div className="grid grid-cols-3 gap-2">
                  <Mini k="Avg. Hold Time" v="7h 32m" />
                  <Mini k="Avg. Profit" v="+2.38%" c="text-bull-bright" />
                  <Mini k="Avg. Loss" v="-1.25%" c="text-bear-bright" />
                  <Mini k="Win Rate" v="71.3%" />
                  <Mini k="Profit Factor" v="2.42" />
                  <Mini k="Expectancy" v="+1.68R" c="text-bull-bright" />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Mini k="Best Holding" v="4 - 8 Hours" small />
                  <Mini k="Best Exit Timing" v="TP1 then Trail" small />
                  <Mini k="Trailing Success" v="78.6%" small c="text-bull-bright" />
                </div>
              </Panel>

              <Panel title="Margin & Exposure" footer={<FootLink>View Margin Details</FootLink>}>
                <div className="flex items-center gap-4">
                  <HalfGauge value={SNAP.marginUsedPct} label="Margin Used" />
                  <ul className="flex-1 space-y-1.5 text-[11px]">
                    <KVRow k="Used Margin" v={`$${fmtN(SNAP.marginUsed, 2)}`} />
                    <KVRow k="Free Margin" v={`$${fmtN(SNAP.freeMargin, 2)}`} />
                    <KVRow k="Margin Level" v={`${SNAP.marginLevel}%`} />
                    <KVRow k="Liquidation Risk" v="Low" c="text-bull-bright" />
                    <KVRow k="Funding Cost (Daily)" v="-$12.35" c="text-bear-bright" />
                  </ul>
                </div>
              </Panel>
            </div>
          </div>

          {/* RIGHT RAIL */}
          <aside className="hidden w-[300px] shrink-0 space-y-3 xl:block">
            <Panel title="AI Position Coach" badge="Beta" icon={Bot} footer={<button className="focus-ring inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20"><Sparkles className="h-3.5 w-3.5" /> Ask AI Coach</button>}>
              <ul className="space-y-2.5 text-[11px]">
                {[
                  ['BTCUSDT:', ' Strong uptrend across 4/6 timeframes.'],
                  ['', 'Holding is justified. Consider moving SL to Break Even after TP1.'],
                  ['ETHUSDT:', ' Momentum strong. Hold with confidence.'],
                  ['SOLUSDT:', ' 1H strength weakening. Watch closely for trend change.'],
                  ['XRPUSDT:', ' Short setup healthy. Target 0.5080 next.'],
                ].map(([h, t], i) => <li key={i} className="flex items-start gap-2 text-ink-muted"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent" /><span>{h && <span className="font-semibold text-ink">{h}</span>}{t}</span></li>)}
              </ul>
            </Panel>

            <Panel title="Portfolio Risk Dashboard" info footer={<FootLink>View Full Risk Report</FootLink>}>
              <KVRow k="Portfolio Risk" v={risk.level} c="text-regime-hot" />
              <KVRow k="Open Risk" v={`$${fmtN(risk.openRisk, 2)} (${risk.openRiskPct}%)`} />
              <KVRow k="Risk Concentration" v={risk.concentration} c="text-bear-bright" />
              <KVRow k="Max Drawdown (Open)" v={`${risk.maxDrawdownOpenPct}%`} c="text-bear-bright" />
              <KVRow k="Margin Level" v={`${SNAP.marginLevel}%`} c="text-bull-bright" />
            </Panel>

            <Panel title="Live Alerts" count={4} footer={<FootLink>View All Alerts</FootLink>}>
              <ul className="space-y-2 text-[11px]">
                {[['BTCUSDT', 'Volume spike detected', '12:47 PM', '#26A69A'], ['ETHUSDT', 'Approaching resistance zone', '12:46 PM', '#f0a020'], ['SOLUSDT', '1H momentum weakening', '12:45 PM', '#f0a020'], ['XRPUSDT', 'Trend alignment strong', '12:44 PM', '#26A69A']].map(([s, t, time, c]) => (
                  <li key={s} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between"><span className="font-semibold text-ink">{s}</span><span className="font-mono text-[9px] text-ink-faint">{time}</span></div><div className="text-[10px] text-ink-muted">{t}</div></div></li>
                ))}
              </ul>
            </Panel>

            <Panel title="Scenario Simulator" info footer={<FootLink>Open Simulator</FootLink>}>
              <button className="focus-ring mb-2 flex w-full items-center justify-between rounded-lg border border-line bg-base px-2.5 py-1.5 text-[11px] text-ink-faint">Select Scenario <ChevronDown className="h-3.5 w-3.5" /></button>
              <ul className="space-y-1.5 text-[11px]">
                {scen.map((s) => <li key={s.label} className="flex items-center justify-between rounded-md bg-base/60 px-2 py-1.5"><span className="text-ink-muted">{s.label}</span><span className={['font-mono font-semibold', tone(s.value)].join(' ')}>{money(s.value)}</span></li>)}
              </ul>
            </Panel>
          </aside>
        </div>

        {/* Footer */}
        <footer className="flex items-center gap-4 border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-2"><span className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5"><Circle className="h-2.5 w-2.5 fill-accent text-accent" /> Dark <ChevronDown className="h-3 w-3" /></span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bull" /> Binance Futures</span></span>
          <span className="mx-auto hidden italic md:block">“Discipline in managing positions is the bridge between a good setup and great results.” — MyCryptoStack</span>
          <span className="ml-auto">Last Update: {clock}</span>
        </footer>
      </div>
    </div>
  );
}

// ---- rows / cells ----
function PositionRow({ p }: { p: Position }) {
  const hCol = p.health >= 80 ? '#26A69A' : p.health >= 60 ? '#f0a020' : '#f23645';
  return (
    <tr className="border-t border-line/50 hover:bg-surface-2/30">
      <td className="py-2"><span className="inline-flex items-center gap-1.5 font-medium"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-[8px] font-bold text-ink-muted">{p.asset.slice(0, 1)}</span>{p.asset}USDT</span></td>
      <td className="py-2"><span className={['rounded px-1.5 py-0.5 text-[10px] font-semibold', p.direction === 'Long' ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright'].join(' ')}>{p.direction}</span></td>
      <td className="py-2 text-right font-mono text-ink-muted">{fmtN(p.entry, p.entry < 10 ? 4 : p.entry < 1000 ? 2 : 1)}</td>
      <td className="py-2 text-right font-mono">{fmtN(p.current, p.current < 10 ? 4 : p.current < 1000 ? 2 : 1)}</td>
      <td className={['py-2 text-right font-mono font-semibold', tone(p.unrealizedPnl)].join(' ')}>{money(p.unrealizedPnl)}</td>
      <td className={['py-2 text-right font-mono', tone(p.priceMovePct)].join(' ')}>{sgn(p.priceMovePct)}{p.priceMovePct}%</td>
      <td className="py-2 text-right font-mono">{p.rr}R</td>
      <td className="py-2 text-right text-ink-muted">{p.leverage}x</td>
      <td className="py-2 text-right text-ink-faint">{p.holdingMin >= 60 ? `${Math.floor(p.holdingMin / 60)}h ${String(p.holdingMin % 60).padStart(2, '0')}m` : `${p.holdingMin}m`}</td>
      <td className="py-2"><div className="flex justify-center"><span className="flex h-6 w-6 items-center justify-center rounded-full border-2 font-mono text-[10px] font-bold" style={{ borderColor: hCol, color: hCol }}>{p.health}</span></div></td>
      <td className="py-2"><div className="flex justify-center"><span className={['inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium', p.recommendation === 'Hold' ? 'border-bull/40 bg-bull/10 text-bull-bright' : p.recommendation === 'Watch' ? 'border-regime-hot/40 bg-regime-hot/10 text-regime-hot' : 'border-bear/40 bg-bear/10 text-bear-bright'].join(' ')}>{p.recommendation} <ChevronDown className="h-3 w-3" /></span></div></td>
    </tr>
  );
}
function ArrowCell({ d }: { d: Arrow }) {
  if (d === 'up') return <ArrowUp className="mx-auto h-3.5 w-3.5 text-bull-bright" />;
  if (d === 'down') return <ArrowDown className="mx-auto h-3.5 w-3.5 text-bear-bright" />;
  return <Minus className="mx-auto h-3.5 w-3.5 text-regime-hot" />;
}
function corrStyle(v: number, diag: boolean): React.CSSProperties {
  if (diag) return { background: '#2a3247', color: '#e9eef7' };
  if (v >= 0.85) return { background: 'rgba(242,54,69,0.22)', color: '#ff6b78' };
  if (v >= 0.65) return { background: 'rgba(240,160,32,0.18)', color: '#f0a020' };
  return { background: 'rgba(38,166,154,0.14)', color: '#26A69A' };
}

// ---- panels / atoms ----
function Panel({ title, sym, count, info, badge, icon: Icon, action, footer, children }: { title?: string; sym?: string; count?: number; info?: boolean; badge?: string; icon?: LucideIcon; action?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-3 transition-colors duration-300 hover:border-line/80">
      {title && (
        <div className="mb-2.5 flex items-center gap-2">
          {Icon && <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent"><Icon className="h-3.5 w-3.5" /></span>}
          <h3 className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">{title}{sym && <span className="font-normal text-ink-faint">({sym})</span>}{count != null && <span className="rounded bg-surface-3 px-1.5 text-[10px] text-ink-muted">{count}</span>}{info && <Info className="h-3 w-3 text-ink-faint" />}</h3>
          {badge && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">{badge}</span>}
          {action && <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-faint">{action}</span>}
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
function KVRow({ k, v, c }: { k: string; v: string; c?: string }) { return <div className="flex items-center justify-between py-1 text-[11px]"><span className="text-ink-faint">{k}</span><span className={['font-mono font-semibold', c ?? 'text-ink'].join(' ')}>{v}</span></div>; }
function Mini({ k, v, sub, c, small }: { k: string; v: string; sub?: string; c?: string; small?: boolean }) { return <div className="rounded-lg bg-base/70 px-2 py-1.5"><div className="text-[9px] uppercase tracking-wider text-ink-faint">{k}</div><div className={['font-mono font-semibold', small ? 'text-[11px]' : 'text-sm', c ?? 'text-ink'].join(' ')}>{v}</div>{sub && <div className="text-[9px] text-ink-faint">{sub}</div>}</div>; }
function TpRow({ tp, price, status, badge, reached }: { tp: string; price: string; status: string; badge: React.ReactNode; reached?: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-lg bg-base/60 px-2 py-1.5 text-[11px]">
      <span className={['font-semibold', reached ? 'text-bull-bright' : 'text-accent'].join(' ')}>{tp}</span>
      <span className="font-mono text-ink">{price}</span>
      <span className="ml-auto text-[10px] text-ink-faint">{status}</span>
      {badge}
    </li>
  );
}

function SumCard({ k, v, sub, subPos, valTone, spark, bar, barColor, half, halfColor }: { k: string; v: string; sub?: string; subPos?: boolean; valTone?: 'bull'; spark?: string; bar?: number; barColor?: string; half?: number; halfColor?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/50 p-3 transition-colors duration-300 hover:border-accent/30">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{k}</div>
      <div className="mt-1.5 flex items-start justify-between gap-1">
        <div className={['font-mono text-base font-bold leading-tight tracking-tight', valTone === 'bull' ? 'text-bull-bright' : 'text-ink'].join(' ')}>{v}</div>
        {half != null ? <HalfRing value={half} color={halfColor ?? '#26A69A'} /> : spark ? <MiniSpark color={spark} /> : null}
      </div>
      {sub && bar == null && <div className={['mt-1.5 text-[10px]', subPos ? 'text-bull-bright' : 'text-ink-faint'].join(' ')}>{sub}</div>}
      {bar != null && <div className="mt-2"><div className="mb-0.5 text-[10px] text-ink-faint">{sub}</div><div className="h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${clamp(bar, 0, 100)}%`, background: barColor }} /></div></div>}
    </div>
  );
}
function MiniSpark({ color }: { color: string }) {
  const pts = [10, 12, 9, 13, 11, 15, 14, 16, 15, 20];
  const W = 50, H = 22, max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1;
  const X = (i: number) => (i / (pts.length - 1)) * W, Y = (pt: number) => H - 2 - ((pt - min) / range) * (H - 4);
  const line = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(pt).toFixed(1)}`).join(' ');
  const id = `ps${color.replace('#', '')}`;
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-12 shrink-0"><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs><path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill={`url(#${id})`} /><path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function HalfRing({ value, color }: { value: number; color: string }) {
  const v = clamp(value, 0, 100);
  return (
    <svg viewBox="0 0 48 28" className="h-7 w-12 shrink-0">
      <path d="M5 26 A 19 19 0 0 1 43 26" fill="none" stroke="#2a3247" strokeWidth="5" strokeLinecap="round" />
      <path d="M5 26 A 19 19 0 0 1 43 26" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(v / 100) * 59.7} 200`} />
    </svg>
  );
}
function HalfGauge({ value, label }: { value: number; label: string }) {
  const v = clamp(value, 0, 100);
  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 120 70" className="w-28">
        <path d="M10 64 A 50 50 0 0 1 110 64" fill="none" stroke="#2a3247" strokeWidth="9" strokeLinecap="round" />
        <path d="M10 64 A 50 50 0 0 1 110 64" fill="none" stroke="#26A69A" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(v / 100) * 157} 300`} style={{ filter: 'drop-shadow(0 0 2px rgba(38,166,154,0.5))' }} />
      </svg>
      <div className="-mt-5 text-center"><div className="font-mono text-lg font-bold text-ink">{v}%</div><div className="text-[9px] text-ink-faint">{label}</div></div>
    </div>
  );
}
function Lifecycle() {
  const stages = ['Planned', 'Entered', 'BE', 'TP1', 'TP2', 'Runner', 'Closed'];
  const current = 3; // TP1
  return (
    <div className="flex items-center justify-between">
      {stages.map((s, i) => (
        <div key={s} className="flex flex-1 flex-col items-center">
          <div className="flex w-full items-center">
            {i > 0 && <span className={['h-px flex-1', i <= current ? 'bg-bull' : 'bg-line'].join(' ')} />}
            <span className={['flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px]', i < current ? 'bg-bull text-white' : i === current ? 'bg-accent text-white ring-2 ring-accent/30' : 'border border-line bg-surface-2 text-ink-faint'].join(' ')}>{i < current ? <Check className="h-3 w-3" /> : i === current ? <Circle className="h-2 w-2 fill-white" /> : <X className="h-2.5 w-2.5" />}</span>
            {i < stages.length - 1 && <span className={['h-px flex-1', i < current ? 'bg-bull' : 'bg-line'].join(' ')} />}
          </div>
          <span className={['mt-1 text-[8px]', i === current ? 'font-semibold text-accent' : 'text-ink-faint'].join(' ')}>{s}</span>
        </div>
      ))}
    </div>
  );
}
function AllocDonut() {
  const r = 22, c = 2 * Math.PI * r; let off = 0;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90 shrink-0">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#2a3247" strokeWidth="9" />
      {ALLOC.map((a) => { const dash = (a.v / 100) * c; const el = <circle key={a.k} cx="32" cy="32" r={r} fill="none" stroke={a.c} strokeWidth="9" strokeDasharray={`${dash} ${c}`} strokeDashoffset={-off} />; off += dash; return el; })}
    </svg>
  );
}
