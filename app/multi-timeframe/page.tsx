'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bitcoin, Info, TrendingUp, TrendingDown, Minus, Quote, ChevronRight } from 'lucide-react';
import { TIMEFRAMES, type Timeframe, type Candle } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { computeAlignmentMatrix, type Verdict } from '@/lib/alignment';
import {
  computeConsensus, computeWeightedScore, computeHeatmap, computeTimeframeDetails,
  detectStructure, buildSummary, TF_WEIGHT, type HeatmapRow,
} from '@/lib/multiTimeframe';
import StackSidebar, { type MarketState } from '@/components/stack/StackSidebar';

const TF_LABEL: Record<Timeframe, string> = { '5m': '5M', '15m': '15M', '30m': '30M', '1h': '1H', '4h': '4H', '1d': '1D' };
const fmt = (n: number | null | undefined, d = 1) => (n != null && Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const Cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const vColor = (v: Verdict) => (v === 'bullish' ? 'text-bull-bright' : v === 'bearish' ? 'text-bear-bright' : 'text-neutral');
const vTint = (v: Verdict) => (v === 'bullish' ? 'bg-bull/[0.05]' : v === 'bearish' ? 'bg-bear/[0.05]' : '');
const vHeat = (v: Verdict) => (v === 'bullish' ? 'bg-bull' : v === 'bearish' ? 'bg-bear' : 'bg-regime-hot/70');
function VGlyph({ v }: { v: Verdict }) { return v === 'bullish' ? <TrendingUp className="h-3 w-3" /> : v === 'bearish' ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />; }
function fmtDur(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return `${h}h ${mm}m`;
  return `${Math.floor(h / 24)}d`;
}

export default function MultiTimeframePage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const [structTf, setStructTf] = useState<Timeframe>('1h');

  const { candlesByTf, status } = useMarketData(symbol);
  const { prices, changes } = useMoodEngine(candlesByTf, []);

  const matrix = useMemo(() => computeAlignmentMatrix(candlesByTf, [...TIMEFRAMES]), [candlesByTf]);
  const consensus = useMemo(() => computeConsensus(matrix, [...TIMEFRAMES]), [matrix]);
  const weighted = useMemo(() => computeWeightedScore(matrix, [...TIMEFRAMES]), [matrix]);
  const heatmap = useMemo(() => computeHeatmap(matrix, candlesByTf, [...TIMEFRAMES]), [matrix, candlesByTf]);
  const summary = useMemo(() => buildSummary(matrix, weighted), [matrix, weighted]);
  const details = useMemo(() => computeTimeframeDetails(candlesByTf[structTf] ?? []), [candlesByTf, structTf]);
  const structure = useMemo(() => detectStructure(candlesByTf[structTf] ?? []), [candlesByTf, structTf]);

  const ready = TIMEFRAMES.some((tf) => (candlesByTf[tf]?.length ?? 0) > 0);
  const price = prices['5m'] ?? prices['1d'] ?? 0;
  const priceAbs = changes['1d'] != null ? (price * (changes['1d'] / 100)) / (1 + changes['1d'] / 100) : 0;
  const change = changes['1d'] ?? 0;

  // ---- Alignment persistence (session-tracked) ----
  const sinceRef = useRef<Partial<Record<Timeframe, { verdict: Verdict; since: number }>>>({});
  const [, tick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    for (const tf of TIMEFRAMES) {
      const v = matrix.tfVerdict[tf];
      if (!v) continue;
      const cur = sinceRef.current[tf];
      if (!cur || cur.verdict !== v) sinceRef.current[tf] = { verdict: v, since: now };
    }
  }, [matrix]);
  useEffect(() => { const id = setInterval(() => tick((t) => t + 1), 30_000); return () => clearInterval(id); }, []);

  // ---- Market State (sidebar) ----
  const marketState: MarketState = useMemo(() => {
    const adxDir = Math.abs((matrix.sub['1h']?.adx ?? 50) - 50) * 2;
    const agree = Math.abs(consensus.bull - consensus.bear) / Math.max(1, consensus.total);
    const state = adxDir > 50 && agree > 0.6 ? 'Trending' : adxDir > 25 ? 'Transitional' : 'Ranging';
    const volSub = TIMEFRAMES.reduce((s, tf) => s + (matrix.sub[tf]?.volume ?? 50), 0) / TIMEFRAMES.length;
    const volatility = heatmap[4].cells['1h'] === 'bearish' ? 'High' : heatmap[4].cells['1h'] === 'bullish' ? 'Low' : 'Medium';
    const volume = volSub > 60 ? 'High' : volSub > 45 ? 'Medium' : 'Low';
    const energy = volatility === 'High' && volume === 'High' ? 'High' : agree < 0.4 ? 'Low' : 'Medium';
    return { state, volatility, volume, energy };
  }, [matrix, consensus, heatmap]);

  const overallVerdictLabel = consensus.overall === 'bullish' ? 'Bullish' : consensus.overall === 'bearish' ? 'Bearish' : 'Neutral';

  return (
    <div className="flex min-h-[100dvh] w-full bg-base text-ink">
      <StackSidebar marketState={marketState} fearGreed={weighted.overall} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-1.5">
            <Bitcoin className="h-4 w-4 text-regime-hot" /><span className="font-semibold">{symbol}</span>
          </div>
          <span className="font-mono text-lg font-semibold tabular-nums">{fmt(price)}</span>
          <span className={['font-mono text-sm tabular-nums', change >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>
            {change >= 0 ? '+' : ''}{fmt(priceAbs, 2)} ({change >= 0 ? '+' : ''}{change.toFixed(2)}%)
          </span>
          <div className="ml-2 flex items-center gap-1 rounded-lg border border-line bg-base p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button key={tf} onClick={() => setStructTf(tf)}
                className={['rounded px-2.5 py-1 text-xs font-medium transition', structTf === tf ? 'bg-accent/20 text-accent' : 'text-ink-muted hover:text-ink'].join(' ')}>
                {TF_LABEL[tf]}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1.5"><span className={['h-2 w-2 rounded-full', status === 'live' ? 'bg-bull' : 'bg-regime-hot'].join(' ')} />{status === 'live' ? 'Live' : status}</span>
            <Link href="/app" className="rounded-md border border-line px-2 py-1 transition hover:text-ink">Chart →</Link>
          </div>
        </header>

        {!ready ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading multi-timeframe market data…</div>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[1.7fr_1fr]">
            {/* ===== LEFT (analysis) ===== */}
            <div className="space-y-3">
              <Panel>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold tracking-wide text-accent">MULTI-TIMEFRAME ANALYSIS</h2>
                  <span className="text-[11px] text-ink-faint">Complete market structure across all timeframes</span>
                </div>
                <MatrixTable matrix={matrix} />
              </Panel>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_3fr]">
                <Panel title="Timeframe Heatmap"><Heatmap rows={heatmap} /></Panel>
                <Panel title={`Timeframe Details (${TF_LABEL[structTf]})`}><Details d={details} /></Panel>
              </div>

              <Panel title="Timeframe Summary">
                <p className="mb-3 text-xs text-ink-muted">
                  {consensus.bear > consensus.bull
                    ? `All major timeframes lean bearish (${consensus.bear}/${consensus.total}). Higher timeframes carry the most weight.`
                    : consensus.bull > consensus.bear
                      ? `Timeframes lean bullish (${consensus.bull}/${consensus.total}). Alignment supports the trend.`
                      : 'Timeframes are mixed. Wait for alignment before committing.'}
                </p>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  <SummaryCard k="Short Term" sub="5m–15m" band={summary.shortTerm} />
                  <FlowArrow />
                  <SummaryCard k="Mid Term" sub="30m–1H" band={summary.midTerm} />
                  <FlowArrow />
                  <SummaryCard k="Long Term" sub="4H–1D" band={summary.longTerm} />
                  <FlowArrow />
                  <SummaryCard k="Overall Outlook" sub="weighted" band={summary.outlook} emphasis />
                </div>
              </Panel>
            </div>

            {/* ===== RIGHT (consensus / persistence / structure / weighted) ===== */}
            <div className="space-y-3">
              <Panel title="Timeframe Consensus">
                <div className="flex items-center gap-4">
                  <ConsensusDial bull={consensus.bull} total={consensus.total} pctBull={consensus.pctBull} />
                  <ul className="space-y-1.5 text-xs">
                    <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-bull" /><span className="font-semibold">{consensus.bull}</span> Timeframes Bullish</li>
                    <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-neutral" /><span className="font-semibold">{consensus.neutral}</span> Timeframes Neutral</li>
                    <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-bear" /><span className="font-semibold">{consensus.bear}</span> Timeframes Bearish</li>
                  </ul>
                </div>
                <div className={['mt-2 border-t border-line pt-2 text-center text-sm font-bold', vColor(consensus.overall)].join(' ')}>
                  {consensus.pctBull}% Bullish
                </div>
              </Panel>

              <Panel title="Alignment Persistence" hint="time in current bias">
                <div className="grid grid-cols-6 gap-1.5">
                  {TIMEFRAMES.map((tf) => {
                    const rec = sinceRef.current[tf];
                    const v = matrix.tfVerdict[tf] ?? 'neutral';
                    return (
                      <div key={tf} className="flex flex-col items-center gap-1 rounded-md border border-line bg-base/40 py-2">
                        <div className="text-[10px] text-ink-faint">{TF_LABEL[tf]}</div>
                        <span className={['h-2.5 w-2.5 rounded-full', vHeat(v)].join(' ')} />
                        <div className="font-mono text-[10px] text-ink-muted">{rec ? fmtDur(Date.now() - rec.since) : '0m'}</div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-ink-faint">
                  Alignment has been {consensus.overall} across the strongest timeframes this session.
                </p>
              </Panel>

              <Panel title="Market Structure View">
                <div className="mb-2 flex items-center gap-1 rounded-lg border border-line bg-base p-0.5">
                  {TIMEFRAMES.map((tf) => (
                    <button key={tf} onClick={() => setStructTf(tf)}
                      className={['flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition', structTf === tf ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink'].join(' ')}>
                      {TF_LABEL[tf]}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-faint">{TF_LABEL[structTf]} Structure</span>
                  <span className={['font-semibold', vColor(structure.verdict)].join(' ')}>{structure.sublabel}</span>
                </div>
                <MiniCandles candles={(candlesByTf[structTf] ?? []).slice(-44)} verdict={structure.verdict} />
              </Panel>

              <Panel title="Timeframe Weighted Score" hint="spec weights">
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-1.5">
                    {weighted.perTf.map(({ tf, weight, score }) => (
                      <div key={tf} className="flex items-center gap-2 text-xs">
                        <span className="w-16 shrink-0 text-ink-faint">{TF_LABEL[tf]} <span className="text-ink-faint/70">({Math.round(weight * 100)}%)</span></span>
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full" style={{ width: `${score}%`, background: 'linear-gradient(90deg,#f23645,#f0a020,#26A69A)' }} />
                        </div>
                        <span className="w-7 shrink-0 text-right font-mono font-semibold">{score}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col items-center border-l border-line pl-4">
                    <div className={['font-mono text-5xl font-bold leading-none', vColor(weighted.outlook)].join(' ')}>{weighted.overall}</div>
                    <div className="text-xs text-ink-faint">/ 100</div>
                    <div className={['mt-1 text-sm font-semibold', vColor(weighted.outlook)].join(' ')}>{overallVerdictLabel}</div>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-2"><Quote className="h-3.5 w-3.5 text-accent/70" /><span className="italic">“The key is not to predict the future, but to prepare for it.”</span> <span className="text-ink-muted">Peter Lynch</span></span>
          <span className="inline-flex items-center gap-2"><Info className="h-3 w-3" /> Data Source: Binance · {status === 'live' ? 'Connected' : status}</span>
        </footer>
      </div>
    </div>
  );
}

// ---- panels ----
function Panel({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface-1 p-3">
      {title && (
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">{title}</h3>
          {hint && <span className="rounded border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-faint">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

function MatrixTable({ matrix }: { matrix: ReturnType<typeof computeAlignmentMatrix> }) {
  return (
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
                  <div className={['mt-0.5 text-[10px] font-semibold uppercase tracking-wide', vColor(v)].join(' ')}>{v}</div>
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
                  <td key={tf} className={['border-b border-line/50 px-2 py-2 text-center font-mono text-[13px] tabular-nums', cell ? vColor(cell.verdict) : 'text-ink-faint', cell ? vTint(cell.verdict) : ''].join(' ')}>
                    {cell ? (row.kind === 'label' ? <span className="inline-flex items-center gap-1"><VGlyph v={cell.verdict} />{cell.display}</span> : cell.display) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="bg-surface-2/50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-accent">Timeframe Score</td>
            {TIMEFRAMES.map((tf) => {
              const sc = matrix.tfScore[tf];
              const tone = sc == null ? 'text-ink-faint' : sc >= 70 ? 'text-bull-bright' : sc >= 40 ? 'text-regime-hot' : 'text-bear-bright';
              return <td key={tf} className={['bg-surface-2/50 px-2 py-2.5 text-center font-mono text-xl font-bold tabular-nums', tone].join(' ')}>{sc ?? '—'}</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Heatmap({ rows }: { rows: HeatmapRow[] }) {
  return (
    <table className="w-full text-left text-xs">
      <thead><tr className="text-[10px] uppercase tracking-wider text-ink-faint"><th className="pb-1" />{TIMEFRAMES.map((tf) => <th key={tf} className="pb-1 text-center font-medium">{TF_LABEL[tf]}</th>)}</tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.category}>
            <td className="py-1 pr-2 text-ink-muted">{row.category}</td>
            {TIMEFRAMES.map((tf) => {
              const v = row.cells[tf] ?? 'neutral';
              return <td key={tf} className="py-1 text-center"><span className={['mx-auto inline-block h-3 w-3 rounded-full', vHeat(v)].join(' ')} title={Cap(v)} /></td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Details({ d }: { d: ReturnType<typeof computeTimeframeDetails> }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 text-xs">
      <DetailCol title="Trend" verdict={d.trend.verdict} rows={[['EMA 20', fmt(d.trend.ema20)], ['EMA 50', fmt(d.trend.ema50)], ['EMA 200', fmt(d.trend.ema200)]]} />
      <DetailCol title="Momentum" verdict={d.momentum.verdict} rows={[['RSI (14)', fmt(d.momentum.rsi)], ['MACD', fmt(d.momentum.macd, 2)], ['Signal', fmt(d.momentum.signal, 2)], ['Histogram', fmt(d.momentum.histogram, 2)]]} />
      <DetailCol title="Strength" verdict={d.strength.verdict} rows={[['ADX (14)', fmt(d.strength.adx)], ['+DI', fmt(d.strength.diPlus)], ['-DI', fmt(d.strength.diMinus)]]} />
      <DetailCol title="Volume" verdict={d.volume.verdict} rows={[['Volume', fmt(d.volume.current, 0)], ['SMA 20', fmt(d.volume.sma20, 0)], ['vs SMA', d.volume.vsPct == null ? '—' : `${d.volume.vsPct >= 0 ? '+' : ''}${d.volume.vsPct.toFixed(0)}%`]]} />
    </div>
  );
}
function DetailCol({ title, verdict, rows }: { title: string; verdict: Verdict; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-line bg-base/40 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{title}</div>
      {rows.map(([k, v]) => <div key={k} className="flex items-center justify-between py-0.5"><span className="text-ink-faint">{k}</span><span className="font-mono tabular-nums text-ink">{v}</span></div>)}
      <div className={['mt-1 border-t border-line pt-1 text-right font-semibold', vColor(verdict)].join(' ')}>{Cap(verdict)}</div>
    </div>
  );
}

function SummaryCard({ k, sub, band, emphasis }: { k: string; sub: string; band: { label: string; verdict: Verdict }; emphasis?: boolean }) {
  return (
    <div className={['flex-1 rounded-lg border px-3 py-2.5 text-center', emphasis ? 'border-line-strong bg-surface-2/40' : 'border-line bg-base/40'].join(' ')}>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{k} <span className="text-ink-faint/60">{sub}</span></div>
      <div className={['mt-0.5 font-bold', emphasis ? 'text-xl' : 'text-base', vColor(band.verdict)].join(' ')}>{band.label}</div>
    </div>
  );
}
function FlowArrow() {
  return <ChevronRight className="mx-auto h-5 w-5 shrink-0 rotate-90 text-ink-faint sm:rotate-0" />;
}

function ConsensusDial({ bull, total, pctBull }: { bull: number; total: number; pctBull: number }) {
  const r = 34, c = 2 * Math.PI * r, dash = (pctBull / 100) * c;
  const color = pctBull >= 55 ? '#26A69A' : pctBull >= 35 ? '#f0a020' : '#f23645';
  return (
    <div className="relative h-[92px] w-[92px] shrink-0">
      <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90">
        <circle cx="46" cy="46" r={r} fill="none" stroke="#2a3247" strokeWidth="8" />
        <circle cx="46" cy="46" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold">{bull}/{total}</span>
        <span className="text-[9px] text-ink-faint">{pctBull}% Bull</span>
      </div>
    </div>
  );
}

/** Lightweight SVG candlestick mini-chart for the structure panel. */
function MiniCandles({ candles, verdict }: { candles: Candle[]; verdict: Verdict }) {
  if (candles.length < 2) return <div className="flex h-[120px] items-center justify-center text-[11px] text-ink-faint">No data</div>;
  const W = 320, H = 120, pad = 4;
  const hi = Math.max(...candles.map((c) => c.high)), lo = Math.min(...candles.map((c) => c.low));
  const range = hi - lo || 1;
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad);
  const cw = (W - 2 * pad) / candles.length;
  const stroke = verdict === 'bullish' ? '#26A69A' : verdict === 'bearish' ? '#f23645' : '#9ab2d7';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[120px] w-full" preserveAspectRatio="none">
      {candles.map((c, i) => {
        const x = pad + i * cw + cw / 2;
        const up = c.close >= c.open;
        const col = up ? '#26A69A' : '#f23645';
        const bodyTop = y(Math.max(c.open, c.close)), bodyBot = y(Math.min(c.open, c.close));
        return (
          <g key={i}>
            <line x1={x} y1={y(c.high)} x2={x} y2={y(c.low)} stroke={col} strokeWidth="0.8" opacity="0.8" />
            <rect x={x - cw * 0.3} y={bodyTop} width={cw * 0.6} height={Math.max(1, bodyBot - bodyTop)} fill={col} />
          </g>
        );
      })}
      <line x1={pad} y1={y(candles[0].close)} x2={W - pad} y2={y(candles[candles.length - 1].close)} stroke={stroke} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
    </svg>
  );
}
