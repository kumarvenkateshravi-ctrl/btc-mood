'use client';

// Custom Multi-Timeframe — standalone copy of /multi-timeframe where the four
// configurable indicator rows (Supertrend, RSI, MACD, ADX) open the chart's
// indicator settings card and re-score the matrix through the MTF engine.
// Settings are persisted locally and are fully independent of chart indicator
// settings and of the main MTF page. See
// docs/superpowers/specs/2026-07-17-custom-mtf-page-design.md.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bitcoin, Info, TrendingUp, TrendingDown, Minus, Quote, ChevronRight, Settings2 } from 'lucide-react';
import { TIMEFRAMES, type Timeframe, type Candle } from '@/lib/types';
import { DEFAULT_COMPARE_SYMBOL } from '@/lib/compare';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { computeAlignmentMatrix, type Verdict } from '@/lib/alignment';
import type { IndicatorSettingsMap } from '@/lib/mtf/types';
import type { IndicatorSettings } from '@/lib/indicatorFramework';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import IndicatorSettingsModal from '@/components/trade/IndicatorSettingsModal';
import {
  computeConsensus, computeWeightedScore, computeHeatmap, computeTimeframeDetails,
  detectStructure, buildSummary, type HeatmapRow,
} from '@/lib/multiTimeframe';
import { computeSmc } from '@/lib/smc/engine';
import type { SmcSnapshot } from '@/lib/smc/types';
import { evaluateSmcScreener } from '@/lib/smc/screener';
import { createMarketStructureSnapshot } from '@/lib/mtf/structureEngine';
import { computeBoardDecision } from '@/lib/mtf/board/boardEngine';
import MarketStructureCard from '@/components/mtf/MarketStructureCard';
import {
  BoardDecisionCard, MTFIntelligenceBoard, AgreementConfidencePanel, CategoryStrip, TradeContextCard,
  MarketIntelligenceVerdict, TrendLifecyclePanel, ProbabilityPanel, NarrativeEvidencePanel,
  TradeDecisionPanel, MaFvgSignalCard,
} from '@/components/mtf/MarketIntelligence';
import { useMarketIntelligence } from '@/components/mtf/useMarketIntelligence';
import { useTradeDecision } from '@/components/mtf/useTradeDecision';
import { useMaFvgSignal } from '@/components/mtf/useMaFvgSignal';
import StackSidebar, { type MarketState } from '@/components/stack/StackSidebar';
import ThemeToggle from '@/components/ThemeToggle';
import { Panel } from '@/components/ui';
import { formatNumber, formatPercent } from '@/lib/format';

const TF_LABEL: Record<Timeframe, string> = { '5m': '5M', '15m': '15M', '30m': '30M', '1h': '1H', '4h': '4H', '1d': '1D' };
const fmt = (n: number | null | undefined, d = 1) => formatNumber(n ?? NaN, { precision: d });
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

/** Rows with editable inputs; EMA / Volume / OBV tunables are engine-internal. */
const CONFIGURABLE = new Set(['supertrend', 'rsi', 'macd', 'adx']);
const SETTINGS_KEY = 'custom_mtf_settings';
const STRUCT_TF_KEY = 'custom_mtf_structure_tf';

export default function CustomMultiTimeframePage() {
  const symbol = DEFAULT_COMPARE_SYMBOL;
  const [structTf, setStructTf] = useState<Timeframe>('1h');
  useEffect(() => {
    try {
      const v = localStorage.getItem(STRUCT_TF_KEY) as Timeframe | null;
      if (v && TIMEFRAMES.includes(v)) setStructTf(v);
    } catch { /* storage blocked */ }
  }, []);
  const selectStructTf = (tf: Timeframe) => {
    setStructTf(tf);
    try { localStorage.setItem(STRUCT_TF_KEY, tf); } catch { /* storage blocked */ }
  };

  const { candlesByTf, status, ticker24h } = useMarketData(symbol);
  const { prices, changes } = useMoodEngine(candlesByTf, []);

  // ---- Custom indicator settings (persisted, independent of the chart) ----
  const [indSettings, setIndSettings] = useState<IndicatorSettingsMap>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setIndSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'));
    } catch {
      setIndSettings({});
    }
  }, []);
  const saveSettings = (id: string, s: IndicatorSettings) => {
    setIndSettings((prev) => {
      const next = { ...prev, [id]: s };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage full/blocked */ }
      return next;
    });
  };
  const editingDef = editingId ? CUSTOM_INDICATORS.find((d) => d.id === editingId) : undefined;

  const matrix = useMemo(() => computeAlignmentMatrix(candlesByTf, [...TIMEFRAMES], indSettings), [candlesByTf, indSettings]);
  const consensus = useMemo(() => computeConsensus(matrix, [...TIMEFRAMES]), [matrix]);
  const weighted = useMemo(() => computeWeightedScore(matrix, [...TIMEFRAMES]), [matrix]);
  // ---- MTF Board (Arch v2.1) — the sole direction authority, built from the
  // page's own alignment grid with EXECUTION-PRIMARY weighting (5m/15m/30m decide
  // direction; higher TFs are context), never from the M0-M9 stack ----
  const board = useMemo(
    () => computeBoardDecision(matrix, candlesByTf),
    [matrix, candlesByTf],
  );
  const heatmap = useMemo(() => computeHeatmap(matrix, candlesByTf, [...TIMEFRAMES]), [matrix, candlesByTf]);
  const summary = useMemo(() => buildSummary(matrix, weighted), [matrix, weighted]);
  const details = useMemo(() => computeTimeframeDetails(candlesByTf[structTf] ?? []), [candlesByTf, structTf]);
  const structure = useMemo(() => detectStructure(candlesByTf[structTf] ?? []), [candlesByTf, structTf]);

  // ---- Market Structure Engine (closed-bar SMC, cached per TF on last closed bar) ----
  const smcCacheRef = useRef<Map<Timeframe, { key: number; smc: SmcSnapshot }>>(new Map());
  const structCacheHitRef = useRef(false);
  const smcByTf = useMemo(() => {
    const out: Partial<Record<Timeframe, SmcSnapshot>> = {};
    for (const tf of TIMEFRAMES) {
      const arr = candlesByTf[tf];
      if (!arr || arr.length < 2) continue;
      const closed = arr.slice(0, -1); // last bar is still forming
      const key = closed[closed.length - 1].time;
      const cached = smcCacheRef.current.get(tf);
      if (cached?.key === key) {
        out[tf] = cached.smc;
        if (tf === structTf) structCacheHitRef.current = true;
      } else {
        const smc = computeSmc(closed);
        smcCacheRef.current.set(tf, { key, smc });
        out[tf] = smc;
        if (tf === structTf) structCacheHitRef.current = false;
      }
    }
    return out;
  }, [candlesByTf, structTf]);

  // Current Phase from the SMC screener, keyed on closed bars (never recomputes on ticks).
  const screenerRef = useRef<{ key: string; phase: string } | null>(null);
  const phaseLabel = useMemo(() => {
    const closed: Partial<Record<Timeframe, Candle[]>> = {};
    const keyParts: string[] = [structTf];
    for (const tf of TIMEFRAMES) {
      const arr = candlesByTf[tf];
      if (arr && arr.length > 1) {
        closed[tf] = arr.slice(0, -1);
        keyParts.push(`${tf}:${arr[arr.length - 2].time}`);
      }
    }
    if (!closed[structTf]) return null;
    const key = keyParts.join('|');
    if (screenerRef.current?.key === key) return screenerRef.current.phase;
    const phase = evaluateSmcScreener(closed, structTf).currentPhase;
    screenerRef.current = { key, phase };
    return phase;
  }, [candlesByTf, structTf]);

  const structureSnapshot = useMemo(() => {
    const smc = smcByTf[structTf];
    const arr = candlesByTf[structTf];
    if (!smc || !arr || arr.length < 2) return null;
    const perTf = TIMEFRAMES.filter((tf) => smcByTf[tf]).map((tf) => ({
      timeframe: tf,
      events: smcByTf[tf]!.events,
      barsProcessed: smcByTf[tf]!.diagnostics.barsProcessed,
    }));
    return createMarketStructureSnapshot({
      smc, candles: arr.slice(0, -1), symbol, timeframe: structTf, perTf, phaseLabel,
    });
  }, [smcByTf, candlesByTf, structTf, symbol, phaseLabel]);

  // ---- Market Intelligence (M2–M5), memoized on the closed-bar signature ----
  const intel = useMarketIntelligence(candlesByTf, structTf);

  // ---- M9 Trade Decision (Phase 1c) — SMC confluence toggleable for live comparison ----
  const [smcOn, setSmcOn] = useState(true);
  const tradeDecision = useTradeDecision(board, intel.full, candlesByTf, smcByTf, smcOn);
  const maFvgSignal = useMaFvgSignal(candlesByTf, intel.full, smcByTf);

  const ready = TIMEFRAMES.some((tf) => (candlesByTf[tf]?.length ?? 0) > 0);
  const price = ticker24h ? ticker24h.price : (prices['5m'] ?? prices['1d'] ?? 0);
  const change = ticker24h ? ticker24h.change : (changes['1d'] ?? 0);
  // Absolute 24h move derived from the % change (price/change already
  // prefer the live ticker when present).
  const priceAbs = change != null && change !== -100 ? (price * change) / (100 + change) : 0;

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
    const regime = adxDir > 50 && agree > 0.6 ? 'Trending' : adxDir > 25 ? 'Volatile' : 'Ranging';
    const volSub = TIMEFRAMES.reduce((s, tf) => s + (matrix.sub[tf]?.volume ?? 50), 0) / TIMEFRAMES.length;
    const volatility = heatmap[4].cells['1h'] === 'bearish' ? 'High' : heatmap[4].cells['1h'] === 'bullish' ? 'Low' : 'Moderate';
    const liquidity = volSub > 60 ? 'Deep' : volSub > 45 ? 'Normal' : 'Thin';
    return { regime, volatility, liquidity };
  }, [matrix, consensus, heatmap]);

  const overallVerdictLabel = consensus.overall === 'bullish' ? 'Bullish' : consensus.overall === 'bearish' ? 'Bearish' : 'Neutral';

  return (
    <div className="flex min-h-[100dvh] w-full bg-base text-ink">
      <StackSidebar marketState={marketState} fearGreed={weighted.overall} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-50 flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-1.5">
            <Bitcoin className="h-4 w-4 text-regime-hot" /><span className="font-semibold">{symbol}</span>
          </div>
          <span className="font-mono text-lg font-semibold tabular-nums">{fmt(price, 2)}</span>
          <span className={['font-mono text-sm tabular-nums', change >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>
            {change >= 0 ? '+' : ''}{fmt(priceAbs, 2)} ({formatPercent(change)})
          </span>
          <div className="ml-2 flex items-center gap-1 rounded-lg border border-line bg-base p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button key={tf} onClick={() => selectStructTf(tf)}
                className={['rounded px-2.5 py-1 text-xs font-medium transition', structTf === tf ? 'bg-accent/20 text-accent' : 'text-ink-muted hover:text-ink'].join(' ')}>
                {TF_LABEL[tf]}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint"><ThemeToggle />
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
                  <h2 className="text-sm font-semibold tracking-wide text-accent">CUSTOM MULTI-TIMEFRAME ANALYSIS</h2>
                  <span className="text-[11px] text-ink-faint">Click Supertrend, RSI, MACD or ADX to tune its parameters</span>
                </div>
                <MatrixTable matrix={matrix} onConfigure={setEditingId} />
              </Panel>

              <MaFvgSignalCard signal={maFvgSignal} />

              {intel.full.layers.snapshots.length > 0 && (
                <>
                  <BoardDecisionCard board={board} />
                  {intel.selected && (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <CategoryStrip categories={intel.selected.categories} />
                      <AgreementConfidencePanel
                        agreement={intel.selected.agreement}
                        confidence={intel.selected.confidence}
                        timeframe={intel.selected.timeframe}
                      />
                    </div>
                  )}
                  <MTFIntelligenceBoard hierarchy={intel.crossTf.layers.hierarchy} />
                  <TradeContextCard context={intel.tradeContext} />
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <TrendLifecyclePanel lifecycle={intel.full.layers.lifecycle} />
                    <ProbabilityPanel probability={intel.full.layers.probability} />
                  </div>
                  <MarketIntelligenceVerdict result={intel.full.result} />
                  <NarrativeEvidencePanel result={intel.full.result} />
                  <TradeDecisionPanel
                    decision={tradeDecision.decision}
                    signal={tradeDecision.signal}
                    recent={tradeDecision.recent}
                    smcEnabled={smcOn}
                    onToggleSmc={() => setSmcOn((v) => !v)}
                  />
                </>
              )}

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_3fr]">
                <Panel eyebrow title="Timeframe Heatmap"><Heatmap rows={heatmap} /></Panel>
                <Panel eyebrow title={`Timeframe Details (${TF_LABEL[structTf]})`}><Details d={details} /></Panel>
              </div>

              <Panel eyebrow title="Timeframe Summary">
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

              {structureSnapshot && (
                <MarketStructureCard
                  snapshot={structureSnapshot}
                  cacheHit={structCacheHitRef.current}
                  tfOptions={[...TIMEFRAMES]}
                  selectedTf={structTf}
                  onSelectTf={selectStructTf}
                />
              )}
            </div>

            {/* ===== RIGHT (consensus / persistence / structure / weighted) ===== */}
            <div className="space-y-3">
              <Panel eyebrow title="Timeframe Consensus">
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

              <Panel eyebrow title="Alignment Persistence" badge="time in current bias">
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

              <Panel eyebrow title="Market Structure View">
                <div className="mb-2 flex items-center gap-1 rounded-lg border border-line bg-base p-0.5">
                  {TIMEFRAMES.map((tf) => (
                    <button key={tf} onClick={() => selectStructTf(tf)}
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

              <Panel eyebrow title="Timeframe Weighted Score" badge="spec weights">
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

      {/* Indicator settings card (same one the chart uses); Inputs only. */}
      {editingId && editingDef && (
        <div className="fixed inset-0 z-50">
          <IndicatorSettingsModal
            indicatorDef={editingDef}
            initialSettings={indSettings[editingId]}
            tabs={['Inputs']}
            onClose={() => setEditingId(null)}
            onSave={(s) => saveSettings(editingId, s)}
          />
        </div>
      )}
    </div>
  );
}

// ---- panels ----

function MatrixTable({ matrix, onConfigure }: { matrix: ReturnType<typeof computeAlignmentMatrix>; onConfigure: (id: string) => void }) {
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
          {matrix.rows.map((row) => {
            const configurable = CONFIGURABLE.has(row.key);
            return (
              <tr key={row.key} className="group">
                <td className="border-b border-line/50 px-3 py-2 transition-colors group-hover:bg-surface-2/30">
                  {configurable ? (
                    <button
                      onClick={() => onConfigure(row.key)}
                      title={`Configure ${row.label}`}
                      className="focus-ring -mx-1 flex w-full items-center justify-between gap-2 rounded px-1 text-left transition-colors hover:text-accent"
                    >
                      <span>
                        <span className="block font-medium text-ink group-hover:text-accent">{row.label}</span>
                        <span className="block text-[10px] text-ink-faint">{row.sub}</span>
                      </span>
                      <Settings2 className="h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ) : (
                    <>
                      <div className="font-medium text-ink">{row.label}</div>
                      <div className="text-[10px] text-ink-faint">{row.sub}</div>
                    </>
                  )}
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
            );
          })}
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
      <DetailCol title="Volume" verdict={d.volume.verdict} rows={[['Volume', fmt(d.volume.current, 0)], ['SMA 20', fmt(d.volume.sma20, 0)], ['vs SMA', d.volume.vsPct == null ? '—' : formatPercent(d.volume.vsPct, { precision: 0 })]]} />
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
