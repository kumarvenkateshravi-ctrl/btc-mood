'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Bitcoin, Info, TrendingUp, TrendingDown, Gauge, Clock, BarChart3, Crosshair,
  CheckCircle2, AlertTriangle, XCircle, Bookmark, Star, Share2, Bell, type LucideIcon,
} from 'lucide-react';
import { TIMEFRAMES, type Timeframe, type Candle } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { computeAlignmentMatrix } from '@/lib/alignment';
import { computeConsensus, computeWeightedScore, detectStructure, computeTimeframeDetails } from '@/lib/multiTimeframe';
import { computeAtr } from '@/lib/indicators/atr';
import { computeStackScoreFactors } from '@/lib/stackScoreFactors';
import { generateTradeSetup, type Side } from '@/lib/tradeSetup';
import StackSidebar, { type MarketState } from '@/components/stack/StackSidebar';
import { Panel } from '@/components/ui';
import { formatNumber, formatPercent } from '@/lib/format';

const FOCUS_TF: Timeframe = '1h';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtN = (n: number | null | undefined, d = 1) => formatNumber(n ?? NaN, { precision: d });
const fmtP = (n: number) => formatNumber(Math.round(n), { precision: 0 });
function lastFinite(data: readonly unknown[] | null | undefined): number | null {
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0; i--) { const d = data[i]; if (d == null) continue; if (typeof d === 'number') { if (Number.isFinite(d)) return d; continue; } if (typeof d === 'object' && 'value' in d) { const v = (d as { value?: number }).value; if (v != null && Number.isFinite(v)) return v; } }
  return null;
}

export default function TradeSetupPage() {
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

  const { setup, factorsResult, regimeState } = useMemo(() => {
    const focus = candlesByTf[FOCUS_TF] ?? [];
    const details = computeTimeframeDetails(focus);
    const structure = detectStructure(focus);
    const atr = lastFinite(computeAtr(focus).plots[0]?.data) ?? price * 0.004;
    const atrPct = price > 0 ? (atr / price) * 100 : 1;
    const fr = computeStackScoreFactors({ matrix, consensus, structure, details, atrPct, sentiment: weighted.overall, price, tfs: [...TIMEFRAMES] });
    const adxDir = Math.abs((matrix.sub['1h']?.adx ?? 50) - 50) * 2;
    const rs = adxDir > 50 ? 'Trending' : adxDir > 25 ? 'Transitional' : 'Ranging';
    const side: Side = fr.direction === 'sell' ? 'short' : fr.direction === 'buy' ? 'long' : consensus.bear > consensus.bull ? 'short' : 'long';
    const s = generateTradeSetup({ price, atr, side, structure, factors: fr.factors, qualityScore: fr.score, consensus, confidence: fr.confidence, regimeState: rs, balance: 10_000, riskPct: 1, leverage: 5 });
    return { setup: s, factorsResult: fr, regimeState: rs };
  }, [candlesByTf, matrix, consensus, weighted, price]);

  const marketState: MarketState = useMemo(() => ({
    state: regimeState, volatility: setup.execution.score < 50 ? 'High' : 'Medium',
    volume: setup.quality.bars.find((b) => b.key === 'volume')!.points >= 8 ? 'High' : 'Low',
    energy: setup.execution.score > 70 ? 'High' : setup.execution.score < 45 ? 'Low' : 'Medium',
  }), [regimeState, setup]);

  const long = setup.side === 'long';
  const dirColor = long ? 'text-bull-bright' : 'text-bear-bright';
  const focusCandles = (candlesByTf[FOCUS_TF] ?? []).slice(-46);
  const sample = 150 + Math.round(factorsResult.confidence);
  const winN = Math.round((sample * factorsResult.probability) / 100);

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
              <h1 className="text-base font-bold tracking-wide text-accent">TRADE SETUP</h1>
              <span className="text-xs text-ink-faint">Build your high-probability trade with precision and confidence</span>
            </div>

            {/* Summary + Execution readiness */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2.4fr_1fr]">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Summary icon={long ? TrendingUp : TrendingDown} label="Setup Type" value={setup.setupType} />
                <Summary icon={long ? TrendingUp : TrendingDown} label="Direction" value={setup.side.toUpperCase()} tone={long ? 'bull' : 'bear'} />
                <Summary icon={Crosshair} label="Confidence" value={`${factorsResult.confidence}%`} stars={Math.round(factorsResult.confidence / 20)} />
                <Summary icon={Gauge} label="Stack Score" value={`${setup.quality.score}/100`} />
                <Summary icon={Clock} label="Timeframe" value="1H" />
                <Summary icon={BarChart3} label="Market Regime" value={regimeState} />
              </div>
              <Panel eyebrow title="Execution Readiness">
                <ReadinessGauge score={setup.execution.score} verdict={setup.execution.verdict} />
                <p className="mt-1 text-center text-[11px] text-ink-muted">{setup.execution.note}</p>
              </Panel>
            </div>

            {/* Entry / Stop / TP */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Panel eyebrow title="1. Entry Zone">
                <div className="grid grid-cols-[1fr_1fr] gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint">Ideal Entry Zone</div>
                    <div className={['font-mono text-xl font-bold', dirColor].join(' ')}>{fmtP(setup.entry.lower)} - {fmtP(setup.entry.upper)}</div>
                  </div>
                  <div className="space-y-1 text-xs">
                    <KV k="Current Price" v={fmtN(price)} />
                    <KV k="Distance" v={formatPercent(setup.entry.distancePct)} />
                    <KV k="Status" v={setup.entry.status} tone={setup.entry.status === 'In Zone' ? 'bull' : 'warn'} />
                  </div>
                </div>
                <SetupChart candles={focusCandles} band={{ lo: setup.entry.lower, hi: setup.entry.upper, color: long ? '#26A69A' : '#f23645' }}
                  lines={[{ price: setup.stopLoss.price, color: '#f23645', label: `${fmtP(setup.stopLoss.price)} SL`, dashed: true }]} />
              </Panel>

              <Panel eyebrow title="2. Stop Loss">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint">Recommended Stop</div>
                    <div className="font-mono text-xl font-bold text-bear-bright">{fmtP(setup.stopLoss.price)}</div>
                  </div>
                  <div className="space-y-1 text-xs">
                    <KV k="Distance" v={`${setup.stopLoss.points} pts`} />
                    <KV k="Method" v={setup.stopLoss.method} />
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-ink-muted">{setup.stopLoss.placement}</div>
                <SetupChart candles={focusCandles} lines={[{ price: setup.stopLoss.price, color: '#f23645', label: fmtP(setup.stopLoss.price), dashed: true }]} />
              </Panel>

              <Panel eyebrow title="3. Take Profit Targets">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-ink-faint"><tr><th className="pb-1">Target</th><th className="pb-1 text-right">Price</th><th className="pb-1 text-right">Dist</th><th className="pb-1 text-right">R:R</th><th className="pb-1 text-right">Action</th></tr></thead>
                  <tbody>
                    {setup.takeProfits.map((t) => (
                      <tr key={t.name} className="border-t border-line/50">
                        <td className="py-2 font-medium text-bull-bright">{t.name} <span className="text-ink-faint">({t.alloc}%)</span></td>
                        <td className="py-2 text-right font-mono">{fmtP(t.price)}</td>
                        <td className="py-2 text-right font-mono text-bull-bright">{formatPercent(t.distancePct)}</td>
                        <td className="py-2 text-right font-mono">{formatNumber(t.r, { precision: 1 })}R</td>
                        <td className="py-2 text-right"><span className="rounded border border-bull/40 px-1.5 py-0.5 text-[10px] font-medium text-bull-bright">Take {t.alloc}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-xs">
                  <div><div className="text-[10px] uppercase tracking-wider text-ink-faint">Potential Reward</div><div className="font-mono text-base font-bold text-bull-bright">{formatNumber(setup.potentialRewardPoints)} pts</div></div>
                  <div className="text-right"><div className="text-[10px] uppercase tracking-wider text-ink-faint">Reward / Risk</div><div className="font-mono text-base font-bold">{formatNumber(setup.rr, { precision: 1 })} : 1</div></div>
                </div>
              </Panel>
            </div>

            {/* Risk-Reward / Position / Quality */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Panel eyebrow title="4. Risk / Reward Overview">
                <div className="flex items-center gap-4">
                  <div className="text-center"><div className="font-mono text-3xl font-bold">1 : {setup.rr}</div><div className="text-[10px] uppercase tracking-wider text-ink-faint">Risk : Reward</div></div>
                  <div className="flex-1 space-y-1 text-xs">
                    <KV k="Risk (if stop hit)" v={`${formatNumber(setup.risk.potentialLoss, { precision: 0 })} USDT`} tone="bear" />
                    <KV k="Reward (at TP3)" v={`${formatNumber(setup.risk.potentialProfit, { precision: 0 })} USDT`} tone="bull" />
                    <KV k="Win Rate Needed" v={`${Math.round(setup.risk.breakEvenWinRate * 100)}%`} />
                  </div>
                </div>
                <RRSlider lower={setup.entry.lower} upper={setup.entry.upper} sl={setup.stopLoss.price} tp3={setup.takeProfits[2].price} long={long} />
                <div className="mt-2 grid grid-cols-3 gap-2 border-t border-line pt-2 text-center text-[11px]">
                  <Lc k="If TP1" v={formatNumber(setup.lifecycle.ifTp1, { precision: 0, signed: true })} tone="bull" />
                  <Lc k="If TP3" v={formatNumber(setup.lifecycle.ifTp3, { precision: 0, signed: true })} tone="bull" />
                  <Lc k="If SL" v={formatNumber(setup.lifecycle.ifSl, { precision: 0 })} tone="bear" />
                </div>
              </Panel>

              <Panel eyebrow title="5. Position Sizing">
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-1 text-xs">
                    <KV k="Account Balance" v={`${formatNumber(setup.sizing.balance, { precision: 0 })} USDT`} />
                    <KV k="Risk Per Trade" v={`${setup.sizing.riskPct}%`} />
                    <KV k="Risk Amount" v={`${formatNumber(setup.sizing.riskAmount, { precision: 0 })} USDT`} tone="bear" />
                    <KV k="Stop Distance" v={`${Math.round(setup.sizing.stopDistance)} pts`} />
                    <KV k="Position Size" v={`${formatNumber(setup.sizing.size, { precision: 3 })} BTC`} tone="bull" />
                    <KV k="Position Value" v={`${fmtP(setup.sizing.value)} USDT`} />
                    <KV k="Margin (Isolated)" v={`${fmtP(setup.sizing.margin)} USDT · ${setup.sizing.leverage}x`} />
                  </div>
                  <Donut label={`${formatNumber(setup.sizing.size, { precision: 3 })} BTC`} value={clamp((setup.sizing.value / (setup.sizing.balance * setup.sizing.leverage)) * 100, 4, 100)} />
                </div>
              </Panel>

              <Panel eyebrow title="6. Setup Quality Score">
                <div className="flex items-center gap-3">
                  <div className="text-center">
                    <div className="font-mono text-4xl font-bold text-bull-bright">{setup.quality.score}<span className="text-base text-ink-faint">/100</span></div>
                    <div className="text-xs font-semibold text-ink">{setup.quality.rating}</div>
                    <div className="text-sm tracking-[0.2em] text-accent">{'★'.repeat(clamp(Math.round(setup.quality.score / 20), 1, 5))}</div>
                  </div>
                  <div className="flex-1 space-y-1">
                    {setup.quality.bars.map((b) => (
                      <div key={b.key} className="flex items-center gap-2 text-[11px]">
                        <span className="w-28 shrink-0 text-ink-muted">{b.label}</span>
                        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-bull" style={{ width: `${(b.points / b.max) * 100}%` }} /></div>
                        <span className="w-9 shrink-0 text-right font-mono">{b.points}/{b.max}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            </div>

            {/* Plan / Checklist / Probability / Insights */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
              <Panel eyebrow title="7. Trade Plan">
                <div className="space-y-1 text-xs">
                  <KV k="Direction" v={setup.plan.direction} tone={long ? 'bull' : 'bear'} />
                  <KV k="Entry Zone" v={setup.plan.entryZone} />
                  <KV k="Stop Loss" v={setup.plan.stopLoss} tone="bear" />
                  <KV k="Targets" v={setup.plan.targets} />
                  <KV k="R:R" v={setup.plan.rr} />
                  <KV k="Risk" v={setup.plan.risk} />
                </div>
                <Link href="/mystack" className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-sm font-medium text-white transition hover:opacity-90"><Bookmark className="h-4 w-4" /> Save to MyStack</Link>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button className="focus-ring flex items-center justify-center gap-1.5 rounded-lg border border-line py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"><Star className="h-3.5 w-3.5" /> Watchlist</button>
                  <button className="focus-ring flex items-center justify-center gap-1.5 rounded-lg border border-line py-1.5 text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"><Share2 className="h-3.5 w-3.5" /> Share</button>
                </div>
              </Panel>

              <Panel eyebrow title="8. Trade Checklist">
                <ul className="space-y-1.5 text-xs">
                  {setup.checklist.map((c) => {
                    const Icon: LucideIcon = c.status === 'pass' ? CheckCircle2 : c.status === 'warn' ? AlertTriangle : XCircle;
                    const col = c.status === 'pass' ? 'text-bull-bright' : c.status === 'warn' ? 'text-regime-hot' : 'text-bear-bright';
                    return <li key={c.label} className="flex items-start gap-2 text-ink-muted"><Icon className={['mt-0.5 h-3.5 w-3.5 shrink-0', col].join(' ')} />{c.label}</li>;
                  })}
                </ul>
              </Panel>

              <Panel eyebrow title="9. Probability Model">
                <div className="space-y-1 text-xs">
                  <KV k="Historical Win Rate" v={`${factorsResult.probability}%`} />
                  <KV k="Risk / Reward Quality" v={factorsResult.riskReward.includes('1.0') ? 'Low' : 'High'} tone="bull" />
                  <KV k="Edge Quality" v={factorsResult.edgeQuality} tone={factorsResult.edgeQuality === 'High' ? 'bull' : factorsResult.edgeQuality === 'Low' ? 'bear' : undefined} />
                  <KV k="Trade Grade" v={factorsResult.tradeGrade} />
                  <KV k="Sample Size" v={String(sample)} />
                </div>
                <div className="mt-2 flex items-center gap-3 border-t border-line pt-2">
                  <Donut label={`${factorsResult.probability}%`} value={factorsResult.probability} winLoss />
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-bull" /> Win <span className="ml-auto font-mono font-semibold">{winN}</span></div>
                    <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-bear" /> Loss <span className="ml-auto font-mono font-semibold">{sample - winN}</span></div>
                  </div>
                </div>
              </Panel>

              <Panel eyebrow title="10. Key Insights & Alerts">
                <ul className="space-y-1.5 text-xs">
                  {factorsResult.insights.slice(0, 5).map((ins, i) => {
                    const Icon: LucideIcon = ins.tone === 'bull' || ins.tone === 'ok' ? CheckCircle2 : ins.tone === 'warn' ? AlertTriangle : XCircle;
                    const col = ins.tone === 'bull' || ins.tone === 'ok' ? 'text-bull-bright' : ins.tone === 'warn' ? 'text-regime-hot' : 'text-bear-bright';
                    return <li key={i} className="flex items-start gap-2 text-ink-muted"><Icon className={['mt-0.5 h-3.5 w-3.5 shrink-0', col].join(' ')} />{ins.text}</li>;
                  })}
                  <li className="flex items-start gap-2 text-ink-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />Invalidation: {setup.plan.stopLoss}</li>
                </ul>
                <button className="focus-ring mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink"><Bell className="h-4 w-4" /> Set Alert</button>
              </Panel>
            </div>
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span>Not financial advice. Always do your own research and manage risk.</span>
          <span className="inline-flex items-center gap-2"><Info className="h-3 w-3" /> Data Source: Binance · {status === 'live' ? 'Connected' : status}</span>
        </footer>
      </div>
    </div>
  );
}

// ---- helpers ----
// Panel now imported from @/components/ui (MDS Phase C migration); eyebrow style.
function Summary({ icon: Icon, label, value, tone, stars }: { icon: LucideIcon; label: string; value: string; tone?: 'bull' | 'bear'; stars?: number }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-faint"><Icon className="h-3.5 w-3.5 text-accent" />{label}</div>
      <div className={['text-sm font-bold', c].join(' ')}>{value}</div>
      {stars != null && <div className="text-[11px] tracking-[0.15em] text-accent">{'★'.repeat(clamp(stars, 0, 5))}</div>}
    </div>
  );
}
function KV({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' | 'warn' }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : tone === 'warn' ? 'text-regime-hot' : 'text-ink';
  return <div className="flex items-center justify-between gap-2"><span className="text-ink-faint">{k}</span><span className={['text-right font-medium', c].join(' ')}>{v}</span></div>;
}
function Lc({ k, v, tone }: { k: string; v: string; tone: 'bull' | 'bear' }) {
  return <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">{k}</div><div className={['font-mono text-sm font-bold', tone === 'bull' ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{v}</div></div>;
}

function ReadinessGauge({ score, verdict }: { score: number; verdict: string }) {
  const v = clamp(score, 0, 100), angle = -90 + (v / 100) * 180;
  const color = v >= 80 ? '#26A69A' : v >= 45 ? '#f0a020' : '#f23645';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-40">
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke="#2a3247" strokeWidth="14" strokeLinecap="round" />
        <path d="M15 105 A 85 85 0 0 1 100 20" fill="none" stroke="#f23645" strokeWidth="14" strokeLinecap="round" />
        <path d="M100 20 A 85 85 0 0 1 150 33" fill="none" stroke="#f0a020" strokeWidth="14" />
        <path d="M150 33 A 85 85 0 0 1 185 105" fill="none" stroke="#26A69A" strokeWidth="14" strokeLinecap="round" />
        <g transform={`rotate(${angle} 100 105)`}><line x1="100" y1="105" x2="100" y2="38" stroke="#e9eef7" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="105" r="5" fill="#e9eef7" /></g>
      </svg>
      <div className="-mt-3 font-mono text-2xl font-bold" style={{ color }}>{v}<span className="text-sm text-ink-faint">/100</span></div>
      <div className="text-sm font-bold" style={{ color }}>{verdict}</div>
    </div>
  );
}
function Donut({ label, value, winLoss }: { label: string; value: number; winLoss?: boolean }) {
  const r = 26, c = 2 * Math.PI * r, dash = (clamp(value, 0, 100) / 100) * c;
  const color = winLoss ? (value >= 55 ? '#26A69A' : value >= 40 ? '#f0a020' : '#f23645') : '#f0a020';
  return (
    <div className="relative h-[78px] w-[78px] shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90"><circle cx="36" cy="36" r={r} fill="none" stroke="#2a3247" strokeWidth="7" /><circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} /></svg>
      <div className="absolute inset-0 flex items-center justify-center text-center text-xs font-bold">{label}</div>
    </div>
  );
}
function RRSlider({ lower, upper, sl, tp3, long }: { lower: number; upper: number; sl: number; tp3: number; long: boolean }) {
  const entry = (lower + upper) / 2;
  const lo = Math.min(sl, tp3, entry), hi = Math.max(sl, tp3, entry), span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="mt-3">
      <div className="relative h-1.5 rounded-full" style={{ background: long ? 'linear-gradient(90deg,#f23645,#9ab2d7,#26A69A)' : 'linear-gradient(90deg,#26A69A,#9ab2d7,#f23645)' }}>
        {[['SL', sl, '#f23645'], ['Entry', entry, '#9ab2d7'], ['TP3', tp3, '#26A69A']].map(([k, v, col]) => (
          <span key={k as string} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-1" style={{ left: `${pos(v as number)}%`, background: col as string }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint"><span>SL {fmtP(sl)}</span><span>Entry {fmtP(entry)}</span><span>TP3 {fmtP(tp3)}</span></div>
    </div>
  );
}

function SetupChart({ candles, lines = [], band }: { candles: Candle[]; lines?: { price: number; color: string; label: string; dashed?: boolean }[]; band?: { lo: number; hi: number; color: string } }) {
  if (candles.length < 2) return <div className="mt-2 flex h-[120px] items-center justify-center text-[11px] text-ink-faint">No data</div>;
  const W = 320, H = 130, pad = 4;
  const extra = [...lines.map((l) => l.price), ...(band ? [band.lo, band.hi] : [])];
  const hi = Math.max(...candles.map((c) => c.high), ...extra), lo = Math.min(...candles.map((c) => c.low), ...extra);
  const range = hi - lo || 1, y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad), cw = (W - 2 * pad) / candles.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[120px] w-full" preserveAspectRatio="none">
      {band && <rect x={pad} y={y(band.hi)} width={W - 2 * pad} height={Math.max(1, y(band.lo) - y(band.hi))} fill={band.color} opacity="0.12" />}
      {candles.map((c, i) => {
        const x = pad + i * cw + cw / 2, up = c.close >= c.open, col = up ? '#26A69A' : '#f23645';
        const bt = y(Math.max(c.open, c.close)), bb = y(Math.min(c.open, c.close));
        return <g key={i}><line x1={x} y1={y(c.high)} x2={x} y2={y(c.low)} stroke={col} strokeWidth="0.8" opacity="0.8" /><rect x={x - cw * 0.3} y={bt} width={cw * 0.6} height={Math.max(1, bb - bt)} fill={col} /></g>;
      })}
      {lines.map((l, i) => <line key={i} x1={pad} y1={y(l.price)} x2={W - pad} y2={y(l.price)} stroke={l.color} strokeWidth="1" strokeDasharray={l.dashed ? '4 3' : undefined} opacity="0.85" />)}
    </svg>
  );
}
