'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bitcoin, Info, Bell, Activity, Clock, AlertTriangle, Gauge, Layers, Target, ScanLine,
  ShieldAlert, LogOut, Star, Pause, Play, Trash2, Plus, ChevronRight, CheckCircle2, XCircle,
  Monitor, Send, Mail, MessageSquare, Smartphone, TrendingUp, type LucideIcon,
} from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { computeAlignmentMatrix } from '@/lib/alignment';
import { computeConsensus, computeWeightedScore, detectStructure, computeTimeframeDetails } from '@/lib/multiTimeframe';
import { computeAtr } from '@/lib/indicators/atr';
import { computeStackScoreFactors } from '@/lib/stackScoreFactors';
import { generateTradeSetup, type Side } from '@/lib/tradeSetup';
import {
  alertQualityScore, qualityLabel, evaluateAlert, ALERT_TYPES, CONDITIONS, SEVERITIES,
  type AlertType, type Condition, type Severity, type MarketSnapshot, type TriggeredAlert, type Alert,
} from '@/lib/alertsEngine';
import { useAlertRules, useDelivery, addAlert, removeAlert, toggleAlertStatus, markAlertTriggered, toggleDelivery, type DeliveryMethod } from '@/lib/alertsStore';
import StackSidebar, { type MarketState } from '@/components/stack/StackSidebar';

const FOCUS_TF: Timeframe = '1h';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'LINKUSDT'];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtN = (n: number, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function lastFinite(d: readonly unknown[] | null | undefined): number | null {
  if (!Array.isArray(d)) return null;
  for (let i = d.length - 1; i >= 0; i--) { const x = d[i]; if (x == null) continue; if (typeof x === 'number') { if (Number.isFinite(x)) return x; continue; } if (typeof x === 'object' && 'value' in x) { const v = (x as { value?: number }).value; if (v != null && Number.isFinite(v)) return v; } }
  return null;
}

const SEV_COLOR: Record<Severity, string> = { Opportunity: 'text-bull-bright', Watch: 'text-regime-hot', Action: 'text-accent', Critical: 'text-bear-bright' };
const SEV_BADGE: Record<Severity, string> = { Opportunity: 'bg-bull/15 text-bull-bright', Watch: 'bg-regime-hot/15 text-regime-hot', Action: 'bg-accent/15 text-accent', Critical: 'bg-bear/15 text-bear-bright' };
const TYPE_ICON: Record<AlertType, LucideIcon> = {
  'Stack Score': Gauge, 'MTF Alignment': Layers, 'Trade Setup': Target, Scanner: ScanLine,
  'Market Regime': Activity, 'Risk Alert': ShieldAlert, Exit: LogOut, 'Price Action': TrendingUp, Watchlist: Star,
};
const SUCCESS_BY_TYPE: [string, number][] = [['Stack Score', 78], ['MTF Alignment', 81], ['Trade Setup', 72], ['Scanner Alerts', 75], ['Risk Alerts', 68], ['Price Action', 70], ['Exit Alerts', 76]];

export default function AlertsPage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const { candlesByTf, status } = useMarketData(symbol);
  const { prices } = useMoodEngine(candlesByTf, []);
  const alerts = useAlertRules();
  const delivery = useDelivery();

  const matrix = useMemo(() => computeAlignmentMatrix(candlesByTf, [...TIMEFRAMES]), [candlesByTf]);
  const consensus = useMemo(() => computeConsensus(matrix, [...TIMEFRAMES]), [matrix]);
  const weighted = useMemo(() => computeWeightedScore(matrix, [...TIMEFRAMES]), [matrix]);
  const ready = TIMEFRAMES.some((tf) => (candlesByTf[tf]?.length ?? 0) > 0);
  const price = prices['5m'] ?? prices['1d'] ?? 0;

  const { snap, quality, criteria } = useMemo(() => {
    const focus = candlesByTf[FOCUS_TF] ?? [];
    const details = computeTimeframeDetails(focus);
    const structure = detectStructure(focus);
    const atr = lastFinite(computeAtr(focus).plots[0]?.data) ?? price * 0.004;
    const atrPct = price > 0 ? (atr / price) * 100 : 1;
    const fr = computeStackScoreFactors({ matrix, consensus, structure, details, atrPct, sentiment: weighted.overall, price, tfs: [...TIMEFRAMES] });
    const side: Side = fr.direction === 'sell' ? 'short' : 'long';
    const setup = generateTradeSetup({ price, atr, side, structure, factors: fr.factors, qualityScore: fr.score, consensus, confidence: fr.confidence, regimeState: 'Trending', balance: 10_000, riskPct: 1, leverage: 5 });
    const volumeScore = fr.factors.find((f) => f.key === 'volume')!.score;
    const trendScore = fr.factors.find((f) => f.key === 'trend')!.score;
    const s: MarketSnapshot = { symbol, price, stackScore: fr.score, consensusBull: consensus.bull, consensusTotal: consensus.total, tradeReadiness: setup.execution.score, probability: fr.probability, volumeScore, trendScore, alignmentScore: consensus.pctBull };
    const q = alertQualityScore({ score: fr.score, alignment: consensus.pctBull, volume: volumeScore, probability: fr.probability, trend: trendScore });
    const crit = [
      { label: 'Strong Stack Score', ok: fr.score >= 60 || fr.score <= 40 },
      { label: 'Multi-Timeframe Alignment', ok: Math.abs(consensus.bull - consensus.bear) >= 4 },
      { label: 'Volume Confirmation', ok: volumeScore >= 50 },
      { label: 'Market Regime Match', ok: Math.abs((matrix.sub['1h']?.adx ?? 50) - 50) * 2 > 25 },
      { label: 'High Probability Model', ok: fr.probability >= 50 },
    ];
    return { snap: s, quality: q, criteria: crit };
  }, [candlesByTf, matrix, consensus, weighted, price]);

  // ---- Live evaluation → triggered feed (one interval, refs for latest) ----
  const [feed, setFeed] = useState<TriggeredAlert[]>([]);
  const snapRef = useRef(snap); snapRef.current = snap;
  const alertsRef = useRef(alerts); alertsRef.current = alerts;
  const qualityRef = useRef(quality); qualityRef.current = quality;
  useEffect(() => {
    if (!ready) return;
    const run = () => {
      const now = Date.now();
      const fired: TriggeredAlert[] = [];
      for (const a of alertsRef.current) {
        if (a.status !== 'Active') continue;
        const cd = (a.filters?.cooldownMin ?? 15) * 60_000;
        if (a.lastTriggered && now - a.lastTriggered < cd) continue;
        const r = evaluateAlert(a, { ...snapRef.current, symbol: a.symbol });
        if (r.fires) {
          fired.push({ id: `${a.id}-${now}`, at: now, symbol: a.symbol, type: a.type, severity: a.severity, title: r.title, detail: r.detail, score: a.symbol === symbol ? Math.max(snapRef.current.stackScore, qualityRef.current) : clamp(a.threshold + 5, 60, 99) });
          markAlertTriggered(a.id, now);
        }
      }
      if (fired.length) setFeed((f) => [...fired, ...f].slice(0, 8));
    };
    run();
    const id = setInterval(run, 30_000);
    return () => clearInterval(id);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const sevCount = (s: Severity) => alerts.filter((a) => a.severity === s).length;
  const stats = useMemo(() => ({
    total: alerts.length,
    triggered: feed.length,
    pending: alerts.filter((a) => a.status === 'Active' && !a.lastTriggered).length,
    critical: alerts.filter((a) => a.severity === 'Critical').length,
    successRate: 74,
  }), [alerts, feed]);

  const marketState: MarketState = useMemo(() => ({ state: weighted.outlook === 'neutral' ? 'Transitional' : 'Trending', volatility: 'Medium', volume: snap.volumeScore > 55 ? 'High' : 'Low', energy: quality > 70 ? 'High' : 'Medium' }), [weighted, snap, quality]);

  return (
    <div className="flex min-h-[100dvh] w-full bg-base text-ink">
      <StackSidebar marketState={marketState} fearGreed={weighted.overall} />

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
          <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading market data…</div>
        ) : (
          <div className="flex-1 space-y-3 overflow-auto p-3">
            <div className="flex items-baseline gap-2"><h1 className="text-base font-bold tracking-wide text-accent">ALERTS CENTER</h1><span className="text-xs text-ink-faint">Never miss high-probability opportunities</span></div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard icon={Bell} label="Total Alerts" value={String(stats.total)} sub="Active alerts" tone="accent" />
              <StatCard icon={Activity} label="Triggered Today" value={String(stats.triggered)} sub="this session" tone="bull" />
              <StatCard icon={Clock} label="Pending" value={String(stats.pending)} sub="Waiting to trigger" tone="hot" />
              <StatCard icon={AlertTriangle} label="Critical" value={String(stats.critical)} sub="Requires attention" tone="bear" />
              <StatCard icon={Gauge} label="Success Rate" value={`${stats.successRate}%`} sub="representative" tone="bull" ring={stats.successRate} />
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
              {/* LEFT */}
              <div className="space-y-3">
                <Panel title="Active Alerts">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-ink-faint">
                        <tr><th className="px-2 py-1.5">Asset</th><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Condition</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5">Created</th><th className="px-2 py-1.5">Last</th><th className="px-2 py-1.5 text-right">Actions</th></tr>
                      </thead>
                      <tbody>
                        {alerts.length === 0 ? <tr><td colSpan={7} className="py-4 text-center text-ink-faint">No alerts yet. Build one below.</td></tr> : alerts.map((a) => {
                          const Icon = TYPE_ICON[a.type];
                          return (
                            <tr key={a.id} className="border-t border-line/50 hover:bg-surface-2/30">
                              <td className="px-2 py-2 font-medium">{a.symbol}</td>
                              <td className="px-2 py-2"><span className="inline-flex items-center gap-1.5"><Icon className={['h-3.5 w-3.5', SEV_COLOR[a.severity]].join(' ')} />{a.type}</span></td>
                              <td className="px-2 py-2 text-ink-muted">{a.condition} {a.threshold}</td>
                              <td className="px-2 py-2"><span className={['rounded px-1.5 py-0.5 text-[10px] font-semibold', a.status === 'Active' ? 'bg-bull/15 text-bull-bright' : 'bg-surface-3 text-ink-faint'].join(' ')}>{a.status}</span></td>
                              <td className="px-2 py-2 text-ink-faint">{fmtTime(a.createdAt)}</td>
                              <td className="px-2 py-2 font-mono text-ink-faint">{a.lastTriggered ? fmtTime(a.lastTriggered) : '—'}</td>
                              <td className="px-2 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => toggleAlertStatus(a.id)} title={a.status === 'Active' ? 'Pause' : 'Resume'} className="focus-ring rounded p-1 text-ink-faint transition hover:bg-surface-2 hover:text-ink">{a.status === 'Active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
                                  <button onClick={() => removeAlert(a.id)} title="Delete" className="focus-ring rounded p-1 text-ink-faint transition hover:bg-surface-2 hover:text-bear-bright"><Trash2 className="h-3.5 w-3.5" /></button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                <AlertBuilder symbol={symbol} delivery={delivery} />

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
                  <Panel title="Alert Analytics" hint="representative">
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      <Mini k="Total" v="240" />
                      <Mini k="Triggered" v="178" />
                      <Mini k="Success" v="74%" tone="bull" />
                      <Mini k="Resp. Time" v="2m 34s" />
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-4 border-t border-line pt-2 sm:grid-cols-2">
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Success Rate by Type</div>
                        <div className="space-y-1.5">
                          {SUCCESS_BY_TYPE.map(([k, v]) => (
                            <div key={k} className="flex items-center gap-2 text-[11px]"><span className="w-24 shrink-0 text-ink-muted">{k}</span><div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-bull" style={{ width: `${v}%` }} /></div><span className="w-8 shrink-0 text-right font-mono">{v}%</span></div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Performance Over Time</div>
                        <PerfChart />
                        <div className="mt-1 flex items-center justify-center gap-4 text-[10px] text-ink-faint">
                          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded bg-bull" /> Success Rate</span>
                          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded bg-accent" /> Triggered</span>
                        </div>
                      </div>
                    </div>
                  </Panel>

                  <Panel title="Smart Alert Quality Score">
                    <div className="flex flex-col items-center">
                      <QualityGauge value={quality} />
                      <div className={['text-sm font-bold', quality >= 70 ? 'text-bull-bright' : 'text-regime-hot'].join(' ')}>{qualityLabel(quality)}</div>
                    </div>
                    <ul className="mt-2 space-y-1 border-t border-line pt-2 text-[11px]">
                      {criteria.map((c) => <li key={c.label} className="flex items-center gap-2 text-ink-muted">{c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-bull-bright" /> : <XCircle className="h-3.5 w-3.5 text-bear-bright" />}{c.label}</li>)}
                    </ul>
                  </Panel>
                </div>
              </div>

              {/* RIGHT */}
              <div className="space-y-3">
                <Panel title="Triggered Alerts Feed">
                  {feed.length === 0 ? <p className="py-4 text-center text-xs text-ink-faint">Monitoring… fired alerts appear here.</p> : (
                    <ul className="divide-y divide-line/50">
                      {feed.map((t) => (
                        <li key={t.id} className="flex gap-2 py-2.5 first:pt-0">
                          <span className="mt-0.5 shrink-0 font-mono text-[10px] text-ink-faint">{fmtTime(t.at)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2"><span className="text-xs font-semibold">{t.symbol}</span><span className={['rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', SEV_BADGE[t.severity]].join(' ')}>{t.severity}</span></div>
                            <div className="text-xs text-ink">{t.title}</div>
                            <div className="text-[11px] text-ink-faint">{t.detail}</div>
                          </div>
                          <span className={['shrink-0 self-center rounded px-1.5 py-1 font-mono text-xs font-bold', t.score >= 80 ? 'bg-bull/15 text-bull-bright' : 'bg-regime-hot/15 text-regime-hot'].join(' ')}>{t.score}<span className="text-[9px] text-ink-faint">/100</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title="Alert Categories">
                  <ul className="space-y-1.5">
                    {ALERT_TYPES.map((type) => {
                      const Icon = TYPE_ICON[type];
                      const count = alerts.filter((a) => a.type === type).length;
                      return <li key={type} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-surface-2/40"><Icon className="h-4 w-4 text-accent" /><span className="flex-1">{type}</span><span className="text-ink-faint">{count} Active</span><ChevronRight className="h-3.5 w-3.5 text-ink-faint" /></li>;
                    })}
                  </ul>
                </Panel>

                <Panel title="Delivery Methods">
                  <ul className="space-y-1.5">
                    {([['browser', 'Browser', Monitor], ['telegram', 'Telegram', Send], ['email', 'Email', Mail], ['discord', 'Discord', MessageSquare], ['push', 'Push', Smartphone]] as [DeliveryMethod, string, LucideIcon][]).map(([key, label, Icon]) => (
                      <li key={key} className="flex items-center gap-2 text-xs"><Icon className="h-4 w-4 text-ink-muted" /><span className="flex-1">{label}</span>
                        <button onClick={() => toggleDelivery(key)} className={['focus-ring relative h-4 w-7 rounded-full transition', delivery[key] ? 'bg-bull' : 'bg-surface-3'].join(' ')}><span className={['absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', delivery[key] ? 'left-3.5' : 'left-0.5'].join(' ')} /></button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-2 text-center text-[11px]">
                    <Mini k="Opportunity" v={String(sevCount('Opportunity'))} tone="bull" />
                    <Mini k="Watch" v={String(sevCount('Watch'))} tone="hot" />
                    <Mini k="Action" v={String(sevCount('Action'))} />
                    <Mini k="Critical" v={String(sevCount('Critical'))} tone="bear" />
                  </div>
                </Panel>
              </div>
            </div>
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-line bg-surface-1 px-4 py-2 text-xs text-ink-faint">
          <span>Educational. Alerts evaluate live engine data in your browser session.</span>
          <span className="inline-flex items-center gap-2"><Info className="h-3 w-3" /> Data Source: Binance · {status === 'live' ? 'Connected' : status}</span>
        </footer>
      </div>
    </div>
  );
}

// ---- builder ----
function AlertBuilder({ symbol, delivery }: { symbol: string; delivery: Record<DeliveryMethod, boolean> }) {
  const [asset, setAsset] = useState(symbol);
  const [type, setType] = useState<AlertType>('Stack Score');
  const [condition, setCondition] = useState<Condition>('Greater Than');
  const [threshold, setThreshold] = useState('85');
  const [severity, setSeverity] = useState<Severity>('Opportunity');
  const [tf, setTf] = useState('1H');
  const [regime, setRegime] = useState('Any');
  const [vol, setVol] = useState('Any');
  const [minProb, setMinProb] = useState('Any');
  const [cooldown, setCooldown] = useState('15 Minutes');
  const [done, setDone] = useState(false);

  const create = () => {
    const n = Number(threshold);
    if (!Number.isFinite(n)) return;
    addAlert({
      symbol: asset, type, condition, threshold: n, severity,
      filters: { timeframe: tf, regime, volume: vol, minProbability: minProb === 'Any' ? undefined : Number(minProb.replace('%', '')), cooldownMin: parseInt(cooldown, 10) * (cooldown.includes('Hour') ? 60 : 1) },
    });
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <Panel title="Alert Builder">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field label="Asset"><Select value={asset} onChange={setAsset} options={SYMBOLS} /></Field>
        <Field label="Alert Type"><Select value={type} onChange={(v) => setType(v as AlertType)} options={ALERT_TYPES} /></Field>
        <Field label="Condition"><Select value={condition} onChange={(v) => setCondition(v as Condition)} options={CONDITIONS} /></Field>
        <Field label="Threshold"><input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-base px-2 text-right font-mono text-sm text-ink outline-none focus:border-line-strong" /></Field>
        <Field label="Severity"><Select value={severity} onChange={(v) => setSeverity(v as Severity)} options={SEVERITIES} /></Field>
      </div>

      <div className="mt-3 mb-1 text-[10px] uppercase tracking-wider text-ink-faint">Additional Filters (Optional)</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field label="Timeframe"><Select value={tf} onChange={setTf} options={['5m', '15m', '30m', '1H', '4H', '1D']} /></Field>
        <Field label="Market Regime"><Select value={regime} onChange={setRegime} options={['Any', 'Trending', 'Ranging', 'Volatile']} /></Field>
        <Field label="Volume"><Select value={vol} onChange={setVol} options={['Any', 'Above Average', 'High', 'Low']} /></Field>
        <Field label="Min. Probability"><Select value={minProb} onChange={setMinProb} options={['Any', '50%', '60%', '70%', '80%']} /></Field>
        <Field label="Cooldown"><Select value={cooldown} onChange={setCooldown} options={['5 Minutes', '15 Minutes', '30 Minutes', '1 Hour']} /></Field>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-ink-faint">
          {([['browser', Monitor], ['telegram', Send], ['email', Mail], ['discord', MessageSquare], ['push', Smartphone]] as [DeliveryMethod, LucideIcon][]).map(([k, Icon]) => <Icon key={k} className={['h-4 w-4', delivery[k] ? 'text-accent' : 'text-ink-faint/40'].join(' ')} />)}
        </div>
        <button onClick={create} className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
          {done ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{done ? 'Created' : 'Create Alert'}
        </button>
      </div>
    </Panel>
  );
}

// ---- small components ----
function Panel({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-line bg-surface-1 p-3">{title && <div className="mb-2 flex items-center gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">{title}</h3>{hint && <span className="rounded border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-faint">{hint}</span>}</div>}{children}</section>;
}
function StatCard({ icon: Icon, label, value, sub, tone, ring }: { icon: LucideIcon; label: string; value: string; sub: string; tone: 'accent' | 'bull' | 'hot' | 'bear'; ring?: number }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'hot' ? 'text-regime-hot' : tone === 'bear' ? 'text-bear-bright' : 'text-accent';
  const chip = tone === 'bull' ? 'bg-bull/12' : tone === 'hot' ? 'bg-regime-hot/12' : tone === 'bear' ? 'bg-bear/12' : 'bg-accent/12';
  return (
    <div className={['flex items-center justify-between rounded-xl border bg-surface-1 p-3 transition-colors hover:border-line-strong', tone === 'bear' ? 'border-bear/30' : 'border-line'].join(' ')}>
      <div>
        <div className={['text-[10px] font-semibold uppercase tracking-wider', tone === 'bear' ? 'text-bear-bright' : 'text-ink-faint'].join(' ')}>{label}</div>
        <div className={['font-mono text-3xl font-bold leading-tight', c].join(' ')}>{value}</div>
        <div className="text-[10px] text-ink-faint">{sub}</div>
      </div>
      {ring != null ? <Ring value={ring} /> : <span className={['flex h-10 w-10 items-center justify-center rounded-lg', chip].join(' ')}><Icon className={['h-5 w-5', c].join(' ')} /></span>}
    </div>
  );
}
function Mini({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' | 'hot' }) {
  const c = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : tone === 'hot' ? 'text-regime-hot' : 'text-ink';
  return <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">{k}</div><div className={['font-mono text-sm font-bold', c].join(' ')}>{v}</div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>{children}</label>;
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-base px-2 text-sm text-ink outline-none focus:border-line-strong [color-scheme:dark]">{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
}
function Ring({ value }: { value: number }) {
  const r = 16, c = 2 * Math.PI * r, dash = (clamp(value, 0, 100) / 100) * c;
  return <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90"><circle cx="22" cy="22" r={r} fill="none" stroke="#2a3247" strokeWidth="5" /><circle cx="22" cy="22" r={r} fill="none" stroke="#26A69A" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} /></svg>;
}
function PerfChart() {
  const W = 220, H = 72, pad = 5;
  const success = [72, 68, 75, 74, 70, 78, 74];
  const triggered = [40, 55, 48, 60, 52, 65, 58];
  const x = (i: number) => pad + (i / (success.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - v / 100) * (H - 2 * pad);
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full" preserveAspectRatio="none">
      <line x1={pad} y1={y(50)} x2={W - pad} y2={y(50)} stroke="#2a3247" strokeWidth="0.5" strokeDasharray="3 3" />
      <path d={path(triggered)} fill="none" stroke="#6aa6ff" strokeWidth="1.4" />
      <path d={path(success)} fill="none" stroke="#26A69A" strokeWidth="1.6" />
      {success.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="1.6" fill="#26A69A" />)}
    </svg>
  );
}
function QualityGauge({ value }: { value: number }) {
  const v = clamp(value, 0, 100), angle = -90 + (v / 100) * 180;
  const color = v >= 85 ? '#26A69A' : v >= 70 ? '#9acd32' : v >= 50 ? '#f0a020' : '#f23645';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-36">
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke="#2a3247" strokeWidth="13" strokeLinecap="round" />
        <path d="M15 105 A 85 85 0 0 1 100 20" fill="none" stroke="#f23645" strokeWidth="13" strokeLinecap="round" />
        <path d="M100 20 A 85 85 0 0 1 150 33" fill="none" stroke="#f0a020" strokeWidth="13" />
        <path d="M150 33 A 85 85 0 0 1 185 105" fill="none" stroke="#26A69A" strokeWidth="13" strokeLinecap="round" />
        <g transform={`rotate(${angle} 100 105)`}><line x1="100" y1="105" x2="100" y2="40" stroke="#e9eef7" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="105" r="5" fill="#e9eef7" /></g>
      </svg>
      <div className="-mt-3 font-mono text-2xl font-bold" style={{ color }}>{v}<span className="text-sm text-ink-faint">/100</span></div>
    </div>
  );
}
