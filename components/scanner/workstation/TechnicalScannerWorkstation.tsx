'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Archive, BarChart3, Bell, Boxes, CheckCircle2, Clock,
  Copy, GitCompareArrows, Layers, LineChart, Pause, Play, Plus,
  Radar, Save, ScanLine, Settings, Share2, Sparkles, Wand2,
  XCircle,
} from 'lucide-react';
import SmcScreenerPanel from '@/components/scanner/SmcScreenerPanel';
import IntelligenceHome from '@/components/scanner/workstation/IntelligenceHome';
import { walkVdTrades } from '@/lib/indicators/vdEngine';
import { DEFAULT_COMPARE_SYMBOL, type CompareSymbol } from '@/lib/compare';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
import type { ChartType } from '@/components/Chart';
import { Button, Num, Panel, Tab, Tabs, cx } from '@/components/ui';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMarketContext } from '@/lib/hooks/useMarketContext';
import { deriveScannerEvents } from '@/lib/scanner/events';
import { evaluate, snapshotCondition } from '@/lib/scanner/evaluate';
import { generateScannerSignals } from '@/lib/scanner/signals';
import { versionComparison, type StrategyVersionStats } from '@/lib/scanner/analytics';
import { OPERATORS } from '@/lib/scanner/operators';
import { SCANNER_SOURCE_LIST, SCANNER_SOURCES } from '@/lib/scanner/registry';
import { TRADER_STYLES, type TraderStyleId, type TraderStyleProfile } from '@/lib/scanner/styleProfiles';
import { CATEGORY_ORDER, categoryOf } from '@/lib/scanner/sourceCategories';
import { DEFAULT_RISK, estimateCadencePerWeek, lintStrategy, resolveRisk } from '@/lib/scanner/lint';
import { tradesForStrategyVersion } from '@/lib/scanner/analytics';
import BacktestVisual from '@/components/scanner/workstation/BacktestVisual';
import { computeStrategyDna } from '@/lib/scanner/dna';
import { parseCondition } from '@/lib/scanner/dsl';
import type { StrategyRisk } from '@/lib/scanner/types';
import {
  archiveStrategy, createStrategy, listStrategies, saveNewVersion, setStrategyEnabled,
} from '@/lib/scanner/scannerStore';
import { publishScannerSnapshot } from '@/lib/scanner/scannerUiStore';
import { validateStrategy, type ValidationResult } from '@/lib/scanner/validate';
import type {
  Condition, GroupNode, OperatorId, ScannerStrategy, SeriesRef, SourceGroup,
} from '@/lib/scanner/types';
import { isCondition } from '@/lib/scanner/types';
import type { ScannerSnapshot } from '@/lib/scanner/engine';
import type { MarketContext } from '@/lib/context/types';

const ChartPanel = dynamic(() => import('@/components/ChartPanel'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-chart-bg text-xs text-ink-faint">
      Loading live chart...
    </div>
  ),
});

type Lifecycle = 'Draft' | 'Validated' | 'Backtested' | 'Activated' | 'Generating Signals' | 'Archived';
type BottomTab = 'signals' | 'trades' | 'backtest' | 'versions' | 'timeline' | 'why' | 'alerts' | 'performance';

interface Draft {
  id: string | null;
  name: string;
  direction: 'long' | 'short';
  exits: ScannerStrategy['exits'];
  tree: GroupNode;
  note: string;
  /** Trading-style profile driving builder defaults (M2; persisted with DNA in M6). */
  style?: TraderStyleId;
  /** Global timeframe ladder — new conditions inherit `primary` (M3). */
  ladder?: { primary: Timeframe; confirmation: Timeframe; higherTrend: Timeframe };
  /** Risk Studio block (M4). */
  risk: StrategyRisk;
}

interface Template {
  id: string;
  name: string;
  category: string;
  intent: string;
  direction: 'long' | 'short';
  tree: GroupNode;
}

const GROUP_LABEL: Record<SourceGroup, string> = {
  standard: 'Standard',
  structure: 'Structure',
  intelligence: 'Intelligence',
};

const BOTTOM_TABS: Array<{ id: BottomTab; label: string }> = [
  { id: 'signals', label: 'Signals' },
  { id: 'trades', label: 'Trades' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'versions', label: 'Versions' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'why', label: 'Why' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'performance', label: 'Performance' },
];

const defaultParams = (sourceId: string): Record<string, number | string> | undefined => {
  const src = SCANNER_SOURCES[sourceId];
  if (!src || src.params.length === 0) return undefined;
  return Object.fromEntries(src.params.map((p) => [p.id, p.default as number | string]));
};

const cond = (
  source: string,
  op: OperatorId,
  right: SeriesRef | number | [number, number],
  tf: Timeframe = '15m',
  output?: string,
): Condition => ({
  left: {
    source,
    output: output ?? SCANNER_SOURCES[source]?.outputs[0]?.id ?? 'value',
    params: defaultParams(source),
  },
  op,
  right,
  tf,
});

const series = (source: string, output?: string, params?: Record<string, number | string>): SeriesRef => ({
  source,
  output: output ?? SCANNER_SOURCES[source]?.outputs[0]?.id ?? 'value',
  params: params ?? defaultParams(source),
});

const emptyTree = (): GroupNode => ({
  logic: 'AND',
  children: [
    cond('ema', 'crossAbove', series('ema', 'value', { length: 50 }), '15m', 'value'),
    cond('rsi', 'gt', 55, '15m', 'rsi'),
  ],
});

const TEMPLATES: Template[] = [
  {
    id: 'trend-following',
    name: 'EMA Trend Follow',
    category: 'Trend Following',
    intent: 'Catch clean continuation after fast EMA reclaims slow EMA.',
    direction: 'long',
    tree: {
      logic: 'AND',
      children: [
        cond('ema', 'crossAbove', series('ema', 'value', { length: 50 }), '15m', 'value'),
        cond('adx', 'gt', 20, '15m', 'adx'),
      ],
    },
  },
  {
    id: 'momentum-breakout',
    name: 'Momentum Breakout',
    category: 'Momentum',
    intent: 'Require RSI strength and trend score confirmation before entries.',
    direction: 'long',
    tree: {
      logic: 'AND',
      children: [
        cond('rsi', 'gt', 60, '15m', 'rsi'),
        cond('trendScore', 'gt', 70, '15m', 'score'),
        cond('volumeScore', 'gt', 55, '15m', 'score'),
      ],
    },
  },
  {
    id: 'vwap-reclaim',
    name: 'VWAP Reclaim',
    category: 'VWAP',
    intent: 'Trade price reclaiming VWAP with supportive RSI.',
    direction: 'long',
    tree: {
      logic: 'AND',
      children: [
        cond('price', 'crossAbove', series('vwap', 'value'), '15m', 'close'),
        cond('rsi', 'gt', 52, '15m', 'rsi'),
      ],
    },
  },
  {
    id: 'mean-reversion',
    name: 'RSI Mean Reversion',
    category: 'Mean Reversion',
    intent: 'Look for oversold reversions after RSI leaves exhaustion.',
    direction: 'long',
    tree: {
      logic: 'AND',
      children: [
        cond('rsi', 'crossAbove', 35, '15m', 'rsi'),
        cond('bollinger', 'lt', series('price', 'close'), '15m', 'lower'),
      ],
    },
  },
  {
    id: 'stack-score',
    name: 'Stack Score Alignment',
    category: 'Stack Score',
    intent: 'Use MyCryptoStack intelligence scores as the primary filter.',
    direction: 'long',
    tree: {
      logic: 'AND',
      children: [
        cond('stackScore', 'gt', 68, '15m', 'score'),
        cond('alignment', 'gt', 60, '15m', 'score'),
      ],
    },
  },
];

const draftToStrategy = (d: Draft): ScannerStrategy => ({
  id: d.id ?? 'draft',
  name: d.name || 'Untitled Strategy',
  direction: d.direction,
  schemaVersion: 1,
  versions: [{ v: 1, createdAt: 0, note: d.note || 'Draft', tree: d.tree }],
  activeVersion: 1,
  enabled: false,
  archived: false,
  exits: d.exits,
  ownerId: null,
  visibility: 'private',
  createdAt: 0,
  updatedAt: 0,
  parentStrategy: null,
  forkCount: 0,
  likes: 0,
});

function cloneTree(tree: GroupNode): GroupNode {
  return JSON.parse(JSON.stringify(tree)) as GroupNode;
}

function formatAge(ts: number): string {
  if (!ts) return 'Never';
  const delta = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getActiveTree(strategy: ScannerStrategy): GroupNode {
  return strategy.versions.find((v) => v.v === strategy.activeVersion)?.tree ?? strategy.versions[0].tree;
}

function inferLifecycle(strategy: ScannerStrategy | null, validation: ValidationResult, stats?: StrategyVersionStats): Lifecycle {
  if (!strategy) return validation.ok ? 'Validated' : 'Draft';
  if (strategy.archived) return 'Archived';
  if (strategy.enabled && (stats?.signals ?? 0) > 0) return 'Generating Signals';
  if (strategy.enabled) return 'Activated';
  if ((stats?.signals ?? 0) > 0) return 'Backtested';
  return validation.ok ? 'Validated' : 'Draft';
}

function computePreviewSnapshot(
  strategy: ScannerStrategy | null,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
): ScannerSnapshot {
  const candles = candlesByTf[evalTf] ?? [];
  if (!strategy || candles.length < 2) {
    return { evalTf, signals: [], trades: [], events: [], byStrategy: {} };
  }
  const closed = candles.slice(0, candles.length - 1);
  const closedByTf: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, arr] of Object.entries(candlesByTf) as Array<[Timeframe, Candle[]]>) {
    if (arr && arr.length > 1) closedByTf[tf] = arr.slice(0, arr.length - 1);
  }
  const signals = generateScannerSignals(strategy, closedByTf, evalTf, Date.now());
  const trades = walkVdTrades(closed, signals);
  const events = deriveScannerEvents(trades, closed, evalTf);
  return {
    evalTf,
    signals,
    trades,
    events,
    byStrategy: {
      [strategy.id]: { name: strategy.name, chartVisible: true },
    },
  };
}

function latestStats(stats: StrategyVersionStats[]): StrategyVersionStats | undefined {
  return stats[stats.length - 1];
}

export default function TechnicalScannerWorkstation() {
  const [symbol] = useState<CompareSymbol>(DEFAULT_COMPARE_SYMBOL);
  const [selectedTf, setSelectedTf] = useState<Timeframe>('15m');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('signals');
  const [mode, setMode] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [activeStrategyId, setActiveStrategyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showSmcScreener, setShowSmcScreener] = useState(false);
  const [, setRevision] = useState(0);

  const { candlesByTf, status, bookTicker, ticker24h, loadOlder } = useMarketData(symbol);
  const marketContext = useMarketContext(candlesByTf);

  // Saved strategies live in localStorage; render them only after mount so
  // the server and client first paint agree (hydration safety).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const strategies = mounted ? listStrategies().filter((s) => !s.archived) : [];
  const activeSaved = activeStrategyId ? strategies.find((s) => s.id === activeStrategyId) ?? null : null;
  const activeStrategy = draft ? draftToStrategy(draft) : activeSaved;
  const validation = useMemo(
    () => validateStrategy(activeStrategy ?? draftToStrategy(newDraft())),
    [activeStrategy],
  );
  const stats = useMemo(
    () => (activeStrategy ? versionComparison(activeStrategy, candlesByTf, selectedTf) : []),
    [activeStrategy, candlesByTf, selectedTf],
  );
  const activeStats = latestStats(stats);
  const lifecycle = inferLifecycle(activeSaved, validation, activeStats);
  const previewSnapshot = useMemo(
    () => computePreviewSnapshot(activeStrategy, candlesByTf, selectedTf),
    [activeStrategy, candlesByTf, selectedTf],
  );

  useEffect(() => {
    publishScannerSnapshot(previewSnapshot);
  }, [previewSnapshot]);

  const currentCandles = candlesByTf[selectedTf] ?? [];
  const currentPrice = ticker24h?.price ?? currentCandles[currentCandles.length - 1]?.close ?? null;
  const currentChange = ticker24h?.change ?? null;
  const bid = bookTicker?.bid ?? null;
  const ask = bookTicker?.ask ?? null;

  const openNew = useCallback((template?: Template) => {
    setDraft(newDraft(template));
    setActiveStrategyId(null);
  }, []);

  const openStrategy = useCallback((strategy: ScannerStrategy) => {
    setActiveStrategyId(strategy.id);
    setDraft(null);
  }, []);

  const editStrategy = useCallback((strategy: ScannerStrategy) => {
    const version = strategy.versions.find((v) => v.v === strategy.activeVersion) ?? strategy.versions[strategy.versions.length - 1];
    setActiveStrategyId(strategy.id);
    setDraft({
      id: strategy.id,
      name: strategy.name,
      direction: strategy.direction,
      exits: { ...strategy.exits },
      tree: cloneTree(version.tree),
      note: '',
      risk: resolveRisk(strategy.risk),
    });
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const result = draft.id
      ? saveNewVersion(draft.id, draft.tree, draft.note || 'Updated from Strategy Canvas', Date.now(), draft.risk)
      : createStrategy({
          name: draft.name || 'Untitled Strategy',
          direction: draft.direction,
          tree: draft.tree,
          note: draft.note || 'Initial version',
          exits: draft.exits,
          risk: draft.risk,
        });
    if (result.strategy) {
      setActiveStrategyId(result.strategy.id);
      setDraft(null);
      setRevision((r) => r + 1);
    }
  }, [draft]);

  const cloneActive = useCallback(() => {
    if (!activeStrategy) {
      openNew();
      return;
    }
    setDraft({
      id: null,
      name: `${activeStrategy.name} Copy`,
      direction: activeStrategy.direction,
      exits: { ...activeStrategy.exits },
      tree: cloneTree(getActiveTree(activeStrategy)),
      note: 'Cloned strategy',
      risk: resolveRisk(activeStrategy.risk),
    });
    setActiveStrategyId(null);
  }, [activeStrategy, openNew]);

  const toggleActive = useCallback(() => {
    if (!activeSaved) return;
    setStrategyEnabled(activeSaved.id, !activeSaved.enabled);
    setRevision((r) => r + 1);
  }, [activeSaved]);

  const archiveActive = useCallback(() => {
    if (!activeSaved) return;
    archiveStrategy(activeSaved.id);
    setActiveStrategyId(null);
    setDraft(null);
    setRevision((r) => r + 1);
  }, [activeSaved]);

  // One chart instance, docked differently per mode (monitor grid cell vs
  // build-mode proof panel).
  const chartPanel = (
    <ChartPanel
      candles={currentCandles}
      candlesByTf={candlesByTf}
      type={chartType}
      onTypeChange={setChartType}
      selected={selectedTf}
      onSelectTf={setSelectedTf}
      symbol={symbol}
      price={currentPrice}
      change={currentChange}
      status={status}
      showVolume
      bid={bid}
      ask={ask}
      activeIndicatorIds={['scanner_signals']}
      onToggleIndicator={() => {}}
      onClearIndicators={() => {}}
      onLoadOlder={() => { void loadOlder(selectedTf); }}
      gridCount={1}
      onGridChange={() => {}}
      workspaceCurrent={{ chartType, symbol, tf: selectedTf, indicatorIds: ['scanner_signals'] }}
      onWorkspaceApply={() => {}}
    />
  );

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-base text-ink">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-4">
        <Link href="/mycryptostack" className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-ink">
          <ScanLine className="h-4 w-4 text-accent" />
          BTC Strategy Studio
        </Link>
        <span className="rounded-md border border-line bg-base px-2 py-1 font-mono text-[11px] text-ink-muted">{symbol}</span>
        <select
          value={selectedTf}
          onChange={(e) => setSelectedTf(e.target.value as Timeframe)}
          className="focus-ring h-8 rounded-lg border border-line bg-base px-2 text-xs text-ink"
        >
          {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
        </select>
        <span className={cx(
          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
          status === 'live' ? 'bg-bull/15 text-bull-bright' : status === 'loading' ? 'bg-surface-3 text-ink-muted' : 'bg-regime-hot/15 text-regime-hot',
        )}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {status === 'live' ? 'Live' : status === 'loading' ? 'Loading' : 'Demo'}
        </span>

        <button
          type="button"
          onClick={() => setShowSmcScreener((v) => !v)}
          className={cx(
            'focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition',
            showSmcScreener
              ? 'border-accent/40 bg-accent/15 text-accent'
              : 'border-line bg-base text-ink-muted hover:text-ink',
          )}
        >
          <Radar className="h-3.5 w-3.5" />
          SMC Screener
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => openNew()}>New</Button>
          <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={cloneActive}>Clone</Button>
          <Button size="sm" variant="ghost" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={!activeStrategy}>Validate</Button>
          <Button size="sm" variant="ghost" icon={<BarChart3 className="h-3.5 w-3.5" />} disabled={!activeStrategy} onClick={() => setActiveBottomTab('backtest')}>Backtest</Button>
          <Button
            size="sm"
            variant={activeSaved?.enabled ? 'outline' : 'solid'}
            icon={activeSaved?.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            disabled={!activeSaved}
            onClick={toggleActive}
          >
            {activeSaved?.enabled ? 'Pause' : 'Activate'}
          </Button>
          <Button size="sm" variant="ghost" icon={<GitCompareArrows className="h-3.5 w-3.5" />} disabled={!activeStrategy} onClick={() => setActiveBottomTab('versions')}>Compare</Button>
          <Button size="sm" variant="ghost" icon={<Share2 className="h-3.5 w-3.5" />} disabled>Share</Button>
        </div>
      </header>

      {showSmcScreener ? (
        <SmcScreenerPanel candlesByTf={candlesByTf} evalTf={selectedTf} symbol={symbol} />
      ) : draft ? (
        /* BUILD MODE — the builder takes the stage; the chart docks right as
           the strategy's live proof. */
        <BuildMode
          draft={draft}
          onDraft={setDraft}
          validation={validation}
          stats={activeStats}
          preview={previewSnapshot}
          mode={mode}
          onMode={setMode}
          onSave={saveDraft}
          onCancel={() => setDraft(null)}
          onSelectTf={setSelectedTf}
          candlesByTf={candlesByTf}
          evalTf={selectedTf}
          chart={chartPanel}
        />
      ) : !activeStrategy ? (
        <ScannerHome
          strategies={strategies}
          templates={TEMPLATES}
          candlesByTf={candlesByTf}
          evalTf={selectedTf}
          marketContext={marketContext}
          onNew={openNew}
          onOpen={openStrategy}
          onEdit={editStrategy}
          onBuildForMarket={(bias) => {
            const d = newDraft();
            setDraft({ ...d, direction: bias ?? d.direction });
            setActiveStrategyId(null);
          }}
        />
      ) : (
        /* MONITOR MODE — running strategies: chart-dominant grid. */
        <main className="grid min-h-0 flex-1 grid-cols-[230px_minmax(330px,0.9fr)_minmax(420px,1.25fr)_320px] grid-rows-[minmax(0,1fr)_240px] overflow-hidden">
          <StrategySidebar
            strategies={strategies}
            activeId={activeSaved?.id ?? null}
            templates={TEMPLATES}
            onNew={openNew}
            onOpen={openStrategy}
            onEdit={editStrategy}
          />

          <StrategyCanvas
            draft={null}
            strategy={activeSaved}
            validation={validation}
            mode={mode}
            onMode={setMode}
            onDraft={setDraft}
            onEdit={() => activeSaved && editStrategy(activeSaved)}
            onSave={saveDraft}
            candlesByTf={candlesByTf}
          />

          <section className="min-h-0 border-r border-line bg-chart-bg">{chartPanel}</section>

          <StrategyInspector
            strategy={activeStrategy}
            validation={validation}
            lifecycle={lifecycle}
            stats={activeStats}
            marketContext={marketContext}
            candlesByTf={candlesByTf}
            evalTf={selectedTf}
            preview={previewSnapshot}
          />

          <BottomWorkspace
            tab={activeBottomTab}
            onTab={setActiveBottomTab}
            strategy={activeStrategy}
            stats={stats}
            preview={previewSnapshot}
            validation={validation}
            candlesByTf={candlesByTf}
            evalTf={selectedTf}
            onArchive={archiveActive}
          />
        </main>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BUILD MODE (Strategy Studio M2) — the builder takes ~65% of the screen as
// five sections that each answer a trading question; the chart docks right
// as live proof. Beginner mode walks the sections as a stepper; intermediate
// and advanced see one scrollable canvas.
// ─────────────────────────────────────────────────────────────────────────

const BUILD_STEPS = [
  { id: 'style', n: 1, title: 'Style & Market', ask: 'Which trader are you? Your style sets the timeframes, suggested tools and risk defaults.' },
  { id: 'conditions', n: 2, title: 'Conditions', ask: 'When should this strategy fire? Stack the conditions that must be true together.' },
  { id: 'exits', n: 3, title: 'Exits & Risk', ask: 'Where do you take profit, and where do you admit the idea failed?' },
  { id: 'preview', n: 4, title: 'Preview & Validate', ask: 'Can you trust it? How it validates and how it would have performed.' },
  { id: 'save', n: 5, title: 'Save & Activate', ask: 'Name it, pick the direction, and keep a note of what this version changes.' },
] as const;

function BuildMode({
  draft,
  onDraft,
  validation,
  stats,
  preview,
  mode,
  onMode,
  onSave,
  onCancel,
  onSelectTf,
  candlesByTf,
  evalTf,
  chart,
}: {
  draft: Draft;
  onDraft: (draft: Draft) => void;
  validation: ValidationResult;
  stats?: StrategyVersionStats;
  preview: ScannerSnapshot;
  mode: 'beginner' | 'intermediate' | 'advanced';
  onMode: (mode: 'beginner' | 'intermediate' | 'advanced') => void;
  onSave: () => void;
  onCancel: () => void;
  onSelectTf: (tf: Timeframe) => void;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  chart: React.ReactNode;
}) {
  const [step, setStep] = useState(0);
  const stepper = mode === 'beginner';
  const visible = (i: number) => !stepper || step === i;

  const applyStyle = (p: TraderStyleProfile) => {
    onDraft({ ...draft, style: p.id, exits: { ...p.exits }, ladder: { ...p.ladder } });
    onSelectTf(p.ladder.primary);
  };

  return (
    <main className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-[13] flex-col overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-line bg-surface-1 px-5 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Strategy Builder</p>
          {stepper && (
            <nav className="flex items-center gap-1">
              {BUILD_STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(i)}
                  className={cx(
                    'focus-ring rounded-full px-2.5 py-1 text-[11px] transition',
                    i === step ? 'bg-accent/15 text-accent' : i < step ? 'text-ink' : 'text-ink-faint hover:text-ink',
                  )}
                >
                  {s.n}. {s.title}
                </button>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1">
            {(['beginner', 'intermediate', 'advanced'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onMode(m)}
                className={cx(
                  'focus-ring rounded-md px-2 py-1 text-[10px] font-medium capitalize transition',
                  mode === m ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:bg-surface-2 hover:text-ink',
                )}
              >
                {m}
              </button>
            ))}
            <button
              type="button"
              onClick={onCancel}
              className="focus-ring ml-2 rounded-md px-2 py-1 text-[11px] text-ink-faint transition hover:bg-surface-2 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {visible(0) && (
            <BuilderSection step={BUILD_STEPS[0]} stepper={stepper}>
              <StyleCards value={draft.style} onPick={applyStyle} />
            </BuilderSection>
          )}

          {visible(1) && (
            <BuilderSection step={BUILD_STEPS[1]} stepper={stepper}>
              <QuickAdd
                defaultTf={draft.ladder?.primary ?? '15m'}
                onAdd={(condition) => onDraft({ ...draft, tree: { ...draft.tree, children: [...draft.tree.children, condition] } })}
              />
              <div className="mt-2 rounded-xl border border-line bg-surface-1 p-3">
                <GroupCanvas
                  node={draft.tree}
                  editable
                  depth={0}
                  mode={mode}
                  candlesByTf={candlesByTf}
                  ladder={draft.ladder}
                  onChange={(next) => onDraft({ ...draft, tree: next })}
                />
              </div>
            </BuilderSection>
          )}

          {visible(2) && (
            <BuilderSection step={BUILD_STEPS[2]} stepper={stepper}>
              <ExitEditor draft={draft} onDraft={onDraft} />
              {draft.style && (
                <p className="mt-2 text-[11px] text-ink-faint">
                  {TRADER_STYLES.find((s) => s.id === draft.style)?.name} default cadence:{' '}
                  <span className="text-ink-muted">{TRADER_STYLES.find((s) => s.id === draft.style)?.cadence.label}</span>
                </p>
              )}
            </BuilderSection>
          )}

          {visible(3) && (
            <BuilderSection step={BUILD_STEPS[3]} stepper={stepper}>
              <PreviewValidate draft={draft} validation={validation} stats={stats} preview={preview} candlesByTf={candlesByTf} evalTf={evalTf} />
            </BuilderSection>
          )}

          {visible(4) && (
            <BuilderSection step={BUILD_STEPS[4]} stepper={stepper}>
              <div className="grid max-w-xl grid-cols-2 gap-3">
                <label className="col-span-2 block">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Strategy name</span>
                  <input
                    value={draft.name}
                    onChange={(e) => onDraft({ ...draft, name: e.target.value })}
                    placeholder="Name your strategy"
                    className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm font-semibold text-ink"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Direction</span>
                  <select
                    value={draft.direction}
                    onChange={(e) => onDraft({ ...draft, direction: e.target.value as 'long' | 'short' })}
                    className="focus-ring mt-1 h-8 w-full rounded-lg border border-line bg-surface-1 px-2 text-xs text-ink"
                  >
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Version note</span>
                  <input
                    value={draft.note}
                    onChange={(e) => onDraft({ ...draft, note: e.target.value })}
                    className="focus-ring mt-1 h-8 w-full rounded-lg border border-line bg-surface-1 px-2 text-xs text-ink"
                  />
                </label>
                <div className="col-span-2 flex items-center gap-2">
                  <Button variant="solid" icon={<Save className="h-3.5 w-3.5" />} onClick={onSave} disabled={!validation.ok}>
                    {draft.id ? 'Save Version' : 'Save Strategy'}
                  </Button>
                  <span className={cx('text-xs', validation.ok ? 'text-bull-bright' : 'text-bear-bright')}>
                    {validation.ok ? 'Valid strategy' : validation.errors[0]?.message ?? 'Invalid strategy'}
                  </span>
                </div>
              </div>
            </BuilderSection>
          )}

          {stepper && (
            <div className="flex items-center justify-between border-t border-line pt-3">
              <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                ← Back
              </Button>
              <span className="text-[11px] text-ink-faint">Step {step + 1} of {BUILD_STEPS.length}</span>
              <Button
                variant="solid"
                disabled={step === BUILD_STEPS.length - 1}
                onClick={() => setStep((s) => Math.min(BUILD_STEPS.length - 1, s + 1))}
              >
                Next →
              </Button>
            </div>
          )}
        </div>
      </div>

      <section className="min-h-0 min-w-0 flex-[7] border-l border-line bg-chart-bg">{chart}</section>
    </main>
  );
}

function BuilderSection({
  step,
  stepper,
  children,
}: {
  step: (typeof BUILD_STEPS)[number];
  stepper: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2">
        <h3 className="text-[13px] font-semibold text-ink">
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-[11px] text-accent">{step.n}</span>
          {step.title}
        </h3>
        <p className="mt-0.5 text-[12px] text-ink-faint">{step.ask}</p>
      </div>
      {children}
    </section>
  );
}

function StyleCards({ value, onPick }: { value?: TraderStyleId; onPick: (p: TraderStyleProfile) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
      {TRADER_STYLES.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            aria-pressed={active}
            className={cx(
              'focus-ring rounded-xl border p-3 text-left transition',
              active ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2',
            )}
          >
            <p className={cx('text-[13px] font-semibold', active ? 'text-accent' : 'text-ink')}>{p.name}</p>
            <p className="mt-1 text-[11px] leading-snug text-ink-muted">{p.blurb}</p>
            <p className="mt-2 font-mono text-[10px] text-ink-faint">
              {p.ladder.primary} → {p.ladder.confirmation} → {p.ladder.higherTrend} · {p.cadence.label}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function PreviewValidate({
  draft,
  validation,
  stats,
  preview,
  candlesByTf,
  evalTf,
}: {
  draft: Draft;
  validation: ValidationResult;
  stats?: StrategyVersionStats;
  preview: ScannerSnapshot;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
}) {
  const { wouldTrigger, lint, cadence } = useMemo(() => {
    const matches = evaluate(draft.tree, candlesByTf, evalTf);
    const candles = candlesByTf[evalTf] ?? [];
    const cadencePerWeek = estimateCadencePerWeek(matches.map(Boolean), candles);
    return {
      wouldTrigger: matches[matches.length - 1] === true,
      cadence: cadencePerWeek,
      lint: lintStrategy({ tree: draft.tree, style: draft.style, ladder: draft.ladder, cadencePerWeek }),
    };
  }, [draft.tree, draft.style, draft.ladder, candlesByTf, evalTf]);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Strategy Grade — Grammarly for strategies, updating while you build. */}
      <div className="rounded-xl border border-line bg-surface-1 p-3 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Strategy Grade</span>
          <span className={cx(
            'font-mono text-xl font-bold tabular-nums',
            lint.grade >= 85 ? 'text-bull-bright' : lint.grade >= 60 ? 'text-regime-hot' : 'text-bear-bright',
          )}>
            {lint.grade}
          </span>
          {cadence != null && (
            <span className="text-[11px] text-ink-faint">
              fires ~<span className="font-mono text-ink-muted">{cadence < 10 ? cadence.toFixed(1) : cadence.toFixed(0)}</span>x/week historically
            </span>
          )}
          {lint.findings.length === 0 && <span className="text-[11px] text-bull-bright">No issues found.</span>}
        </div>
        {lint.findings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {lint.findings.map((f, i) => (
              <li key={`${f.id}_${i}`} className="flex items-start gap-2 text-[12px]">
                <span className={cx(
                  'mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                  f.severity === 'warn' ? 'bg-regime-hot' : 'bg-ink-faint',
                )} />
                <span className="text-ink-muted">{f.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <InspectorBlock title="Validation" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
        <KV label="Status" value={validation.ok ? 'Valid' : 'Invalid'} tone={validation.ok ? 'bull' : 'bear'} />
        <KV label="Complexity" value={validation.complexity.cost} />
        <KV label="Conditions" value={String(validation.complexity.conditions)} />
        <KV label="Groups" value={String(validation.complexity.groups)} />
        <KV label="Coverage" value={validation.warnings.length ? 'Partial' : '100%'} tone={validation.warnings.length ? 'warn' : 'bull'} />
        {validation.errors.slice(0, 3).map((e, i) => (
          <p key={i} className="mt-1 text-[11px] text-bear-bright">{e.message}</p>
        ))}
        {validation.warnings.slice(0, 3).map((w, i) => (
          <p key={i} className="mt-1 text-[11px] text-regime-hot">{w.message}</p>
        ))}
      </InspectorBlock>

      <InspectorBlock title="How it would have performed" icon={<LineChart className="h-3.5 w-3.5" />}>
        <KV label="Historical matches" valueNode={<Num.Compact value={stats?.signals ?? preview.signals.length} />} />
        <KV label="Win rate" valueNode={<Num.Pct value={stats?.winRate ?? 0} signed={false} precision={0} />} />
        <KV label="Profit factor" valueNode={<Num value={stats?.profitFactor ?? 0} precision={2} />} />
        <KV label="Avg R" valueNode={<Num value={stats?.avgR ?? 0} precision={2} tone />} />
        <KV label="Would trigger today" value={wouldTrigger ? 'Yes' : 'No'} tone={wouldTrigger ? 'bull' : undefined} />
      </InspectorBlock>
    </div>
  );
}

function DnaChip({ children, tone }: { children: React.ReactNode; tone?: 'accent' | 'bull' | 'bear' }) {
  return (
    <span className={cx(
      'rounded-md border px-1.5 py-0.5 text-[9px] font-medium capitalize',
      tone === 'accent' ? 'border-accent/30 text-accent'
        : tone === 'bull' ? 'border-bull/30 text-bull-bright'
          : tone === 'bear' ? 'border-bear/30 text-bear-bright'
            : 'border-line text-ink-muted',
    )}>
      {children}
    </span>
  );
}

/** Quick-Add DSL command bar — type a condition in trader shorthand. */
function QuickAdd({ defaultTf, onAdd }: { defaultTf: Timeframe; onAdd: (c: Condition) => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<{ error: string; hint?: string } | null>(null);

  const submit = () => {
    if (!text.trim()) return;
    const r = parseCondition(text, defaultTf);
    if (r.ok) {
      onAdd(r.condition);
      setText('');
      setErr(null);
    } else {
      setErr({ error: r.error, hint: r.hint });
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Wand2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); if (err) setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="Quick add: RSI(14) > 55 on 15m  ·  EMA20 crosses above EMA50  ·  smc stage >= ready"
            className="focus-ring h-9 w-full rounded-lg border border-line bg-base pl-8 pr-2 text-[12px] text-ink placeholder:text-ink-faint"
            aria-label="Quick add condition"
          />
        </div>
        <Button size="sm" variant="solid" onClick={submit} disabled={!text.trim()}>Add</Button>
      </div>
      {err && (
        <p className="mt-1 text-[11px] text-bear-bright">
          {err.error}{err.hint && <span className="text-ink-faint"> {err.hint}</span>}
        </p>
      )}
    </div>
  );
}

function newDraft(template?: Template): Draft {
  return {
    id: null,
    name: template?.name ?? '',
    direction: template?.direction ?? 'long',
    exits: { slAtr: 1.5, tp1R: 1, tp2R: 2, tp3R: 3 },
    tree: cloneTree(template?.tree ?? emptyTree()),
    note: template ? `Cloned from ${template.name}` : 'Initial version',
    risk: { ...DEFAULT_RISK },
  };
}

function ScannerHome({
  strategies,
  templates,
  candlesByTf,
  evalTf,
  marketContext,
  onNew,
  onOpen,
  onEdit,
  onBuildForMarket,
}: {
  strategies: ScannerStrategy[];
  templates: Template[];
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  marketContext: MarketContext;
  onNew: (template?: Template) => void;
  onOpen: (s: ScannerStrategy) => void;
  onEdit: (s: ScannerStrategy) => void;
  onBuildForMarket: (bias: 'long' | 'short' | null) => void;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <IntelligenceHome
        candlesByTf={candlesByTf}
        evalTf={evalTf}
        marketContext={marketContext}
        onBuildForMarket={onBuildForMarket}
      />
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Strategy Engineering Workstation</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">What would you like to build?</h1>
          </div>
          <Button variant="solid" icon={<Plus className="h-4 w-4" />} onClick={() => onNew()}>Build From Scratch</Button>
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onNew(template)}
              className="focus-ring elev-1 interactive min-h-[138px] rounded-xl p-4 text-left"
            >
              <span className="inline-flex rounded-md bg-accent/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
                {template.category}
              </span>
              <h2 className="mt-3 text-sm font-semibold text-ink">{template.name}</h2>
              <p className="mt-1 text-xs leading-5 text-ink-muted">{template.intent}</p>
            </button>
          ))}
        </section>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Panel title="Continue Editing" action={<span>{strategies.length} saved</span>}>
            {strategies.length === 0 ? (
              <div className="flex min-h-[180px] items-center justify-center text-sm text-ink-muted">
                Create a strategy from a template to start the feedback loop.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {strategies.map((strategy) => (
                  <StrategyCard
                    key={strategy.id}
                    strategy={strategy}
                    stats={latestStats(versionComparison(strategy, candlesByTf, evalTf))}
                    onOpen={() => onOpen(strategy)}
                    onEdit={() => onEdit(strategy)}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Latest Backtests" icon={BarChart3}>
            <div className="space-y-2">
              {strategies.slice(0, 5).map((strategy) => {
                const stats = latestStats(versionComparison(strategy, candlesByTf, evalTf));
                return (
                  <div key={strategy.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-ink">{strategy.name}</span>
                      <span className="font-mono text-[10px] text-ink-faint">v{strategy.activeVersion}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                      <Metric label="Signals" value={<Num.Compact value={stats?.signals ?? 0} />} />
                      <Metric label="Win" value={<Num.Pct value={stats?.winRate ?? 0} signed={false} precision={0} />} />
                      <Metric label="PF" value={<Num value={stats?.profitFactor ?? 0} precision={2} />} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}

function StrategyCard({
  strategy,
  stats,
  onOpen,
  onEdit,
}: {
  strategy: ScannerStrategy;
  stats?: StrategyVersionStats;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const lifecycle = strategy.enabled ? 'LIVE' : stats && stats.signals > 0 ? 'BACKTESTED' : 'DRAFT';
  const dna = useMemo(
    () => computeStrategyDna({ tree: getActiveTree(strategy), direction: strategy.direction, risk: strategy.risk }),
    [strategy],
  );
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="focus-ring min-w-0 rounded text-left">
          <h3 className="truncate text-sm font-semibold text-ink">{strategy.name}</h3>
          <p className="mt-0.5 text-[11px] text-ink-faint">v{strategy.activeVersion} | {strategy.direction}</p>
        </button>
        <span className={cx(
          'rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider',
          strategy.enabled ? 'bg-bull/15 text-bull-bright' : 'bg-surface-3 text-ink-muted',
        )}>
          {lifecycle}
        </span>
      </div>
      {/* Strategy DNA — the automatic identity card. */}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <DnaChip tone="accent">{dna.style}{dna.styleInferred ? '?' : ''}</DnaChip>
        {dna.emphasis.slice(0, 2).map((e) => <DnaChip key={e}>{e}</DnaChip>)}
        <DnaChip tone={dna.riskProfile === 'high' ? 'bear' : dna.riskProfile === 'low' ? 'bull' : undefined}>{dna.riskProfile} risk</DnaChip>
        <DnaChip>{dna.complexity}</DnaChip>
        <span className="ml-auto font-mono text-[11px] tabular-nums" title="Institutional grade">
          <span className={cx(dna.grade >= 85 ? 'text-bull-bright' : dna.grade >= 60 ? 'text-regime-hot' : 'text-bear-bright')}>{dna.grade}</span>
        </span>
      </div>
      <p className="mt-1 text-[10px] text-ink-faint">Holds {dna.holding} · {dna.expectedFrequency}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Win" value={<Num.Pct value={stats?.winRate ?? 0} signed={false} precision={0} />} />
        <Metric label="Signals" value={<Num.Compact value={stats?.signals ?? 0} />} />
        <Metric label="PF" value={<Num value={stats?.profitFactor ?? 0} precision={2} />} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-ink-faint">
        <span>Updated {formatAge(strategy.updatedAt)}</span>
        <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
      </div>
    </div>
  );
}

function StrategySidebar({
  strategies,
  activeId,
  templates,
  onNew,
  onOpen,
  onEdit,
}: {
  strategies: ScannerStrategy[];
  activeId: string | null;
  templates: Template[];
  onNew: (template?: Template) => void;
  onOpen: (s: ScannerStrategy) => void;
  onEdit: (s: ScannerStrategy) => void;
}) {
  return (
    <aside className="row-span-2 min-h-0 border-r border-line bg-surface-1">
      <div className="border-b border-line p-3">
        <Button className="w-full" variant="solid" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onNew()}>New Strategy</Button>
      </div>
      <div className="min-h-0 overflow-y-auto p-3">
        <SidebarSection title="My Strategies" icon={<Boxes className="h-3.5 w-3.5" />}>
          <div className="space-y-1">
            {strategies.map((strategy) => (
              <button
                key={strategy.id}
                type="button"
                onDoubleClick={() => onEdit(strategy)}
                onClick={() => onOpen(strategy)}
                className={cx(
                  'focus-ring flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs transition',
                  activeId === strategy.id ? 'bg-accent/15 text-accent' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                <span className="truncate">{strategy.name}</span>
                <span className="font-mono text-[10px]">v{strategy.activeVersion}</span>
              </button>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title="Templates" icon={<Wand2 className="h-3.5 w-3.5" />}>
          <div className="space-y-1">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onNew(template)}
                className="focus-ring flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs text-ink-muted transition hover:bg-surface-2 hover:text-ink"
              >
                <span>{template.category}</span>
                <Plus className="h-3 w-3" />
              </button>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title="Later" icon={<Settings className="h-3.5 w-3.5" />}>
          <div className="space-y-1 text-xs text-ink-faint">
            <div className="rounded-lg px-2 py-2">Favorites</div>
            <div className="rounded-lg px-2 py-2">Community</div>
            <div className="rounded-lg px-2 py-2">Archived</div>
          </div>
        </SidebarSection>
      </div>
    </aside>
  );
}

function SidebarSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function StrategyCanvas({
  draft,
  strategy,
  validation,
  mode,
  onMode,
  onDraft,
  onEdit,
  onSave,
  candlesByTf,
}: {
  draft: Draft | null;
  strategy: ScannerStrategy | null;
  validation: ValidationResult;
  mode: 'beginner' | 'intermediate' | 'advanced';
  onMode: (mode: 'beginner' | 'intermediate' | 'advanced') => void;
  onDraft: (draft: Draft) => void;
  onEdit: () => void;
  onSave: () => void;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
}) {
  const tree = draft?.tree ?? (strategy ? getActiveTree(strategy) : emptyTree());
  return (
    <section className="min-h-0 overflow-y-auto border-r border-line bg-base p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Strategy Canvas</p>
          {draft ? (
            <input
              value={draft.name}
              onChange={(e) => onDraft({ ...draft, name: e.target.value })}
              placeholder="Name your strategy"
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm font-semibold text-ink"
            />
          ) : (
            <h2 className="mt-1 text-sm font-semibold text-ink">{strategy?.name ?? 'Untitled Strategy'}</h2>
          )}
        </div>
        <div className="flex gap-1">
          {(['beginner', 'intermediate', 'advanced'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={cx(
                'focus-ring rounded-md px-2 py-1 text-[10px] font-medium capitalize transition',
                mode === m ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:bg-surface-2 hover:text-ink',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {draft && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Direction</span>
            <select
              value={draft.direction}
              onChange={(e) => onDraft({ ...draft, direction: e.target.value as 'long' | 'short' })}
              className="focus-ring mt-1 h-8 w-full rounded-lg border border-line bg-surface-1 px-2 text-xs text-ink"
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Version note</span>
            <input
              value={draft.note}
              onChange={(e) => onDraft({ ...draft, note: e.target.value })}
              className="focus-ring mt-1 h-8 w-full rounded-lg border border-line bg-surface-1 px-2 text-xs text-ink"
            />
          </label>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface-1 p-3">
        <GroupCanvas
          node={tree}
          editable={!!draft}
          depth={0}
          mode={mode}
          candlesByTf={candlesByTf}
          onChange={(next) => draft && onDraft({ ...draft, tree: next })}
        />
      </div>

      {mode !== 'beginner' && draft && (
        <ExitEditor draft={draft} onDraft={onDraft} />
      )}

      <div className="mt-3 flex items-center gap-2">
        {draft ? (
          <>
            <Button variant="solid" icon={<Save className="h-3.5 w-3.5" />} onClick={onSave} disabled={!validation.ok}>
              {draft.id ? 'Save Version' : 'Save Strategy'}
            </Button>
            <span className={cx('text-xs', validation.ok ? 'text-bull-bright' : 'text-bear-bright')}>
              {validation.ok ? 'Valid strategy' : validation.errors[0]?.message ?? 'Invalid strategy'}
            </span>
          </>
        ) : (
          <Button icon={<Wand2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit on Canvas</Button>
        )}
      </div>
    </section>
  );
}

function GroupCanvas({
  node,
  editable,
  depth,
  mode,
  candlesByTf,
  ladder,
  onChange,
}: {
  node: GroupNode;
  editable: boolean;
  depth: number;
  mode: 'beginner' | 'intermediate' | 'advanced';
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  ladder?: Draft['ladder'];
  onChange: (node: GroupNode) => void;
}) {
  const setChild = (index: number, child: GroupNode | Condition) =>
    onChange({ ...node, children: node.children.map((c, i) => (i === index ? child : c)) });
  const removeChild = (index: number) =>
    onChange({ ...node, children: node.children.filter((_, i) => i !== index) });

  return (
    <div className={cx(depth > 0 && 'ml-3 border-l border-line pl-3')}>
      <div className="mb-3 flex items-center gap-2">
        {editable ? (
          <select
            value={node.logic}
            onChange={(e) => onChange({ ...node, logic: e.target.value as 'AND' | 'OR' })}
            className="focus-ring rounded-lg border border-line bg-base px-2 py-1 font-mono text-[11px] text-ink"
          >
            <option value="AND">IF ALL OF</option>
            <option value="OR">IF ANY OF</option>
          </select>
        ) : (
          <span className="rounded-lg border border-line bg-base px-2 py-1 font-mono text-[11px] text-ink-muted">
            IF {node.logic === 'AND' ? 'ALL' : 'ANY'} OF
          </span>
        )}
        {editable && (
          <>
            <Button size="sm" variant="ghost" icon={<Plus className="h-3 w-3" />} onClick={() => onChange({ ...node, children: [...node.children, cond('rsi', 'gt', 55, ladder?.primary ?? '15m')] })}>
              Condition
            </Button>
            {mode !== 'beginner' && (
              <Button size="sm" variant="ghost" icon={<Layers className="h-3 w-3" />} onClick={() => onChange({ ...node, children: [...node.children, { logic: 'AND', children: [cond('rsi', 'gt', 55, ladder?.primary ?? '15m')] }] })}>
                Group
              </Button>
            )}
          </>
        )}
      </div>
      <div className="space-y-3">
        {node.children.map((child, index) => (
          <div key={index} className="relative">
            {isCondition(child) ? (
              <ConditionCard
                condition={child}
                editable={editable}
                mode={mode}
                candlesByTf={candlesByTf}
                ladder={ladder}
                onChange={(next) => setChild(index, next)}
                onRemove={() => removeChild(index)}
              />
            ) : (
              <GroupCanvas
                node={child}
                editable={editable}
                depth={depth + 1}
                mode={mode}
                candlesByTf={candlesByTf}
                ladder={ladder}
                onChange={(next) => setChild(index, next)}
              />
            )}
            {index < node.children.length - 1 && (
              <div className="mx-auto mt-2 w-fit rounded-md bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-faint">
                {node.logic}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConditionCard({
  condition,
  editable,
  mode,
  candlesByTf,
  ladder,
  onChange,
  onRemove,
}: {
  condition: Condition;
  editable: boolean;
  mode: 'beginner' | 'intermediate' | 'advanced';
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  ladder?: Draft['ladder'];
  onChange: (condition: Condition) => void;
  onRemove: () => void;
}) {
  const source = SCANNER_SOURCES[condition.left.source];
  const op = OPERATORS[condition.op];
  const snap = useMemo(() => {
    const candles = candlesByTf[condition.tf] ?? [];
    const closed = candles.length > 1 ? candles.slice(0, candles.length - 1) : candles;
    if (closed.length === 0) return null;
    try {
      return snapshotCondition(condition, closed, closed.length - 1);
    } catch {
      return null;
    }
  }, [condition, candlesByTf]);
  const rhs = describeRight(condition.right);

  return (
    <div className={cx(
      'rounded-xl border p-3',
      snap?.pass ? 'border-bull/30 bg-bull/5' : 'border-line bg-base',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
          <RulePill label={source?.name ?? condition.left.source} sub={paramSummary(condition.left.params)} />
          <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-accent">{op?.label ?? condition.op}</span>
          <RulePill label={rhs.label} sub={rhs.sub} />
          <RulePill label={condition.tf} sub="timeframe" />
        </div>
        <div className="flex items-center gap-1">
          <span className={cx(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold',
            snap?.pass ? 'bg-bull/15 text-bull-bright' : 'bg-surface-3 text-ink-muted',
          )}>
            {snap?.pass ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {snap?.pass ? 'TRUE' : 'WAIT'}
          </span>
          {editable && (
            <button type="button" onClick={onRemove} className="focus-ring rounded p-1 text-ink-faint hover:text-bear-bright" aria-label="Remove condition">
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {mode !== 'beginner' && (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/60 pt-3 text-[11px]">
          <Metric label="Current" value={<Num value={snap?.value ?? 0} precision={2} />} />
          <Metric label="Expectation" value={<span className="font-mono text-ink">{snap?.expect ?? 'Waiting'}</span>} />
          <Metric label="Source" value={<span className="text-ink">{GROUP_LABEL[source?.group ?? 'standard']}</span>} />
        </div>
      )}

      {editable && mode !== 'beginner' && (
        <ConditionControls condition={condition} ladder={ladder} onChange={onChange} />
      )}
    </div>
  );
}

function RulePill({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="truncate text-xs font-semibold text-ink">{label}</div>
      {sub && <div className="mt-0.5 truncate font-mono text-[10px] text-ink-faint">{sub}</div>}
    </div>
  );
}

function ConditionControls({ condition, ladder, onChange }: { condition: Condition; ladder?: Draft['ladder']; onChange: (condition: Condition) => void }) {
  const source = SCANNER_SOURCES[condition.left.source];
  const op = OPERATORS[condition.op];
  const rhsIsSeries = typeof condition.right === 'object' && !Array.isArray(condition.right);
  const rhsIsRange = Array.isArray(condition.right);

  const setSource = (id: string) => {
    const nextSource = SCANNER_SOURCES[id];
    const nextOp = nextSource.operators.includes(condition.op) ? condition.op : nextSource.operators[0];
    onChange({
      ...condition,
      left: { source: id, output: nextSource.outputs[0].id, params: defaultParams(id) },
      op: nextOp,
      right: typeof condition.right === 'number' ? condition.right : 50,
    });
  };

  const setOp = (id: OperatorId) => {
    const nextOp = OPERATORS[id];
    let right = condition.right;
    if (nextOp.rhs.includes('range') && !Array.isArray(right)) right = [40, 60];
    if (!nextOp.rhs.includes('range') && Array.isArray(right)) right = 50;
    onChange({ ...condition, op: id, right });
  };

  const control = 'focus-ring h-8 rounded-lg border border-line bg-base px-2 text-[11px] text-ink';

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
      <select value={condition.left.source} onChange={(e) => setSource(e.target.value)} className={control} aria-label="Source">
        {CATEGORY_ORDER.map((cat) => {
          const sources = SCANNER_SOURCE_LIST.filter((s) => categoryOf(s) === cat.id);
          if (sources.length === 0) return null;
          return (
            <optgroup key={cat.id} label={cat.label}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {source?.outputs.length > 1 && (
        <select
          value={condition.left.output}
          onChange={(e) => onChange({ ...condition, left: { ...condition.left, output: e.target.value } })}
          className={control}
          aria-label="Output"
        >
          {source.outputs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
      {source?.params.map((p) => (
        <input
          key={p.id}
          type="number"
          aria-label={p.name}
          title={p.name}
          value={Number(condition.left.params?.[p.id] ?? p.default)}
          min={p.min}
          max={p.max}
          step={p.step}
          onChange={(e) => onChange({ ...condition, left: { ...condition.left, params: { ...condition.left.params, [p.id]: Number(e.target.value) } } })}
          className="focus-ring h-8 w-16 rounded-lg border border-line bg-base px-2 font-mono text-[11px] text-ink"
        />
      ))}
      <select value={condition.op} onChange={(e) => setOp(e.target.value as OperatorId)} className={control} aria-label="Operator">
        {(source?.operators ?? []).map((id) => <option key={id} value={id}>{OPERATORS[id].label}</option>)}
      </select>
      {op?.rhs.includes('number') && !rhsIsSeries && !rhsIsRange && (
        <input
          type="number"
          value={condition.right as number}
          onChange={(e) => onChange({ ...condition, right: Number(e.target.value) })}
          className="focus-ring h-8 w-20 rounded-lg border border-line bg-base px-2 font-mono text-[11px] text-ink"
          aria-label="Value"
        />
      )}
      {ladder && (
        <span className="inline-flex items-center gap-0.5" title="Timeframe ladder: Primary / Confirmation / Higher trend">
          {([['P', ladder.primary], ['C', ladder.confirmation], ['H', ladder.higherTrend]] as const).map(([tag, tf]) => (
            <button
              key={tag}
              type="button"
              onClick={() => onChange({ ...condition, tf })}
              aria-pressed={condition.tf === tf}
              title={`${tag === 'P' ? 'Primary' : tag === 'C' ? 'Confirmation' : 'Higher trend'} · ${tf}`}
              className={cx(
                'focus-ring h-8 rounded-lg border px-1.5 font-mono text-[10px] transition',
                condition.tf === tf ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-base text-ink-faint hover:text-ink',
              )}
            >
              {tag}·{tf}
            </button>
          ))}
        </span>
      )}
      <select value={condition.tf} onChange={(e) => onChange({ ...condition, tf: e.target.value as Timeframe })} className={control} aria-label="Timeframe">
        {(source?.tfs ?? TIMEFRAMES).map((tf) => <option key={tf} value={tf}>{tf}</option>)}
      </select>
    </div>
  );
}

function ExitEditor({ draft, onDraft }: { draft: Draft; onDraft: (draft: Draft) => void }) {
  const riskField = 'focus-ring mt-1 h-8 w-full rounded-lg border border-line bg-base px-2 font-mono text-xs text-ink';
  const setRisk = (patch: Partial<StrategyRisk>) => onDraft({ ...draft, risk: { ...draft.risk, ...patch } });

  return (
    <div className="mt-3 space-y-3">
      {/* Exits: where profit is taken, where the idea is declared wrong. */}
      <div className="grid grid-cols-4 gap-2 rounded-xl border border-line bg-surface-1 p-3">
        {(['slAtr', 'tp1R', 'tp2R', 'tp3R'] as const).map((key) => (
          <label key={key} className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {key === 'slAtr' ? 'Stop (ATR ×)' : `${key.slice(0, 3).toUpperCase()} (R)`}
            </span>
            <input
              type="number"
              step={0.1}
              value={draft.exits[key]}
              onChange={(e) => onDraft({ ...draft, exits: { ...draft.exits, [key]: Number(e.target.value) } })}
              className={riskField}
            />
          </label>
        ))}
      </div>

      {/* Risk Studio: how much can this strategy hurt you on a bad day? */}
      <div className="grid grid-cols-2 items-end gap-2 rounded-xl border border-line bg-surface-1 p-3 sm:grid-cols-5">
        <label className="flex h-8 items-center gap-2">
          <input
            type="checkbox"
            checked={draft.risk.breakEven}
            onChange={(e) => setRisk({ breakEven: e.target.checked })}
            className="h-3.5 w-3.5 accent-accent"
          />
          <span className="text-[11px] text-ink">Break even at TP1</span>
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Trailing (ATR ×)</span>
          <input
            type="number"
            step={0.1}
            min={0}
            value={draft.risk.trailingAtr ?? 0}
            onChange={(e) => setRisk({ trailingAtr: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
            title="0 = off"
            className={riskField}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Risk / trade %</span>
          <input
            type="number"
            step={0.25}
            min={0.1}
            max={10}
            value={draft.risk.positionRiskPct}
            onChange={(e) => setRisk({ positionRiskPct: Number(e.target.value) })}
            className={riskField}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Max daily loss %</span>
          <input
            type="number"
            step={0.5}
            min={0.5}
            max={20}
            value={draft.risk.maxDailyLossPct}
            onChange={(e) => setRisk({ maxDailyLossPct: Number(e.target.value) })}
            className={riskField}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Max trades / day</span>
          <input
            type="number"
            step={1}
            min={1}
            max={100}
            value={draft.risk.maxTradesPerDay}
            onChange={(e) => setRisk({ maxTradesPerDay: Number(e.target.value) })}
            className={riskField}
          />
        </label>
      </div>
    </div>
  );
}

function StrategyInspector({
  strategy,
  validation,
  lifecycle,
  stats,
  marketContext,
  candlesByTf,
  evalTf,
  preview,
}: {
  strategy: ScannerStrategy | null;
  validation: ValidationResult;
  lifecycle: Lifecycle;
  stats?: StrategyVersionStats;
  marketContext: MarketContext;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  preview: ScannerSnapshot;
}) {
  const wouldTrigger = useMemo(() => {
    if (!strategy) return false;
    const matches = evaluate(getActiveTree(strategy), candlesByTf, evalTf);
    return matches[matches.length - 1] === true;
  }, [strategy, candlesByTf, evalTf]);

  return (
    <aside className="min-h-0 overflow-y-auto border-r border-line bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Strategy Inspector</p>
        <span className="rounded-md bg-surface-3 px-2 py-1 text-[10px] text-ink-muted">{lifecycle}</span>
      </div>
      <div className="space-y-3">
        <InspectorBlock title="Validation" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
          <KV label="Status" value={validation.ok ? 'Valid' : 'Invalid'} tone={validation.ok ? 'bull' : 'bear'} />
          <KV label="Complexity" value={validation.complexity.cost} />
          <KV label="Conditions" value={String(validation.complexity.conditions)} />
          <KV label="Groups" value={String(validation.complexity.groups)} />
          <KV label="Coverage" value={validation.warnings.length ? 'Partial' : '100%'} tone={validation.warnings.length ? 'warn' : 'bull'} />
        </InspectorBlock>

        <InspectorBlock title="Market Context" icon={<Activity className="h-3.5 w-3.5" />}>
          <KV label="Market" value={marketContext.overallBias} tone={marketContext.overallBias === 'bullish' ? 'bull' : marketContext.overallBias === 'bearish' ? 'bear' : undefined} />
          <KV label="Trend" valueNode={<Num.Score value={marketContext.trendScore} band />} />
          <KV label="Momentum" valueNode={<Num.Score value={marketContext.momentumScore} band />} />
          <KV label="Volume" valueNode={<Num.Score value={marketContext.volumeScore} band />} />
          <KV label="Stack Score" valueNode={<Num.Score value={marketContext.contextScore} band />} />
          <KV label="Would trigger today" value={wouldTrigger ? 'Yes' : 'No'} tone={wouldTrigger ? 'bull' : undefined} />
        </InspectorBlock>

        <InspectorBlock title="Live Preview" icon={<LineChart className="h-3.5 w-3.5" />}>
          <KV label="Historical matches" valueNode={<Num.Compact value={stats?.signals ?? preview.signals.length} />} />
          <KV label="Win rate" valueNode={<Num.Pct value={stats?.winRate ?? 0} signed={false} precision={0} />} />
          <KV label="Profit factor" valueNode={<Num value={stats?.profitFactor ?? 0} precision={2} />} />
          <KV label="Avg R" valueNode={<Num value={stats?.avgR ?? 0} precision={2} tone />} />
          <KV label="Current state" value={wouldTrigger ? 'Triggered' : 'Waiting'} tone={wouldTrigger ? 'bull' : undefined} />
        </InspectorBlock>
      </div>
    </aside>
  );
}

function BottomWorkspace({
  tab,
  onTab,
  strategy,
  stats,
  preview,
  validation,
  candlesByTf,
  evalTf,
  onArchive,
}: {
  tab: BottomTab;
  onTab: (tab: BottomTab) => void;
  strategy: ScannerStrategy | null;
  stats: StrategyVersionStats[];
  preview: ScannerSnapshot;
  validation: ValidationResult;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  onArchive: () => void;
}) {
  return (
    <section className="col-span-3 min-h-0 border-t border-line bg-surface">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <Tabs value={tab} onChange={(id) => onTab(id as BottomTab)} variant="underline" aria-label="Scanner workspace sections">
            {BOTTOM_TABS.map((item) => <Tab key={item.id} id={item.id}>{item.label}</Tab>)}
          </Tabs>
          <Button size="sm" variant="ghost" icon={<Archive className="h-3.5 w-3.5" />} disabled={!strategy || strategy.id === 'draft'} onClick={onArchive}>Archive</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {tab === 'signals' && <SignalsTab preview={preview} />}
          {tab === 'trades' && <TradesTab preview={preview} />}
          {tab === 'backtest' && <BacktestTab strategy={strategy} stats={stats} candlesByTf={candlesByTf} evalTf={evalTf} />}
          {tab === 'versions' && <VersionsTab stats={stats} strategy={strategy} />}
          {tab === 'timeline' && <TimelineTab preview={preview} strategy={strategy} />}
          {tab === 'why' && <WhyTab preview={preview} validation={validation} />}
          {tab === 'alerts' && <PlaceholderTab icon={<Bell className="h-4 w-4" />} title="Alerts" text="Browser alerts are already supported for live enabled strategies. Alert routing, webhooks, and shared destinations come after workstation review." />}
          {tab === 'performance' && <PerformanceTab stats={latestStats(stats)} />}
        </div>
      </div>
    </section>
  );
}

function SignalsTab({ preview }: { preview: ScannerSnapshot }) {
  const rows = preview.signals.slice(-12).reverse();
  if (rows.length === 0) return <EmptyLine text="No historical matches for the current rule set." />;
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((signal) => (
        <div key={signal.id} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className={cx('text-xs font-semibold', signal.side === 'buy' ? 'text-bull-bright' : 'text-bear-bright')}>{signal.side.toUpperCase()}</span>
            <span className="font-mono text-[10px] text-ink-faint">{new Date(signal.barTime * 1000).toLocaleString()}</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
            <Metric label="Entry" value={<Num.Price value={signal.entry} />} />
            <Metric label="SL" value={<Num.Price value={signal.stopLoss} />} />
            <Metric label="TP1" value={<Num.Price value={signal.tp1} />} />
            <Metric label="Conf" value={<Num.Score value={signal.confidence} band />} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TradesTab({ preview }: { preview: ScannerSnapshot }) {
  const rows = preview.trades.slice(-10).reverse();
  if (rows.length === 0) return <EmptyLine text="No walked trades yet. Add rules with enough resolved history." />;
  return (
    <div className="space-y-2">
      {rows.map((trade) => (
        <div key={trade.signal.id} className="grid grid-cols-6 items-center gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs">
          <span className="font-semibold text-ink">{trade.signal.side.toUpperCase()}</span>
          <Metric label="Entry" value={<Num.Price value={trade.signal.entry} />} />
          <Metric label="R" value={<Num value={trade.realizedR ?? 0} precision={2} tone />} />
          <Metric label="MFE" value={<Num value={trade.mfeR} precision={2} />} />
          <Metric label="MAE" value={<Num value={trade.maeR} precision={2} />} />
          <span className="text-right text-ink-muted">{trade.status}</span>
        </div>
      ))}
    </div>
  );
}

function BacktestTab({
  strategy,
  stats,
  candlesByTf,
  evalTf,
}: {
  strategy: ScannerStrategy | null;
  stats: StrategyVersionStats[];
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
}) {
  const stat = latestStats(stats);
  const trades = useMemo(
    () => (strategy ? tradesForStrategyVersion(strategy, strategy.activeVersion, candlesByTf, evalTf).trades : []),
    [strategy, candlesByTf, evalTf],
  );
  if (!stat) return <EmptyLine text="Select or create a strategy to run a deterministic backtest." />;
  return <BacktestVisual trades={trades} stat={stat} />;
}

function VersionsTab({ stats, strategy }: { stats: StrategyVersionStats[]; strategy: ScannerStrategy | null }) {
  if (!strategy) return <EmptyLine text="Versions appear after a strategy is saved." />;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {stats.map((row, index) => {
        const prev = index > 0 ? stats[index - 1] : null;
        return (
          <div key={row.version} className="rounded-lg border border-line bg-surface-1 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">v{row.version}</span>
              {row.version === strategy.activeVersion && <span className="rounded-md bg-accent/15 px-2 py-1 text-[10px] text-accent">Active</span>}
            </div>
            <p className="mt-1 text-xs text-ink-muted">{row.note || 'No note'}</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <Metric label="Win" value={<Num.Pct value={row.winRate} signed={false} precision={0} />} />
              <Metric label="Signals" value={<Num.Compact value={row.signals} />} />
              <Metric label="PF" value={<Num value={row.profitFactor} precision={2} />} />
              <Metric label="Diff" value={prev ? <Num.Pct value={row.winRate - prev.winRate} precision={0} tone /> : <span className="text-ink-faint">Base</span>} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineTab({ preview, strategy }: { preview: ScannerSnapshot; strategy: ScannerStrategy | null }) {
  const events = preview.events.slice(-12).reverse();
  return (
    <div className="space-y-2">
      {strategy && (
        <TimelineRow icon={<Sparkles className="h-3.5 w-3.5" />} title="Strategy loaded" detail={`${strategy.name} v${strategy.activeVersion}`} />
      )}
      {events.map((event) => (
        <TimelineRow
          key={event.eventId}
          icon={<Clock className="h-3.5 w-3.5" />}
          title={event.eventType}
          detail={new Date(event.barTime * 1000).toLocaleString()}
        />
      ))}
      {!strategy && events.length === 0 && <EmptyLine text="Timeline starts when a strategy produces signals." />}
    </div>
  );
}

function WhyTab({ preview, validation }: { preview: ScannerSnapshot; validation: ValidationResult }) {
  const latest = preview.signals[preview.signals.length - 1];
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="rounded-lg border border-line bg-surface-1 p-3">
        <h3 className="text-xs font-semibold text-ink">Validation Reasons</h3>
        <div className="mt-2 space-y-1 text-xs">
          {validation.errors.map((e, index) => <p key={index} className="text-bear-bright">{e.message}</p>)}
          {validation.warnings.map((w, index) => <p key={index} className="text-regime-hot">{w.message}</p>)}
          {validation.ok && validation.warnings.length === 0 && <p className="text-bull-bright">No validation issues.</p>}
        </div>
      </div>
      <div className="rounded-lg border border-line bg-surface-1 p-3">
        <h3 className="text-xs font-semibold text-ink">Latest Signal Why</h3>
        <div className="mt-2 space-y-2">
          {latest?.why.map((item, index) => (
            <div key={index} className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-2 py-1.5 text-xs">
              <span className="truncate text-ink-muted">{item.label}</span>
              <span className={item.pass ? 'text-bull-bright' : 'text-ink-faint'}>{item.pass ? 'Passed' : 'Failed'}</span>
            </div>
          )) ?? <p className="text-xs text-ink-faint">No signal explanation yet.</p>}
        </div>
      </div>
    </div>
  );
}

function PerformanceTab({ stats }: { stats?: StrategyVersionStats }) {
  if (!stats) return <EmptyLine text="Performance appears after the strategy has enough history." />;
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      <MetricTile label="Wins" value={<Num.Compact value={stats.wins} />} />
      <MetricTile label="Losses" value={<Num.Compact value={stats.losses} />} />
      <MetricTile label="Best Streak" value={<Num.Compact value={stats.bestStreak} />} />
      <MetricTile label="Worst Streak" value={<Num.Compact value={stats.worstStreak} />} />
      <MetricTile label="Avg MFE" value={<Num value={stats.avgMfeR} precision={2} />} />
      <MetricTile label="Avg MAE" value={<Num value={stats.avgMaeR} precision={2} />} />
    </div>
  );
}

function PlaceholderTab({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">{icon}</div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-ink-muted">{text}</p>
      </div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-ink-faint">{text}</div>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-ink">{value}</div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-2 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

function InspectorBlock({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-base p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function KV({
  label,
  value,
  valueNode,
  tone,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  tone?: 'bull' | 'bear' | 'warn';
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-ink-faint">{label}</span>
      <span className={cx(
        'text-right font-medium capitalize text-ink',
        tone === 'bull' && 'text-bull-bright',
        tone === 'bear' && 'text-bear-bright',
        tone === 'warn' && 'text-regime-hot',
      )}>
        {valueNode ?? value}
      </span>
    </div>
  );
}

function TimelineRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">{icon}</span>
      <span className="font-semibold text-ink">{title}</span>
      <span className="ml-auto text-ink-muted">{detail}</span>
    </div>
  );
}

function describeRight(right: Condition['right']): { label: string; sub?: string } {
  if (typeof right === 'number') return { label: String(right), sub: 'value' };
  if (Array.isArray(right)) return { label: `${right[0]} to ${right[1]}`, sub: 'range' };
  return {
    label: SCANNER_SOURCES[right.source]?.name ?? right.source,
    sub: paramSummary(right.params),
  };
}

function paramSummary(params?: Record<string, number | string>): string | undefined {
  if (!params || Object.keys(params).length === 0) return undefined;
  return Object.entries(params).map(([key, value]) => `${key} ${value}`).join(' / ');
}




