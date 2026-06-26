'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bitcoin, ChevronDown, Bell, Clock, Circle, Info, Check, X, Plus, Trash2, Eye, Settings2,
  ArrowRight, ArrowDown, Star, Zap, BrainCircuit, Sparkles, BellRing, type LucideIcon,
} from 'lucide-react';
import { type Candle } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import {
  TRADING_STYLES, STYLE_BY_ID, WORKFLOW_STEPS, qualifyMarket, SAMPLE_QUALIFICATION,
  type TradingStyle, type Qualification,
} from '@/lib/myStackIqEngine';
import StackSidebar from '@/components/stack/StackSidebar';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtN = (n: number, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (n: number) => (n >= 0 ? '+' : '');
const tone = (n: number) => (n >= 0 ? 'text-bull-bright' : 'text-bear-bright');
const INDICATOR_TABS = ['Trend', 'Momentum', 'Volume', 'Volatility', 'Levels', 'Others'];

export default function MyStackIqPage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const { candlesByTf, status } = useMarketData(symbol);
  const { prices, changes } = useMoodEngine(candlesByTf, []);
  const livePrice = prices['5m'] ?? prices['1d'] ?? 0;
  const change = changes['1d'] ?? 0;
  const [clock, setClock] = useState('--:-- --');
  useEffect(() => { const t = () => setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })); t(); const id = setInterval(t, 1000); return () => clearInterval(id); }, []);

  const [styleId, setStyleId] = useState('scalping');
  const style = STYLE_BY_ID[styleId];
  const [indTab, setIndTab] = useState('Trend');
  const [points, setPoints] = useState(style.objective.points);
  const [maxRisk, setMaxRisk] = useState(style.objective.maxRisk);
  useEffect(() => { setPoints(style.objective.points); setMaxRisk(style.objective.maxRisk); }, [styleId, style.objective.points, style.objective.maxRisk]);

  const candles5m = candlesByTf['5m'] ?? [];
  const qual: Qualification = useMemo(() => qualifyMarket(candles5m) ?? { ...SAMPLE_QUALIFICATION, price: livePrice || SAMPLE_QUALIFICATION.price }, [candles5m, livePrice]);
  const score = qual.readiness;
  const scoreLabel = score >= 90 ? 'Elite' : score >= 75 ? 'Strong' : score >= 60 ? 'Stable' : 'Weak';
  const confidence = clamp(score - 1, 0, 99);

  // Interactive setup preview
  const setup = useMemo(() => {
    const P = qual.price;
    const entryHi = Math.round(P) - 110, entryLo = entryHi - 50;
    const sl = entryLo - maxRisk, tp1 = entryHi + Math.round(points * 0.66), tp2 = entryHi + points;
    return { entryLo, entryHi, sl, tp1, tp2, rr: `1 : ${(points / Math.max(1, maxRisk)).toFixed(1)}`, slPts: -(maxRisk + (entryHi - entryLo + maxRisk - maxRisk)), tp1Pts: tp1 - entryHi, tp2Pts: tp2 - entryHi };
  }, [qual.price, points, maxRisk]);

  const qualGrid = [
    { k: 'Trend Strength (ADX)', v: `${qual.adx}`, sub: qual.adxLabel, ok: qual.adxOk },
    { k: 'Volume', v: qual.volumeLabel, sub: '', ok: qual.volumeOk, big: true },
    { k: 'Momentum (MACD)', v: qual.macdLabel, sub: '', ok: qual.macdOk, big: true },
    { k: 'Volatility (ATR)', v: `${qual.atrPct}%`, sub: qual.atrLabel, ok: qual.atrOk, warn: !qual.atrOk },
    { k: 'RSI (14)', v: `${qual.rsi}`, sub: qual.rsiLabel, ok: qual.rsiOk },
    { k: 'Overall Sentiment', v: qual.sentiment, sub: '', ok: qual.sentiment === 'Bullish', big: true },
  ];

  const sidebarExtra = (
    <div className="overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-b from-accent/15 to-accent/[0.02] p-3 text-center">
      <div className="text-sm font-bold text-ink">MyStack IQ™</div>
      <div className="mt-0.5 text-[10px] font-semibold text-accent">Your Personal Trading Intelligence</div>
      <div className="mt-1.5 text-[10px] leading-snug text-ink-faint">Guides you. Protects you. Makes you consistent.</div>
      <div className="my-3 flex justify-center"><BrainCircuit className="h-12 w-12 text-accent" /></div>
      <button className="focus-ring w-full rounded-lg bg-accent py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90">How MyStack IQ Works</button>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] w-full bg-base text-ink">
      <StackSidebar extra={sidebarExtra} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Global header */}
        <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2">
          <button className="flex items-center gap-1.5 rounded-lg border border-line bg-base px-2.5 py-1.5 text-sm"><Bitcoin className="h-4 w-4 text-regime-hot" /><span className="font-semibold">{symbol}</span><ChevronDown className="h-3.5 w-3.5 text-ink-faint" /></button>
          <span className="font-mono text-lg font-semibold tabular-nums">{fmtN(livePrice)}</span>
          <span className={['font-mono text-sm tabular-nums', tone(change)].join(' ')}>{sgn(change)}{fmtN((livePrice * change) / 100, 2)} ({sgn(change)}{fmtN(change, 2)}%)</span>
          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1.5"><Circle className="h-2 w-2 fill-bull text-bull" /> Market: <span className="font-semibold text-bull-bright">OPEN</span></span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {clock} (UTC)</span>
            <div className="relative"><Bell className="h-4 w-4 text-ink-muted" /><span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bear text-[8px] font-bold text-white">3</span></div>
            <div className="flex items-center gap-2"><div className="h-7 w-7 rounded-full bg-gradient-to-br from-accent to-regime-hot" /><div className="hidden leading-tight sm:block"><div className="text-xs font-semibold text-ink">Ravi Trader</div><div className="text-[10px] text-ink-faint">Elite Trader</div></div></div>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-auto p-3">
          {/* Title + score cards */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#a855f7] text-white shadow-lg shadow-accent/25"><BrainCircuit className="h-5 w-5" /></span>
              <div><h1 className="text-xl font-bold leading-none tracking-tight text-ink">MyStack IQ™</h1><span className="text-xs text-ink-faint">Your Personal Trading Intelligence &amp; Decision Engine</span></div>
            </div>
            <div className="ml-auto flex flex-wrap items-stretch gap-2">
              <ScoreCard label="MyStack IQ Score" value={String(score)} sub={scoreLabel} spark hero />
              <ScoreCard label="Confidence" value={`${confidence}%`} sub="Very High" spark />
              <ScoreCard label="Risk Level" value="Low" sub="Optimal" tint="#26A69A" />
              <ScoreCard label="Discipline Score" value="91/100" sub="Excellent" tint="#6aa6ff" />
              <button className="focus-ring self-center rounded-lg bg-gradient-to-r from-accent to-[#a855f7] px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-accent/20 transition hover:shadow-accent/40">Customize MyStack IQ</button>
            </div>
          </div>

          {/* Step wizard — Trade Readiness Pipeline */}
          <div className="flex items-center gap-1 rounded-xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-2.5">
            {WORKFLOW_STEPS.map((s, i) => {
              const current = 2, done = s.n < current, active = s.n === current;
              return (
                <div key={s.n} className="flex flex-1 items-center gap-2">
                  <span className={['flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition', done ? 'bg-bull text-white' : active ? 'bg-accent text-white ring-4 ring-accent/20' : 'border border-line bg-surface-2 text-ink-faint'].join(' ')} style={active ? { boxShadow: '0 0 12px rgba(106,166,255,0.5)' } : undefined}>{done ? <Check className="h-3.5 w-3.5" /> : s.n}</span>
                  <div className="hidden min-w-0 leading-tight md:block"><div className={['truncate text-[11px] font-semibold', s.n <= current ? 'text-ink' : 'text-ink-faint'].join(' ')}>{s.label}</div><div className="truncate text-[9px] text-ink-faint">{s.sub}</div></div>
                  {i < WORKFLOW_STEPS.length - 1 && <span className={['hidden h-0.5 flex-1 rounded-full lg:block', s.n < current ? 'bg-bull' : 'bg-line'].join(' ')} />}
                </div>
              );
            })}
          </div>

          {/* Main 4-column workflow */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {/* COL A */}
            <div className="space-y-3">
              <Panel n={1} title="WHO ARE YOU TODAY?" subtitle="Choose your trading style">
                <div className="grid grid-cols-2 gap-2">
                  {TRADING_STYLES.map((s) => <StyleCard key={s.id} s={s} active={s.id === styleId} onClick={() => setStyleId(s.id)} />)}
                </div>
                <div className="mt-2 rounded-lg border border-line bg-base/60 p-2 text-[11px]">
                  <div className="flex items-center justify-between"><span className="text-ink-faint">Selected Style</span><span className="font-semibold text-bull-bright">{style.name}</span></div>
                  <div className="mt-1 flex items-center justify-between"><span className="text-ink-faint">Recommended TF</span><span className="font-mono font-semibold text-accent">{style.recommendedTf}</span></div>
                  <div className="mt-1 flex items-center justify-between"><span className="text-ink-faint">Alternative TFs</span><span className="font-mono text-ink-muted">{style.altTfs.map((a) => `${a.tf} (${a.label})`).join(' · ')}</span></div>
                </div>
              </Panel>
              <Panel title={`About ${style.recommendedTf} ${style.name}`}>
                <p className="text-[11px] leading-relaxed text-ink-muted">{style.strategyOverview}</p>
                <ul className="mt-2 space-y-1.5 text-[11px]">
                  <AboutRow k="Typical Hold Time" v={style.about.holdTime} />
                  <AboutRow k="Best Market" v={style.about.bestMarket} />
                  <AboutRow k="Avoid" v={style.about.avoid} />
                  <AboutRow k="Best Session" v={style.about.bestSession} />
                  <AboutRow k="Recommended Risk" v={style.about.recommendedRisk} />
                  <AboutRow k="Recommended Trades / Day" v={style.about.tradesPerDay} />
                </ul>
              </Panel>
            </div>

            {/* COL B */}
            <div className="space-y-3">
              <Panel n={2} title="MARKET QUALIFICATION" badge={`${style.recommendedTf} TF`} action={<span className="text-[10px] text-accent">Why this matters &gt;</span>}>
                <div className="rounded-lg border border-line bg-base/40 p-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-regime-hot">Primary Trend Filter <span className="text-ink-faint">(the most important)</span></div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px]"><span className="h-2 w-2 rounded-full" style={{ background: '#6aa6ff' }} /> 200 EMA <span className="text-ink-faint">(Blue)</span></div>
                  <div className={['mt-1 text-sm font-bold', qual.trendOk ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>PRICE {qual.trendOk ? 'ABOVE' : 'BELOW'} 200 EMA</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px]"><Check className={['h-3.5 w-3.5', qual.trendOk ? 'text-bull-bright' : 'text-bear-bright'].join(' ')} /><span className="font-semibold">{qual.trendLabel}</span><span className="text-ink-faint">{qual.trendBias} {qual.trendOk ? '- No Short Trades' : '- No Long Trades'}</span></div>
                  <QualChart candles={candles5m.slice(-40)} ema200={qual.ema200} price={qual.price} />
                  <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]"><div className="flex justify-between"><span className="text-ink-faint">Current Price:</span><span className="font-mono font-semibold">{fmtN(qual.price)}</span></div><div className="flex justify-between"><span className="text-ink-faint">200 EMA:</span><span className="font-mono font-semibold">{fmtN(qual.ema200)}</span></div></div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">{qualGrid.map((q) => <QualCell key={q.k} {...q} />)}</div>
                <div className="mt-2 rounded-lg border border-bull/30 bg-bull/[0.05] p-2">
                  <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Market Readiness Score</span><span className="font-mono text-lg font-bold text-bull-bright">{qual.readiness}%</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-gradient-to-r from-regime-hot to-bull" style={{ width: `${qual.readiness}%`, boxShadow: '0 0 10px rgba(38,166,154,0.5)' }} /></div>
                  <div className="mt-0.5 flex justify-between text-[8px] text-ink-faint"><span>{qual.readiness >= 90 ? 'Excellent conditions for your selected style.' : 'Conditions for your selected style.'}</span><span>0 · 100</span></div>
                </div>
              </Panel>

              <Panel n={5} title="CREATE MY TRADING SETUP" subtitle="Auto-generate based on all conditions">
                <div className="grid grid-cols-3 gap-3 text-[10px]">
                  <div className="space-y-1">
                    <KV k="Setup Type" v={`${style.objective.trend === 'Bullish' ? 'Long' : style.objective.trend === 'Ranging' ? 'Range' : 'Long'} Setup`} c="text-bull-bright" />
                    <KV k="Trend" v={style.objective.trend} c="text-bull-bright" />
                    <KV k="Entry Style" v={style.objective.entryStyle} c="text-accent" />
                    <KV k="Confidence" v={`${confidence}%`} stars />
                    <KV k="Expected Win Rate" v={`${style.objective.expectedWinRate}%`} />
                    <KV k="Profit Factor (Historical)" v={`${style.objective.profitFactor}`} />
                  </div>
                  <div className="rounded-lg border border-line bg-base/50 p-2">
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink-faint">Risk &amp; Reward Plan</div>
                    <NumRow label="Points to capture" value={points} onChange={setPoints} unit="Points" />
                    <NumRow label="Maximum Risk" value={maxRisk} onChange={setMaxRisk} unit="Points" />
                    <KV k="Risk-Reward Ratio" v={`1 : ${(points / Math.max(1, maxRisk)).toFixed(1)}`} c="text-bull-bright" />
                    <KV k="Account Risk" v={style.objective.accountRisk} />
                    <KV k="Position Size" v={style.objective.positionSize} />
                    <button className="focus-ring mt-1 w-full text-[10px] font-medium text-accent">Recalculate</button>
                  </div>
                  <div className="rounded-lg border border-bull/20 bg-bull/[0.04] p-2">
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-bull-bright">Setup Preview</div>
                    <KV k="Entry Zone" v={`${setup.entryLo} - ${setup.entryHi}`} mono />
                    <KV k="Stop Loss (SL)" v={`${setup.sl}`} mono sub={`(${setup.slPts} Points)`} subBad />
                    <KV k="Take Profit (TP1)" v={`${setup.tp1}`} mono sub={`(+${setup.tp1Pts} Points)`} subGood />
                    <KV k="Take Profit (TP2)" v={`${setup.tp2}`} mono sub={`(+${setup.tp2Pts} Points)`} subGood />
                    <KV k="R:R Overall" v={`1 : ${(points / Math.max(1, maxRisk)).toFixed(1)}`} c="text-bull-bright" />
                    <KV k="Potential Profit" v={`+${points} Points`} c="text-bull-bright" sub={`(+$${Math.round(points * 2)})`} subGood />
                    <KV k="Potential Loss" v={`-${maxRisk} Points`} c="text-bear-bright" sub={`(-$${Math.round(maxRisk * 2)})`} subBad />
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="focus-ring flex-1 rounded-lg bg-accent py-2 text-xs font-semibold text-white transition hover:opacity-90">Save This Setup</button>
                  <button className="focus-ring rounded-lg border border-line px-4 py-2 text-xs text-ink-muted transition hover:bg-surface-2">Reset</button>
                </div>
              </Panel>
            </div>

            {/* COL C */}
            <div className="space-y-3">
              <Panel n={3} title="INDICATOR TOOLKIT" badge={`${style.recommendedTf} TF`} action={<span className="text-[10px] text-accent">Add / Remove / Customize &gt;</span>}>
                <div className="mb-2 flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-base p-0.5 text-[10px]">
                  {INDICATOR_TABS.map((t) => <button key={t} onClick={() => setIndTab(t)} className={['shrink-0 rounded px-2 py-1 font-medium transition', indTab === t ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink'].join(' ')}>{t}</button>)}
                </div>
                <table className="w-full text-left text-[10px]">
                  <thead className="text-[8px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1 font-medium">Indicator</th><th className="py-1 font-medium">Setting</th><th className="py-1 font-medium">Role</th><th className="py-1" /></tr></thead>
                  <tbody>{style.indicators.map((r) => (
                    <tr key={r.name} className="border-t border-line/40">
                      <td className="py-1.5"><span className="inline-flex items-center gap-1.5 font-medium"><span className="h-1.5 w-1.5 rounded-full bg-bull" />{r.name}</span></td>
                      <td className="py-1.5 text-ink-faint">{r.setting}</td>
                      <td className="py-1.5 text-ink-muted">{r.role}</td>
                      <td className="py-1.5"><span className="flex items-center justify-end gap-1.5 text-ink-faint"><Eye className="h-3 w-3" /><Settings2 className="h-3 w-3" /></span></td>
                    </tr>
                  ))}</tbody>
                </table>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button className="focus-ring inline-flex items-center justify-center gap-1 rounded-lg bg-accent/15 py-1.5 text-[10px] font-semibold text-accent transition hover:bg-accent/25"><Plus className="h-3 w-3" /> Add Indicator</button>
                  <button className="focus-ring inline-flex items-center justify-center gap-1 rounded-lg border border-bear/30 py-1.5 text-[10px] font-semibold text-bear-bright transition hover:bg-bear/10"><Trash2 className="h-3 w-3" /> Remove Indicator</button>
                </div>
                <div className="mt-2 flex items-start gap-1.5 text-[9px] text-ink-faint"><Info className="mt-0.5 h-3 w-3 shrink-0 text-accent" /> Tip: Keep it simple. 6-8 indicators work best for {style.name}.</div>
              </Panel>

              <Panel n={6} title="WAIT FOR OPPORTUNITY" subtitle="We will alert you when conditions are met">
                <div className="mb-1 text-[10px]"><span className="text-ink-faint">Current Price</span> <span className="font-mono font-semibold">{fmtN(qual.price)}</span></div>
                <OppChart candles={candles5m.slice(-40)} entryLo={setup.entryLo} entryHi={setup.entryHi} sl={setup.sl} tp1={setup.tp1} tp2={setup.tp2} />
                <div className="mt-2 rounded-lg border border-line bg-base/40 p-2">
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-ink-faint">Setup Status</div>
                  <ul className="space-y-1 text-[10px]">
                    <StatusRow label="Price in Entry Zone" met={false} note=">> 490 mg" />
                    <StatusRow label="Trend Conditions" met />
                    <StatusRow label="Volume Confirmation" met={qual.volumeOk} />
                    <StatusRow label="Momentum Confirmation" met={qual.macdOk} />
                    <StatusRow label="All Conditions" met={false} waiting />
                  </ul>
                </div>
              </Panel>
            </div>

            {/* COL D */}
            <div className="space-y-3">
              <Panel n={4} title="TRADING STRATEGY" subtitle="(Based on Market Scenario)" action={<span className="text-[10px] font-semibold text-bull-bright">{style.strategyName}</span>}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Strategy Overview</div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{style.strategyOverview}</p>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Key Rules</div>
                <ul className="mt-1 space-y-1 text-[11px]">{style.keyRules.map((r) => <li key={r} className="flex items-start gap-1.5 text-ink-muted"><Check className="mt-0.5 h-3 w-3 shrink-0 text-bull-bright" />{r}</li>)}</ul>
                <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2">
                  <span className="text-[11px]"><span className="text-ink-faint">Bias:</span> <span className="font-bold text-bull-bright">{style.bias}</span></span>
                  <span className="text-[10px] font-semibold text-bear-bright">{style.avoidNote}</span>
                </div>
              </Panel>

              <Panel n={7} title="LIVE ALERT & EXECUTION" subtitle="Real-time opportunity & guidance">
                <div className="relative overflow-hidden rounded-lg border border-bull/50 bg-gradient-to-br from-bull/[0.14] to-bull/[0.03] p-2.5 text-center" style={{ boxShadow: '0 0 18px rgba(38,166,154,0.18)' }}>
                  <div className="pointer-events-none absolute inset-x-0 -top-6 h-12 bg-bull/15 blur-2xl" />
                  <div className="relative flex items-center justify-center gap-1.5 text-sm font-bold text-bull-bright"><Zap className="h-4 w-4 fill-bull-bright" /> SETUP ACTIVATED!</div>
                  <div className="relative text-[10px] text-ink-muted">All conditions met. Opportunity is live.</div>
                </div>
                <ul className="mt-2 space-y-1 text-[10px]">
                  <ExecRow k="Direction" v="LONG" c="text-bull-bright" extra={`${setup.entryLo}`} />
                  <ExecRow k="Stop Loss" v={`${setup.sl}`} extra={`(${setup.slPts} Points)`} extraBad />
                  <ExecRow k="Take Profit 1" v={`${setup.tp1}`} extra={`(+${setup.tp1Pts} Points)`} extraGood />
                  <ExecRow k="Risk-Reward" v={`1 : ${(points / Math.max(1, maxRisk)).toFixed(1)}`} extra={style.objective.positionSize} />
                  <ExecRow k="Confidence" v="" stars extra={`${confidence}%`} />
                </ul>
                <button className="focus-ring mt-2 w-full rounded-lg bg-gradient-to-r from-bull to-[#2dd4bf] py-2 text-xs font-bold text-white shadow-lg shadow-bull/30 transition hover:shadow-bull/50">Execute Trade</button>
                <button className="focus-ring mt-1.5 inline-flex w-full items-center justify-center gap-1.5 text-[10px] text-ink-faint transition hover:text-ink"><BellRing className="h-3 w-3" /> Remind me in 30 sec</button>
              </Panel>
            </div>
          </div>

          {/* Bottom row: Management | Performance | Recent */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Panel n={8} title="TRADE MANAGEMENT" subtitle="(After Entry)" footer={<FootLink>View Management Rules</FootLink>}>
              <ul className="space-y-2 text-[11px]">
                <KV k="Trail Method" v={style.management.trailMethod} c="text-bull-bright" row />
                <KV k="Move SL To BE" v={style.management.moveSlToBe} c="text-accent" row />
                <KV k="Partial Profit" v={style.management.partialProfit} c="text-accent" row />
                <KV k="Max Holding Time" v={style.management.maxHoldingTime} c="text-regime-hot" row />
              </ul>
            </Panel>

            <Panel n={10} title="PERFORMANCE WITH THIS STYLE" subtitle={`Your Stats (${style.name} - ${style.recommendedTf})`} footer={<FootLink>View Full Report</FootLink>}>
              <div className="flex items-center gap-3">
                <ul className="flex-1 space-y-1 text-[11px]">
                  <PerfRow k="Win Rate" v={`${style.performance.winRate}%`} bar={style.performance.winRate} />
                  <PerfRow k="Profit Factor" v={`${style.performance.profitFactor}`} bar={Math.min(100, style.performance.profitFactor * 30)} />
                  <PerfRow k="Avg. Win (Points)" v={`${style.performance.avgWin}`} bar={70} />
                  <PerfRow k="Avg. Loss (Points)" v={`${style.performance.avgLoss}`} bar={35} bad />
                  <PerfRow k="Total Trades" v={`${style.performance.trades}`} />
                </ul>
                <WinDonut value={style.performance.winRate} />
              </div>
            </Panel>

            <Panel n={11} title="RECENT TRADES" subtitle="(This Style)" footer={<FootLink>View All Trades</FootLink>}>
              <table className="w-full text-left text-[10px]">
                <thead className="text-[8px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1 font-medium">Date</th><th className="py-1 font-medium">Pair</th><th className="py-1 font-medium">Result</th><th className="py-1 text-right font-medium">Points</th><th className="py-1 text-right font-medium">R:R</th></tr></thead>
                <tbody>{style.recent.map((t, i) => <tr key={i} className="border-t border-line/40"><td className="py-1 text-ink-faint">{t.date}</td><td className="py-1 font-medium">{t.pair}</td><td className={['py-1 font-semibold', t.result === 'Win' ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>{t.result}</td><td className={['py-1 text-right font-mono', tone(t.points)].join(' ')}>{sgn(t.points)}{t.points}</td><td className="py-1 text-right font-mono text-ink-muted">{t.rr}</td></tr>)}</tbody>
              </table>
            </Panel>
          </div>
        </div>

        <footer className="flex items-center gap-4 border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bull" /> {status === 'live' ? 'Live market data' : status}</span>
          <span className="mx-auto hidden italic md:block">MyStack IQ guides you, protects you, and makes you consistent.</span>
          <span className="ml-auto inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-accent" /> The Operating System of MyCryptoStack</span>
        </footer>
      </div>
    </div>
  );
}

// ---- panels / atoms ----
function Panel({ n, title, subtitle, badge, action, footer, children }: { n?: number; title: string; subtitle?: string; badge?: string; action?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-3 transition-colors duration-300 hover:border-line/80">
      <div className="mb-2 flex items-center gap-1.5">
        {n != null && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent ring-1 ring-accent/25">{n}</span>}
        <h3 className="text-[12px] font-bold tracking-wide text-ink">{title}</h3>
        {badge && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">{badge}</span>}
        {subtitle && <span className="text-[9px] text-ink-faint">{subtitle}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="flex-1">{children}</div>
      {footer && <div className="mt-3 border-t border-line/60 pt-2 text-center">{footer}</div>}
    </section>
  );
}
function FootLink({ children }: { children: React.ReactNode }) { return <button className="inline-flex items-center gap-1 text-[11px] font-medium text-accent transition hover:opacity-80">{children}<ArrowRight className="h-3 w-3" /></button>; }
function ScoreCard({ label, value, sub, spark, hero, tint }: { label: string; value: string; sub: string; spark?: boolean; hero?: boolean; tint?: string }) {
  const accent = tint ?? '#26A69A';
  return (
    <div className={['relative min-w-[110px] overflow-hidden rounded-xl border px-3 py-2 transition-colors duration-300', hero ? 'border-accent/40 bg-gradient-to-br from-accent/15 via-surface-1 to-surface-1' : 'border-line bg-gradient-to-b from-surface-1 to-surface-1/50 hover:border-accent/30'].join(' ')}>
      {hero && <div className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-accent/20 blur-2xl" />}
      <div className="text-[9px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xl font-bold" style={{ color: accent, textShadow: `0 0 14px ${accent}40` }}>{value}</span>
        {spark && <MiniSpark color={accent} />}
      </div>
      <div className="text-[9px] font-semibold" style={{ color: accent }}>{sub}</div>
    </div>
  );
}
function MiniSpark({ color = '#26A69A' }: { color?: string }) {
  const pts = [9, 11, 10, 13, 12, 15, 14, 18];
  const W = 40, H = 16, max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1;
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / (pts.length - 1)) * W} ${H - ((p - min) / range) * H}`).join(' ');
  const id = `iqs${color.replace('#', '')}`;
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-4 w-10 shrink-0"><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.4" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs><path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill={`url(#${id})`} /><path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function StyleCard({ s, active, onClick }: { s: TradingStyle; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={['relative overflow-hidden rounded-lg border p-2 text-left transition-colors duration-300', active ? 'border-bull bg-gradient-to-br from-bull/[0.12] to-bull/[0.02]' : 'border-line bg-base/40 hover:border-accent/40 hover:bg-surface-2/40'].join(' ')} style={active ? { boxShadow: '0 0 0 1px rgba(38,166,154,0.35), 0 0 16px rgba(38,166,154,0.12)' } : undefined}>
      {active && <span className="absolute right-1.5 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bull"><Check className="h-2.5 w-2.5 text-white" /></span>}
      <div className="text-sm">{s.emoji}</div>
      <div className="mt-0.5 text-[11px] font-semibold leading-tight text-ink">{s.name}</div>
      <div className="text-[9px] leading-tight text-ink-faint">{s.tagline}</div>
      <div className="mt-1 text-[9px] text-ink-faint">Hold: <span className="text-ink-muted">{s.hold}</span></div>
    </button>
  );
}
function AboutRow({ k, v }: { k: string; v: string }) { return <li className="flex items-start gap-1.5"><Star className="mt-0.5 h-3 w-3 shrink-0 text-regime-hot" /><span className="text-ink-faint">{k}:</span> <span className="ml-auto text-right font-medium text-ink-muted">{v}</span></li>; }
function KV({ k, v, c, sub, subGood, subBad, mono, stars, row }: { k: string; v: string; c?: string; sub?: string; subGood?: boolean; subBad?: boolean; mono?: boolean; stars?: boolean; row?: boolean }) {
  return (
    <div className={['flex items-center justify-between gap-2', row ? 'border-b border-line/40 py-1.5 last:border-0' : 'py-0.5'].join(' ')}>
      <span className="text-ink-faint">{k}</span>
      <span className="flex items-center gap-1 text-right">
        {stars && <span className="inline-flex">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-2.5 w-2.5 fill-regime-hot text-regime-hot" />)}</span>}
        {v && <span className={[mono ? 'font-mono' : '', 'font-semibold', c ?? 'text-ink'].join(' ')}>{v}</span>}
        {sub && <span className={['text-[9px]', subGood ? 'text-bull-bright' : subBad ? 'text-bear-bright' : 'text-ink-faint'].join(' ')}>{sub}</span>}
      </span>
    </div>
  );
}
function NumRow({ label, value, onChange, unit }: { label: string; value: number; onChange: (n: number) => void; unit: string }) {
  return (
    <div className="mb-1">
      <div className="text-[9px] text-ink-faint">{label}</div>
      <div className="flex items-center gap-1 rounded border border-line bg-base px-1.5 py-0.5">
        <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="w-full bg-transparent font-mono text-[11px] font-semibold text-ink outline-none" />
        <span className="text-[9px] text-ink-faint">{unit}</span>
      </div>
    </div>
  );
}
function QualCell({ k, v, sub, ok, warn, big }: { k: string; v: string; sub?: string; ok?: boolean; warn?: boolean; big?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-base/40 p-1.5">
      <div className="text-[8px] uppercase tracking-wider text-ink-faint">{k}</div>
      <div className="flex items-center justify-between">
        <span className={['font-semibold', big ? 'text-[11px]' : 'font-mono text-sm', ok ? 'text-ink' : 'text-bear-bright'].join(' ')}>{v}</span>
        {warn ? <Info className="h-3 w-3 text-regime-hot" /> : <Check className={['h-3 w-3', ok ? 'text-bull-bright' : 'text-ink-faint'].join(' ')} />}
      </div>
      {sub && <div className={['text-[9px]', ok ? 'text-bull-bright' : 'text-regime-hot'].join(' ')}>{sub}</div>}
    </div>
  );
}
function StatusRow({ label, met, note, waiting }: { label: string; met: boolean; note?: string; waiting?: boolean }) {
  return (
    <li className="flex items-center gap-1.5">
      {met ? <Check className="h-3 w-3 text-bull-bright" /> : <X className="h-3 w-3 text-bear-bright" />}
      <span className="text-ink-muted">{label}</span>
      <span className="ml-auto text-[9px]">{note ? <span className="text-ink-faint">{note}</span> : waiting ? <span className="text-regime-hot">Waiting</span> : met ? <span className="text-bull-bright">Met</span> : <span className="text-bear-bright">Not Yet</span>}</span>
    </li>
  );
}
function ExecRow({ k, v, c, extra, extraGood, extraBad, stars }: { k: string; v: string; c?: string; extra?: string; extraGood?: boolean; extraBad?: boolean; stars?: boolean }) {
  return (
    <li className="flex items-center justify-between border-b border-line/30 py-1 last:border-0">
      <span className="text-ink-faint">{k}</span>
      <span className="flex items-center gap-1.5">
        {stars && <span className="inline-flex">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-2.5 w-2.5 fill-regime-hot text-regime-hot" />)}</span>}
        {v && <span className={['font-mono font-semibold', c ?? 'text-ink'].join(' ')}>{v}</span>}
        {extra && <span className={['font-mono text-[9px]', extraGood ? 'text-bull-bright' : extraBad ? 'text-bear-bright' : 'text-ink-faint'].join(' ')}>{extra}</span>}
      </span>
    </li>
  );
}
function PerfRow({ k, v, bar, bad }: { k: string; v: string; bar?: number; bad?: boolean }) {
  return (
    <li>
      <div className="flex items-center justify-between"><span className="text-ink-faint">{k}</span><span className="font-mono font-semibold text-ink">{v}</span></div>
      {bar != null && <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${clamp(bar, 0, 100)}%`, background: bad ? '#f23645' : '#26A69A' }} /></div>}
    </li>
  );
}
function WinDonut({ value }: { value: number }) {
  const v = clamp(value, 0, 100), r = 26, c = 2 * Math.PI * r, dash = (v / 100) * c;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 72 72" className="h-24 w-24 -rotate-90"><circle cx="36" cy="36" r={r} fill="none" stroke="#2a3247" strokeWidth="8" /><circle cx="36" cy="36" r={r} fill="none" stroke="#6aa6ff" strokeWidth="8" strokeDasharray={`${c - dash} ${dash}`} strokeDashoffset={dash} /><circle cx="36" cy="36" r={r} fill="none" stroke="#26A69A" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} /></svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="font-mono text-base font-bold text-ink">{v}%</span><span className="text-[8px] text-ink-faint">Win Rate</span></div>
    </div>
  );
}
function MiniCandles({ candles, lines }: { candles: Candle[]; lines: { y: number; color: string; label?: string; dashed?: boolean }[] }) {
  if (candles.length < 2) return <div className="flex h-[120px] items-center justify-center text-[10px] text-ink-faint">Loading chart…</div>;
  const W = 300, H = 120, pad = 4;
  const extra = lines.map((l) => l.y);
  const hi = Math.max(...candles.map((c) => c.high), ...extra), lo = Math.min(...candles.map((c) => c.low), ...extra), range = hi - lo || 1;
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad), cw = (W - 2 * pad) / candles.length;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[120px] w-full" preserveAspectRatio="none">
        {candles.map((c, i) => { const x = pad + i * cw + cw / 2, up = c.close >= c.open, col = up ? '#26A69A' : '#f23645'; const bt = y(Math.max(c.open, c.close)), bb = y(Math.min(c.open, c.close)); return <g key={i}><line x1={x} y1={y(c.high)} x2={x} y2={y(c.low)} stroke={col} strokeWidth="0.6" opacity="0.85" /><rect x={x - cw * 0.3} y={bt} width={cw * 0.6} height={Math.max(0.6, bb - bt)} fill={col} /></g>; })}
        {lines.map((l, i) => <line key={i} x1={pad} y1={y(l.y)} x2={W - pad} y2={y(l.y)} stroke={l.color} strokeWidth="1" strokeDasharray={l.dashed ? '4 3' : undefined} />)}
      </svg>
      {lines.filter((l) => l.label).map((l, i) => <span key={i} className="absolute right-1 -translate-y-1/2 rounded px-1 text-[8px] font-semibold text-white" style={{ top: `${(y(l.y) / H) * 100}%`, background: l.color }}>{l.label}</span>)}
    </div>
  );
}
function QualChart({ candles, ema200, price }: { candles: Candle[]; ema200: number; price: number }) {
  return <MiniCandles candles={candles} lines={[{ y: ema200, color: '#6aa6ff', label: '200 EMA' }, { y: price, color: '#26A69A', label: fmtN(price) }]} />;
}
function OppChart({ candles, entryLo, entryHi, sl, tp1, tp2 }: { candles: Candle[]; entryLo: number; entryHi: number; sl: number; tp1: number; tp2: number }) {
  return <MiniCandles candles={candles} lines={[{ y: tp2, color: '#26A69A', label: `TP2 ${tp2}`, dashed: true }, { y: tp1, color: '#26A69A', label: `TP1 ${tp1}`, dashed: true }, { y: (entryLo + entryHi) / 2, color: '#6aa6ff', label: 'Entry Zone', dashed: true }, { y: sl, color: '#f23645', label: `SL ${sl}`, dashed: true }]} />;
}
