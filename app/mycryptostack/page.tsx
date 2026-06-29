'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Layers, Bitcoin, Info, TrendingUp, TrendingDown, Minus, Quote } from 'lucide-react';
import StackSidebar, { type MarketState } from '@/components/stack/StackSidebar';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { usePaperStore } from '@/lib/paperStore';
import { computeAlignmentMatrix, type Verdict } from '@/lib/alignment';
import { computeStackScore } from '@/lib/stackScore';
import { computeAtr } from '@/lib/indicators/atr';
import { analyzeTrade } from '@/lib/tradeAnalysis';
import { usd, formatNumber, formatPercent } from '@/lib/format';
import { Panel } from '@/components/ui';

const TF_LABEL: Record<Timeframe, string> = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// Numbers route through the MDS B5 contract (lib/format). Prices keep their
// 1-decimal exchange tick; money values keep cents via usd().
const fmt = (n: number, d = 1) => formatNumber(n, { precision: d });

const vColor = (v: Verdict) => (v === 'bullish' ? 'text-bull-bright' : v === 'bearish' ? 'text-bear-bright' : 'text-ink-faint');
const vDot = (v: Verdict) => (v === 'bullish' ? 'bg-bull' : v === 'bearish' ? 'bg-bear' : 'bg-neutral');
const vTint = (v: Verdict) => (v === 'bullish' ? 'bg-bull/[0.05]' : v === 'bearish' ? 'bg-bear/[0.05]' : '');
const Cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function VerdictGlyph({ v }: { v: Verdict }) {
  if (v === 'bullish') return <TrendingUp className="h-3 w-3" />;
  if (v === 'bearish') return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

function lastFinite(data: readonly unknown[] | null | undefined): number | null {
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    if (d == null) continue;
    if (typeof d === 'number') {
      if (Number.isFinite(d)) return d;
      continue;
    }
    if (typeof d === 'object' && 'value' in d) {
      const v = (d as { value?: number }).value;
      if (v != null && Number.isFinite(v)) return v;
    }
  }
  return null;
}

export default function MyCryptoStackPage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const [setupTf, setSetupTf] = useState<Timeframe>('5m');

  const { candlesByTf, status, wsStatus } = useMarketData(symbol);
  const { prices, changes, snapshots } = useMoodEngine(candlesByTf, []);
  const paper = usePaperStore();

  const matrix = useMemo(() => computeAlignmentMatrix(candlesByTf, [...TIMEFRAMES]), [candlesByTf]);
  const stack = useMemo(() => computeStackScore(matrix, [...TIMEFRAMES]), [matrix]);

  const ready = TIMEFRAMES.some((tf) => (candlesByTf[tf]?.length ?? 0) > 0);
  const price = prices['5m'] ?? prices['1d'] ?? 0;
  const change = changes['1d'] ?? 0;

  // ---- Trade setup (derived from the selected TF's ATR + the stack direction) ----
  const setup = useMemo(() => {
    const candles = candlesByTf[setupTf] ?? [];
    const entry = candles.length ? candles[candles.length - 1].close : price;
    const atr = lastFinite(computeAtr(candles).plots[0]?.data) ?? entry * 0.004;
    const long = stack.direction !== 'sell';
    const sl = long ? entry - 1.5 * atr : entry + 1.5 * atr;
    const tp1 = long ? entry + 1.5 * atr : entry - 1.5 * atr;
    const tp2 = long ? entry + 3 * atr : entry - 3 * atr;
    const a = analyzeTrade({
      balance: paper.balance, riskPct: 1, entry, stopLoss: sl, takeProfit: tp2,
      leverage: 10, side: long ? 'long' : 'short',
    });
    const zone = entry * 0.0006;
    const winProb = clamp(Math.round(50 + (stack.score - 50) * 0.6), 25, 92);
    return { entry, atr, long, sl, tp1, tp2, a, zoneLo: entry - zone, zoneHi: entry + zone, winProb };
  }, [candlesByTf, setupTf, price, stack.direction, stack.score, paper.balance]);

  // ---- Market regime (Phase 9, lightweight) ----
  const regime: MarketState = useMemo(() => {
    const adxDir = Math.abs(stack.components.adx - 50) * 2; // 0–100 trend strength
    const state = adxDir > 50 ? 'Trending' : adxDir > 25 ? 'Transitional' : 'Ranging';
    const hot = TIMEFRAMES.map((tf) => snapshots[tf]?.regime?.label).filter(Boolean);
    const volatility = hot.includes('hot') ? 'High' : hot.includes('calm') ? 'Low' : 'Medium';
    const volume = stack.components.volume > 60 ? 'High' : stack.components.volume > 45 ? 'Medium' : 'Low';
    const energy = volatility === 'High' && volume === 'High' ? 'High' : stack.score < 35 || stack.score > 65 ? 'Medium' : 'Low';
    return { state, volatility, volume, energy };
  }, [stack, snapshots]);

  // ---- Performance (live paper account) ----
  const perf = useMemo(() => {
    const t = paper.trades;
    const wins = t.filter((x) => x.realizedPnl > 0);
    const losses = t.filter((x) => x.realizedPnl < 0);
    const net = t.reduce((s, x) => s + x.realizedPnl, 0);
    const avgWin = wins.length ? wins.reduce((s, x) => s + x.realizedPnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, x) => s + x.realizedPnl, 0) / losses.length : 0;
    return {
      total: t.length, wins: wins.length, losses: losses.length,
      winRate: t.length ? Math.round((wins.length / t.length) * 100) : 0,
      net, avgWin, avgLoss,
    };
  }, [paper.trades]);

  // ---- Signal history (session log, sampled) ----
  const [history, setHistory] = useState<{ time: string; verdicts: Verdict[]; score: number; rec: string }[]>([]);
  const lastLog = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const now = Date.now();
    if (now - lastLog.current < 30_000 && history.length > 0) return;
    lastLog.current = now;
    const row = {
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      verdicts: TIMEFRAMES.map((tf) => matrix.tfVerdict[tf] ?? 'neutral'),
      score: stack.score,
      rec: stack.recommendation,
    };
    setHistory((h) => [row, ...h].slice(0, 6));
  }, [ready, stack.score, stack.recommendation, matrix]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-[100dvh] w-full bg-base text-ink">
      <StackSidebar marketState={regime} fearGreed={stack.score} />

      {/* ===== MAIN ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
          <div className="flex items-center gap-2 lg:hidden">
            <Layers className="h-5 w-5 text-accent" />
            <span className="font-bold">MyCryptoStack</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-1.5">
            <Bitcoin className="h-4 w-4 text-regime-hot" />
            <span className="font-semibold">{symbol}</span>
          </div>
          <span className="font-mono text-lg font-semibold tabular-nums">{fmt(price)}</span>
          <span className={['font-mono text-sm tabular-nums', change >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>
            {formatPercent(change)}
          </span>
          <div className="ml-2 flex items-center gap-1 rounded-lg border border-line bg-base p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button key={tf} onClick={() => setSetupTf(tf)}
                className={['rounded px-2.5 py-1 text-xs font-medium transition', setupTf === tf ? 'bg-accent/20 text-accent' : 'text-ink-muted hover:text-ink'].join(' ')}>
                {TF_LABEL[tf]}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1.5">
              <span className={['h-2 w-2 rounded-full', wsStatus === 'open' ? 'bg-bull' : 'bg-regime-hot'].join(' ')} />
              {status === 'live' ? 'Live' : status}
            </span>
            <Link href="/app" className="rounded-md border border-line px-2 py-1 transition hover:text-ink">Chart →</Link>
          </div>
        </header>

        {!ready ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading multi-timeframe market data…</div>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[1.6fr_1fr]">
            {/* ===== CENTER COLUMN ===== */}
            <div className="space-y-3">
              {/* Alignment table */}
              <Panel eyebrow title="Multi-Timeframe Indicator Alignment">
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-0 text-left text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider">
                        <th className="border-b border-line px-3 pb-2 text-left font-medium text-ink-faint">Indicator</th>
                        {TIMEFRAMES.map((tf) => {
                          const v = matrix.tfVerdict[tf] ?? 'neutral';
                          return (
                            <th key={tf} className="border-b border-line px-2 pb-2 text-center font-medium">
                              <div className="text-[13px] font-semibold normal-case text-ink">{TF_LABEL[tf]}</div>
                              <div className={['inline-flex items-center gap-0.5 text-[10px]', vColor(v)].join(' ')}><VerdictGlyph v={v} />{Cap(v)}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.rows.map((row) => (
                        <tr key={row.key} className="group">
                          <td className="border-b border-line/50 px-3 py-2 transition-colors group-hover:bg-surface-2/30">
                            <div className="font-medium text-ink">{row.label}</div>
                            <div className="text-[10px] text-ink-faint">{row.sub}</div>
                          </td>
                          {TIMEFRAMES.map((tf) => {
                            const cell = row.cells[tf];
                            return (
                              <td key={tf} className={['border-b border-line/50 px-2 py-2 text-center font-mono text-[13px] tabular-nums transition-colors group-hover:brightness-110', cell ? vColor(cell.verdict) : 'text-ink-faint', cell ? vTint(cell.verdict) : ''].join(' ')}>
                                {cell
                                  ? row.kind === 'label'
                                    ? <span className="inline-flex items-center gap-1"><VerdictGlyph v={cell.verdict} />{cell.display}</span>
                                    : cell.display
                                  : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr>
                        <td className="bg-surface-2/50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-accent">Timeframe Score</td>
                        {TIMEFRAMES.map((tf) => {
                          const sc = matrix.tfScore[tf];
                          const tone = sc == null ? 'text-ink-faint' : sc >= 60 ? 'text-bull-bright' : sc <= 40 ? 'text-bear-bright' : 'text-ink';
                          return (
                            <td key={tf} className={['bg-surface-2/50 px-2 py-2.5 text-center font-mono text-xl font-bold tabular-nums', tone].join(' ')}>{sc ?? '—'}</td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Panel>

              {/* Summary / score / recommendation */}
              <Panel>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_1fr] sm:divide-x sm:divide-line">
                  <div className="flex flex-col items-center gap-1 px-4 py-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Alignment</div>
                    <Donut value={(Math.max(stack.bullCount, stack.bearCount) / Math.max(1, stack.totalTf)) * 100} color={stack.bullCount >= stack.bearCount ? '#26A69A' : '#f23645'}
                      center={<div className="text-center"><div className="text-xl font-bold">{stack.bullCount}/{stack.totalTf}</div><div className={['text-[9px] font-semibold tracking-wide', stack.bullCount >= stack.bearCount ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{stack.bullCount >= stack.bearCount ? 'BULLISH' : 'BEARISH'}</div></div>} />
                  </div>
                  <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Stack Score</div>
                    <div className={['font-mono text-6xl font-bold leading-none tracking-tight', stack.direction === 'buy' ? 'text-bull-bright' : stack.direction === 'sell' ? 'text-bear-bright' : 'text-ink'].join(' ')}>
                      {stack.score}<span className="align-top text-lg text-ink-faint">/100</span>
                    </div>
                    <div className="text-base tracking-[0.2em] text-accent">{'★'.repeat(stack.stars)}<span className="text-line-strong">{'★'.repeat(5 - stack.stars)}</span></div>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-1 px-4 py-1 text-center">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Recommendation</div>
                    <div className={['text-2xl font-extrabold tracking-tight', stack.direction === 'buy' ? 'text-bull-bright' : stack.direction === 'sell' ? 'text-bear-bright' : 'text-ink'].join(' ')}>
                      {stack.recommendation}
                    </div>
                    <div className="text-[11px] text-ink-faint">{stack.score >= 80 || stack.score <= 20 ? 'High-probability setup' : 'Confirm before entry'}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-7 gap-y-1 border-t border-line pt-3 text-xs">
                  <Stat k="Trend" v={String(Math.round(stack.components.trend))} />
                  <Stat k="Momentum" v={String(Math.round(stack.components.momentum))} />
                  <Stat k="Volume" v={String(Math.round(stack.components.volume))} />
                  <Stat k="ADX" v={String(Math.round(stack.components.adx))} />
                  <Stat k="Regime" v={regime.state} />
                </div>
              </Panel>

              {/* Signal history + Best setups */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Panel eyebrow title="Signal History">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-ink-faint">
                      <tr><th className="py-1">Time</th>{TIMEFRAMES.map((tf) => <th key={tf} className="py-1 text-center">{TF_LABEL[tf]}</th>)}<th className="py-1 text-right">Score</th><th className="py-1 text-right">Signal</th></tr>
                    </thead>
                    <tbody>
                      {history.length === 0 ? (
                        <tr><td colSpan={9} className="py-3 text-center text-ink-faint">Sampling…</td></tr>
                      ) : history.map((h, i) => (
                        <tr key={i} className="border-t border-line/50">
                          <td className="py-1.5 font-mono text-ink-faint">{h.time}</td>
                          {h.verdicts.map((v, j) => <td key={j} className="py-1.5 text-center"><span className={['mx-auto inline-block h-2 w-2 rounded-full', vDot(v)].join(' ')} /></td>)}
                          <td className="py-1.5 text-right font-mono font-semibold">{h.score}</td>
                          <td className={['py-1.5 text-right font-semibold', h.rec.includes('BUY') ? 'text-bull-bright' : h.rec.includes('SELL') ? 'text-bear-bright' : 'text-ink-faint'].join(' ')}>{h.rec}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>

                <Panel eyebrow title="Best Setups Today" badge="live · scanner next">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Pair</th><th className="py-1 text-right">Score</th><th className="py-1 text-right">Signal</th><th className="py-1 text-right">TF</th></tr></thead>
                    <tbody>
                      <tr className="border-t border-line/50">
                        <td className="py-1.5 font-medium">{symbol}</td>
                        <td className="py-1.5 text-right font-mono font-semibold">{stack.score}</td>
                        <td className={['py-1.5 text-right font-semibold', stack.direction === 'buy' ? 'text-bull-bright' : stack.direction === 'sell' ? 'text-bear-bright' : 'text-ink-faint'].join(' ')}>{stack.recommendation}</td>
                        <td className="py-1.5 text-right text-ink-faint">{TF_LABEL[setupTf]}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-2 text-[10px] text-ink-faint">Scanner across BTC/ETH/SOL/BNB/LINK/DOGE/ADA is the next engine to wire.</p>
                </Panel>
              </div>
            </div>

            {/* ===== RIGHT COLUMN ===== */}
            <div className="space-y-3">
              {/* Signal strength meter */}
              <Panel eyebrow title="Signal Strength Meter">
                <div className="flex items-center gap-4">
                  <BigGauge value={stack.score} />
                  <ul className="space-y-1 text-[11px]">
                    {[['80-100', 'Elite', '#26A69A'], ['60-80', 'Strong', '#9acd32'], ['40-60', 'Moderate', '#f0a020'], ['20-40', 'Weak', '#f2683c'], ['0-20', 'Avoid', '#f23645']].map(([r, l, c]) => (
                      <li key={r} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} /><span className="font-mono text-ink-faint">{r}</span><span className="text-ink-muted">{l}</span></li>
                    ))}
                  </ul>
                </div>
              </Panel>

              {/* Trade setup */}
              <Panel eyebrow title="Trade Setup" badge={setup.long ? 'LONG' : 'SHORT'}>
                <div className="space-y-1.5 text-sm">
                  <Row k="Entry Zone" v={`${fmt(setup.zoneLo)} – ${fmt(setup.zoneHi)}`} />
                  <Row k="Stop Loss" v={fmt(setup.sl)} tone="bear" />
                  <Row k="Take Profit 1" v={fmt(setup.tp1)} tone="bull" />
                  <Row k="Take Profit 2" v={fmt(setup.tp2)} tone="bull" />
                  <div className="my-1 h-px bg-line" />
                  <Row k="Risk / Reward" v={setup.a.rr == null ? '—' : `1 : ${formatNumber(setup.a.rr, { precision: 1 })}`} tone={setup.a.rr != null && setup.a.rr >= 2 ? 'bull' : undefined} />
                  <Row k="Win Probability" v={`${setup.winProb}%`} />
                  <Row k="Position Size (1% risk)" v={`${setup.a.positionSize > 0 ? fmt(setup.a.positionSize, 3) : '—'} BTC`} />
                </div>
                <Link href="/mystack" className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg bg-accent/15 py-2 text-sm font-medium text-accent transition hover:bg-accent/25">
                  Open in MyStack calculator →
                </Link>
              </Panel>

              {/* Alignment breakdown */}
              <Panel eyebrow title="Alignment Breakdown" badge="exit rule">
                <ul className="space-y-1.5 text-xs">
                  {[['6 Green', 'Maximum holding (trend strong)', 'text-bull-bright'], ['5 Green', 'Hold position', 'text-bull-bright'], ['4 Green', 'Caution (watch closely)', 'text-regime-hot'], ['3 Green', 'Reduce position (take partial)', 'text-regime-hot'], ['2 or less', 'Exit position', 'text-bear-bright']].map(([n, d, c]) => (
                    <li key={n} className="flex items-center gap-2">
                      <span className={['w-16 shrink-0 font-semibold', c].join(' ')}>{n}</span>
                      <span className="text-ink-muted">{d}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 rounded-md bg-surface-2/40 px-2 py-1.5 text-[11px] text-ink-muted">
                  Currently <span className="font-semibold text-bull-bright">{stack.bullCount} green</span> of {stack.totalTf} timeframes.
                </div>
              </Panel>

              {/* Performance */}
              <Panel eyebrow title="Performance" badge="paper account">
                <div className="flex items-center gap-4">
                  <Donut value={perf.winRate} color={perf.winRate >= 50 ? '#26A69A' : perf.winRate >= 40 ? '#f0a020' : '#f23645'} center={<div className="text-center"><div className="text-lg font-bold">{perf.winRate}%</div><div className="text-[9px] text-ink-faint">Win Rate</div></div>} />
                  <div className="flex-1 space-y-1 text-xs">
                    <Row k="Total Trades" v={String(perf.total)} />
                    <Row k="Winning / Losing" v={`${perf.wins} / ${perf.losses}`} />
                    <Row k="Net P&L" v={usd(perf.net, { signed: true })} tone={perf.net >= 0 ? 'bull' : 'bear'} />
                    <Row k="Avg Win / Loss" v={`${usd(perf.avgWin)} / ${usd(perf.avgLoss)}`} />
                  </div>
                </div>
                {perf.total === 0 && <p className="mt-2 text-[10px] text-ink-faint">No paper trades yet. Place one from MyStack or the chart.</p>}
              </Panel>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-2"><Quote className="h-3.5 w-3.5 text-accent/70" /> <span className="italic">“The key is not to predict the future, but to prepare for it.”</span> <span className="text-ink-muted">Peter Lynch</span></span>
          <span className="inline-flex items-center gap-1.5"><Info className="h-3 w-3" /> Educational · paper. Live Binance data.</span>
        </footer>
      </div>
    </div>
  );
}

// ---- presentational helpers (Panel now from @/components/ui, MDS Phase C) ----
function Stat({ k, v }: { k: string; v: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="text-ink-faint">{k}:</span><span className="font-semibold text-ink">{v}</span></span>;
}
function Row({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return <div className="flex items-center justify-between"><span className="text-ink-faint">{k}</span><span className={['font-mono tabular-nums', c].join(' ')}>{v}</span></div>;
}

function Donut({ value, color, center }: { value: number; color: string; center: React.ReactNode }) {
  const r = 30, c = 2 * Math.PI * r, dash = (clamp(value, 0, 100) / 100) * c;
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#2a3247" strokeWidth="7" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{center}</div>
    </div>
  );
}
function BigGauge({ value }: { value: number }) {
  const v = clamp(value, 0, 100);
  const angle = -90 + (v / 100) * 180;
  const label = v >= 80 ? 'Elite Setup' : v >= 60 ? 'Strong Signal' : v >= 40 ? 'Moderate' : v >= 20 ? 'Weak' : 'Avoid';
  const color = v >= 80 ? '#26A69A' : v >= 60 ? '#9acd32' : v >= 40 ? '#f0a020' : v >= 20 ? '#f2683c' : '#f23645';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-40">
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke="#2a3247" strokeWidth="16" strokeLinecap="round" />
        <path d="M15 105 A 85 85 0 0 1 100 20" fill="none" stroke="#f23645" strokeWidth="16" strokeLinecap="round" />
        <path d="M100 20 A 85 85 0 0 1 150 33" fill="none" stroke="#f0a020" strokeWidth="16" />
        <path d="M150 33 A 85 85 0 0 1 185 105" fill="none" stroke="#26A69A" strokeWidth="16" strokeLinecap="round" />
        <g transform={`rotate(${angle} 100 105)`}><line x1="100" y1="105" x2="100" y2="38" stroke="#e9eef7" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="105" r="6" fill="#e9eef7" /></g>
      </svg>
      <div className="-mt-3 font-mono text-3xl font-bold" style={{ color }}>{v}%</div>
      <div className="text-sm font-semibold" style={{ color }}>{label}</div>
    </div>
  );
}
