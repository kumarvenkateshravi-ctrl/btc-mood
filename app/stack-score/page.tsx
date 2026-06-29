'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bitcoin, Info, Quote, TrendingUp, Zap, BarChart3, Share2, Activity, Layers, Newspaper,
  XCircle, AlertTriangle, CheckCircle2, Sun, type LucideIcon,
} from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { computeAlignmentMatrix } from '@/lib/alignment';
import { computeConsensus, computeWeightedScore, detectStructure, computeTimeframeDetails } from '@/lib/multiTimeframe';
import { computeAtr } from '@/lib/indicators/atr';
import { computeStackScoreFactors, type Factor, type FactorKey, type Impact } from '@/lib/stackScoreFactors';
import StackSidebar, { type MarketState } from '@/components/stack/StackSidebar';
import { Panel } from '@/components/ui';
import { formatNumber, formatPercent } from '@/lib/format';

const FOCUS_TF: Timeframe = '1h';
const fmtN = (n: number | null | undefined) => formatNumber(n ?? NaN, { precision: 1 });
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Round an SVG path coordinate to 1dp — geometry, not a financial value. */
const r1 = (n: number) => Math.round(n * 10) / 10;
function lastFinite(data: readonly unknown[] | null | undefined): number | null {
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    if (d == null) continue;
    if (typeof d === 'number') { if (Number.isFinite(d)) return d; continue; }
    if (typeof d === 'object' && 'value' in d) { const v = (d as { value?: number }).value; if (v != null && Number.isFinite(v)) return v; }
  }
  return null;
}

const FACTOR_ICON: Record<FactorKey, LucideIcon> = {
  trend: TrendingUp, momentum: Zap, volume: BarChart3, structure: Share2, volatility: Activity, consensus: Layers, sentiment: Newspaper,
};
const impactColor = (i: Impact) => (i === 'High' ? 'text-bear-bright' : i === 'Medium' ? 'text-regime-hot' : 'text-bull-bright');
const ratingColor = (v: string) => (v === 'bullish' ? 'text-bull-bright' : v === 'bearish' ? 'text-bear-bright' : 'text-neutral');
const DIST = [
  { range: '0 - 20', label: 'Avoid', pct: 30, color: '#f23645' },
  { range: '20 - 40', label: 'Weak', pct: 35, color: '#f2683c' },
  { range: '40 - 60', label: 'Moderate', pct: 20, color: '#f0a020' },
  { range: '60 - 80', label: 'Strong', pct: 10, color: '#9acd32' },
  { range: '80 - 100', label: 'Elite', pct: 5, color: '#26A69A' },
];

export default function StackScorePage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const { candlesByTf, status } = useMarketData(symbol);
  const { prices, changes } = useMoodEngine(candlesByTf, []);

  const matrix = useMemo(() => computeAlignmentMatrix(candlesByTf, [...TIMEFRAMES]), [candlesByTf]);
  const consensus = useMemo(() => computeConsensus(matrix, [...TIMEFRAMES]), [matrix]);
  const weighted = useMemo(() => computeWeightedScore(matrix, [...TIMEFRAMES]), [matrix]);

  const ready = TIMEFRAMES.some((tf) => (candlesByTf[tf]?.length ?? 0) > 0);
  const price = prices['5m'] ?? prices['1d'] ?? 0;
  const change = changes['1d'] ?? 0;
  const priceAbs = change != null ? (price * change) / (100 + change) : 0;

  const result = useMemo(() => {
    const focus = candlesByTf[FOCUS_TF] ?? [];
    const details = computeTimeframeDetails(focus);
    const structure = detectStructure(focus);
    const atr = lastFinite(computeAtr(focus).plots[0]?.data);
    const atrPct = atr != null && price > 0 ? (atr / price) * 100 : 1;
    return computeStackScoreFactors({ matrix, consensus, structure, details, atrPct, sentiment: weighted.overall, price, tfs: [...TIMEFRAMES] });
  }, [candlesByTf, matrix, consensus, weighted, price]);

  const riskLevel = useMemo(() => {
    const vol = result.factors.find((f) => f.key === 'volatility')!;
    return vol.score < 45 ? 'High' : result.confidence >= 75 ? 'Low' : 'Medium';
  }, [result]);

  // ---- Session score history ----
  const [history, setHistory] = useState<{ t: number; score: number }[]>([]);
  const lastLog = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const now = Date.now();
    if (now - lastLog.current < 30_000 && history.length > 0) return;
    lastLog.current = now;
    setHistory((h) => [...h, { t: now, score: result.score }].slice(-60));
  }, [ready, result.score]); // eslint-disable-line react-hooks/exhaustive-deps
  const histStats = useMemo(() => {
    if (history.length === 0) return { avg: result.score, hi: result.score, lo: result.score };
    const xs = history.map((p) => p.score);
    return { avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), hi: Math.max(...xs), lo: Math.min(...xs) };
  }, [history, result.score]);

  const marketState: MarketState = useMemo(() => ({
    state: weighted.outlook === 'neutral' ? 'Transitional' : Math.abs(weighted.overall - 50) > 25 ? 'Trending' : 'Transitional',
    volatility: riskLevel,
    volume: result.factors.find((f) => f.key === 'volume')!.score > 55 ? 'High' : result.factors.find((f) => f.key === 'volume')!.score < 45 ? 'Low' : 'Medium',
    energy: result.confidence < 45 ? 'Low' : result.confidence > 70 ? 'High' : 'Medium',
  }), [weighted, riskLevel, result]);

  const dirColor = result.direction === 'buy' ? 'text-bull-bright' : result.direction === 'sell' ? 'text-bear-bright' : 'text-ink';

  return (
    <div className="flex min-h-[100dvh] w-full bg-base text-ink">
      <StackSidebar marketState={marketState} fearGreed={weighted.overall} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-1.5"><Bitcoin className="h-4 w-4 text-regime-hot" /><span className="font-semibold">{symbol}</span></div>
          <span className="font-mono text-lg font-semibold tabular-nums">{fmtN(price)}</span>
          <span className={['font-mono text-sm tabular-nums', change >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{change >= 0 ? '+' : ''}{fmtN(priceAbs)} ({formatPercent(change)})</span>
          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1.5"><span className={['h-2 w-2 rounded-full', status === 'live' ? 'bg-bull' : 'bg-regime-hot'].join(' ')} />{status === 'live' ? 'Live' : status}</span>
            <Link href="/app" className="rounded-md border border-line px-2 py-1 transition hover:text-ink">Chart →</Link>
          </div>
        </header>

        {!ready ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading market data…</div>
        ) : (
          <div className="flex-1 space-y-3 overflow-auto p-3">
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-bold tracking-wide text-accent">STACK SCORE</h1>
              <span className="text-xs text-ink-faint">Probability &amp; quality score for smarter trading decisions</span>
            </div>

            {/* Row 1 */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.3fr_1.3fr_0.9fr]">
              <Panel eyebrow title="Overall Stack Score">
                <div className="flex flex-col items-center">
                  <ScoreGauge value={result.score} />
                  <div className="-mt-2 text-base tracking-[0.25em] text-accent">{'★'.repeat(result.stars)}<span className="text-line-strong">{'★'.repeat(5 - result.stars)}</span></div>
                  <div className={['mt-1 text-2xl font-extrabold', dirColor].join(' ')}>{result.recommendation}</div>
                  <div className="text-[11px] text-ink-faint">{result.score >= 60 || result.score <= 40 ? `${result.direction === 'buy' ? 'High' : 'Low'} Probability Setup` : 'Mixed Setup'}</div>
                </div>
              </Panel>

              <Panel eyebrow title="Score Breakdown">
                <div className="space-y-1.5">
                  {result.factors.map((f) => <BreakdownBar key={f.key} f={f} />)}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-xs">
                  <span className="text-ink-faint">Score Confidence</span>
                  <span className={['font-semibold', result.confidence >= 75 ? 'text-bull-bright' : result.confidence >= 50 ? 'text-regime-hot' : 'text-bear-bright'].join(' ')}>{result.confidenceLabel}</span>
                </div>
              </Panel>

              <Panel eyebrow title="Score History" badge="session">
                <Sparkline points={history.map((p) => p.score)} current={result.score} />
                <div className="mt-2 grid grid-cols-4 gap-2 border-t border-line pt-2 text-center text-xs">
                  <Stat k="Average" v={String(histStats.avg)} />
                  <Stat k="Highest" v={String(histStats.hi)} tone="bull" />
                  <Stat k="Lowest" v={String(histStats.lo)} tone="bear" />
                  <Stat k="Trend" v={history.length > 1 && result.score >= history[0].score ? '↑' : '↓'} />
                </div>
              </Panel>

              <Panel eyebrow title="Recommendation">
                <div className={['text-center text-4xl font-extrabold tracking-tight', dirColor].join(' ')}>{result.recommendation}</div>
                <div className="mt-3 space-y-2 text-xs">
                  <div>
                    <div className="mb-1 flex justify-between"><span className="text-ink-faint">Probability of Success</span><span className="font-semibold">{result.probability}%</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${result.probability}%`, background: 'linear-gradient(90deg,#f23645,#f0a020,#26A69A)' }} /></div>
                  </div>
                  <KV k="Risk Level" v={riskLevel} tone={riskLevel === 'High' ? 'bear' : riskLevel === 'Low' ? 'bull' : undefined} />
                  <KV k="Best Action" v={result.bestAction} />
                  <KV k="Invalidation" v={result.invalidation} />
                </div>
              </Panel>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr]">
              <Panel eyebrow title="Detailed Factor Analysis">
                <div className="divide-y divide-line/60">
                  {result.factors.map((f) => {
                    const Icon = FACTOR_ICON[f.key];
                    return (
                      <div key={f.key} className="grid grid-cols-[1.4fr_0.7fr_1.6fr_0.6fr] items-center gap-2 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className={['flex h-8 w-8 shrink-0 items-center justify-center rounded-full border', f.verdict === 'bullish' ? 'border-bull/40 text-bull-bright' : f.verdict === 'bearish' ? 'border-bear/40 text-bear-bright' : 'border-line text-ink-muted'].join(' ')}><Icon className="h-4 w-4" /></span>
                          <div><div className="text-sm font-medium text-ink">{f.label}</div><div className="text-[10px] text-ink-faint">{f.sub}</div></div>
                        </div>
                        <div><div className={['text-sm font-semibold', ratingColor(f.verdict)].join(' ')}>{f.rating}</div><div className="font-mono text-xs text-ink-muted">{f.score}<span className="text-ink-faint">/100</span></div></div>
                        <div className="text-[11px] text-ink-muted">{f.explanation}<div className="text-ink-faint">{f.detail}</div></div>
                        <div className={['text-right text-xs font-semibold', impactColor(f.impact)].join(' ')}>{f.impact}</div>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <div className="space-y-3">
                <Panel eyebrow title="Stack Score Distribution">
                  <div className="flex items-center gap-4">
                    <ScoreRing value={result.score} />
                    <ul className="flex-1 space-y-1 text-[11px]">
                      {DIST.map((d) => {
                        const inBand = result.score >= Number(d.range.split(' - ')[0]) && result.score <= Number(d.range.split(' - ')[1]);
                        return (
                          <li key={d.range} className={['flex items-center gap-2', inBand ? 'font-semibold text-ink' : 'text-ink-muted'].join(' ')}>
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                            <span className="font-mono">{d.range}</span><span className="flex-1">{d.label}</span><span className="text-ink-faint">{d.pct}%</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </Panel>

                <Panel eyebrow title="Probability Model">
                  <div className="space-y-1.5 text-xs">
                    <KV k="Historical Win Rate (Similar)" v={`${result.probability}%`} />
                    <KV k="Risk / Reward Quality" v={result.riskReward} tone={result.direction === 'buy' ? 'bull' : 'bear'} />
                    <KV k="Edge Quality" v={result.edgeQuality} tone={result.edgeQuality === 'High' ? 'bull' : result.edgeQuality === 'Low' ? 'bear' : undefined} />
                    <KV k="Trade Quality Grade" v={result.tradeGrade} />
                    <KV k="Recommendation Strength" v={result.recStrength} tone={result.recStrength === 'High' ? 'bull' : undefined} />
                  </div>
                </Panel>

                <Panel eyebrow title="Score Insights">
                  <ul className="space-y-1.5 text-xs">
                    {result.insights.map((ins, i) => {
                      const Icon = ins.tone === 'bull' || ins.tone === 'ok' ? CheckCircle2 : ins.tone === 'warn' ? AlertTriangle : XCircle;
                      const c = ins.tone === 'bull' || ins.tone === 'ok' ? 'text-bull-bright' : ins.tone === 'warn' ? 'text-regime-hot' : 'text-bear-bright';
                      return <li key={i} className="flex items-start gap-2 text-ink-muted"><Icon className={['mt-0.5 h-3.5 w-3.5 shrink-0', c].join(' ')} />{ins.text}</li>;
                    })}
                  </ul>
                </Panel>
              </div>
            </div>

            {/* Row 3 */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr]">
              <Panel eyebrow title="How To Improve This Score">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {result.improvements.map((imp) => (
                    <div key={imp.key} className="rounded-lg border border-line bg-base/40 p-2.5">
                      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-ink"><Sun className="h-3.5 w-3.5 text-accent" />{imp.label}</div>
                      <div className="text-[11px] leading-relaxed text-ink-muted">{imp.advice}</div>
                      <div className="mt-1.5 text-[11px] font-semibold text-bull-bright">Potential +{imp.potential} pts</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel eyebrow title="Score Alerts">
                <ul className="space-y-2 text-xs">
                  {[['Alert when score > 60', 'bull'], ['Alert when score < 20', 'bear'], ['Alert on score change > 15', 'info']].map(([label]) => (
                    <li key={label} className="flex items-center justify-between rounded-md border border-line bg-base/40 px-3 py-2">
                      <span className="text-ink-muted">{label}</span>
                      <button className="focus-ring rounded border border-line px-2 py-1 text-[11px] text-ink-faint transition hover:bg-surface-2 hover:text-ink">Set Alert</button>
                    </li>
                  ))}
                </ul>
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

// ---- helpers ----
// Panel now imported from @/components/ui (MDS Phase C migration); eyebrow style.
function Stat({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return <div><div className="text-[10px] uppercase tracking-wider text-ink-faint">{k}</div><div className={['font-mono text-base font-bold', c].join(' ')}>{v}</div></div>;
}
function KV({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return <div className="flex items-center justify-between gap-2"><span className="text-ink-faint">{k}</span><span className={['text-right font-medium', c].join(' ')}>{v}</span></div>;
}
function BreakdownBar({ f }: { f: Factor }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-36 shrink-0 text-ink-muted">{f.label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${f.score}%`, background: 'linear-gradient(90deg,#f23645,#f0a020,#26A69A)' }} /></div>
      <span className="w-12 shrink-0 text-right font-mono"><span className="font-semibold">{f.score}</span><span className="text-ink-faint">/100</span></span>
    </div>
  );
}

function ScoreGauge({ value }: { value: number }) {
  const v = clamp(value, 0, 100);
  // 270° arc from 135° to 405°.
  const a0 = 135, sweep = 270;
  const ang = (deg: number) => (deg * Math.PI) / 180;
  const pt = (deg: number, r: number) => [100 + r * Math.cos(ang(deg)), 100 + r * Math.sin(ang(deg))];
  const R = 80;
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from, R), [x2, y2] = pt(to, R);
    return `M ${x1} ${y1} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const needle = a0 + (v / 100) * sweep;
  const [nx, ny] = pt(needle, R - 6);
  const color = v >= 60 ? '#26A69A' : v >= 40 ? '#f0a020' : '#f23645';
  return (
    <div className="relative">
      <svg viewBox="0 0 200 200" className="w-44">
        <path d={arc(a0, a0 + sweep)} fill="none" stroke="#2a3247" strokeWidth="13" strokeLinecap="round" />
        <path d={arc(a0, a0 + 0.4 * sweep)} fill="none" stroke="#f23645" strokeWidth="13" strokeLinecap="round" />
        <path d={arc(a0 + 0.4 * sweep, a0 + 0.6 * sweep)} fill="none" stroke="#f0a020" strokeWidth="13" />
        <path d={arc(a0 + 0.6 * sweep, a0 + sweep)} fill="none" stroke="#26A69A" strokeWidth="13" strokeLinecap="round" />
        <line x1="100" y1="100" x2={nx} y2={ny} stroke="#e9eef7" strokeWidth="3" strokeLinecap="round" />
        <circle cx="100" cy="100" r="5" fill="#e9eef7" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-4xl font-bold leading-none" style={{ color }}>{v}</span>
        <span className="text-xs text-ink-faint">/100</span>
      </div>
    </div>
  );
}
function ScoreRing({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r, dash = (clamp(value, 0, 100) / 100) * c;
  const color = value >= 60 ? '#26A69A' : value >= 40 ? '#f0a020' : '#f23645';
  return (
    <div className="relative h-[92px] w-[92px] shrink-0">
      <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90"><circle cx="46" cy="46" r={r} fill="none" stroke="#2a3247" strokeWidth="8" /><circle cx="46" cy="46" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} /></svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-bold">{value}</span><span className="text-[9px] text-ink-faint">/100</span></div>
    </div>
  );
}
function Sparkline({ points, current }: { points: number[]; current: number }) {
  const data = points.length > 0 ? points : [current];
  const W = 320, H = 70, pad = 4;
  const max = 100, min = 0;
  const x = (i: number) => pad + (data.length <= 1 ? W - 2 * pad : (i / (data.length - 1)) * (W - 2 * pad));
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - 2 * pad);
  const path = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${r1(x(i))} ${r1(y(v))}`).join(' ');
  const lastX = x(data.length - 1), lastY = y(data[data.length - 1]);
  const col = current >= 60 ? '#26A69A' : current >= 40 ? '#f0a020' : '#f23645';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[70px] w-full" preserveAspectRatio="none">
      <line x1={pad} y1={y(50)} x2={W - pad} y2={y(50)} stroke="#2a3247" strokeWidth="0.5" strokeDasharray="3 3" />
      <path d={`${path} L ${lastX} ${H - pad} L ${pad} ${H - pad} Z`} fill={col} opacity="0.08" />
      <path d={path} fill="none" stroke={col} strokeWidth="1.5" />
      <circle cx={lastX} cy={lastY} r="3" fill={col} />
    </svg>
  );
}
