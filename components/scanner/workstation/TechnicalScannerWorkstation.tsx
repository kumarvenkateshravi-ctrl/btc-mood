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

  const strategies = listStrategies().filter((s) => !s.archived);
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
    });
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const result = draft.id
      ? saveNewVersion(draft.id, draft.tree, draft.note || 'Updated from Strategy Canvas')
      : createStrategy({
          name: draft.name || 'Untitled Strategy',
          direction: draft.direction,
          tree: draft.tree,
          note: draft.note || 'Initial version',
          exits: draft.exits,
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

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-base text-ink">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-4">
        <Link href="/mycryptostack" className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-ink">
          <ScanLine className="h-4 w-4 text-accent" />
          Technical Scanner
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
      ) : !activeStrategy && !draft ? (
        <ScannerHome
          strategies={strategies}
          templates={TEMPLATES}
          candlesByTf={candlesByTf}
          evalTf={selectedTf}
          onNew={openNew}
          onOpen={openStrategy}
          onEdit={editStrategy}
        />
      ) : (
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
            draft={draft}
            strategy={activeSaved}
            validation={validation}
            mode={mode}
            onMode={setMode}
            onDraft={setDraft}
            onEdit={() => activeSaved && editStrategy(activeSaved)}
            onSave={saveDraft}
            candlesByTf={candlesByTf}
          />

          <section className="min-h-0 border-r border-line bg-chart-bg">
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
          </section>

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
            onArchive={archiveActive}
          />
        </main>
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
  };
}

function ScannerHome({
  strategies,
  templates,
  candlesByTf,
  evalTf,
  onNew,
  onOpen,
  onEdit,
}: {
  strategies: ScannerStrategy[];
  templates: Template[];
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  onNew: (template?: Template) => void;
  onOpen: (s: ScannerStrategy) => void;
  onEdit: (s: ScannerStrategy) => void;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
      <div className="mt-4 grid grid-cols-3 gap-2">
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
  onChange,
}: {
  node: GroupNode;
  editable: boolean;
  depth: number;
  mode: 'beginner' | 'intermediate' | 'advanced';
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
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
            <Button size="sm" variant="ghost" icon={<Plus className="h-3 w-3" />} onClick={() => onChange({ ...node, children: [...node.children, cond('rsi', 'gt', 55)] })}>
              Condition
            </Button>
            {mode !== 'beginner' && (
              <Button size="sm" variant="ghost" icon={<Layers className="h-3 w-3" />} onClick={() => onChange({ ...node, children: [...node.children, { logic: 'AND', children: [cond('rsi', 'gt', 55)] }] })}>
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
  onChange,
  onRemove,
}: {
  condition: Condition;
  editable: boolean;
  mode: 'beginner' | 'intermediate' | 'advanced';
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
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
        <ConditionControls condition={condition} onChange={onChange} />
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

function ConditionControls({ condition, onChange }: { condition: Condition; onChange: (condition: Condition) => void }) {
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
        {(['standard', 'structure', 'intelligence'] as SourceGroup[]).map((group) => (
          <optgroup key={group} label={GROUP_LABEL[group]}>
            {SCANNER_SOURCE_LIST.filter((s) => s.group === group).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </optgroup>
        ))}
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
      <select value={condition.tf} onChange={(e) => onChange({ ...condition, tf: e.target.value as Timeframe })} className={control} aria-label="Timeframe">
        {(source?.tfs ?? TIMEFRAMES).map((tf) => <option key={tf} value={tf}>{tf}</option>)}
      </select>
    </div>
  );
}

function ExitEditor({ draft, onDraft }: { draft: Draft; onDraft: (draft: Draft) => void }) {
  return (
    <div className="mt-3 grid grid-cols-4 gap-2 rounded-xl border border-line bg-surface-1 p-3">
      {(['slAtr', 'tp1R', 'tp2R', 'tp3R'] as const).map((key) => (
        <label key={key} className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {key === 'slAtr' ? 'SL ATR' : key.toUpperCase()}
          </span>
          <input
            type="number"
            step={0.1}
            value={draft.exits[key]}
            onChange={(e) => onDraft({ ...draft, exits: { ...draft.exits, [key]: Number(e.target.value) } })}
            className="focus-ring mt-1 h-8 w-full rounded-lg border border-line bg-base px-2 font-mono text-xs text-ink"
          />
        </label>
      ))}
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
  onArchive,
}: {
  tab: BottomTab;
  onTab: (tab: BottomTab) => void;
  strategy: ScannerStrategy | null;
  stats: StrategyVersionStats[];
  preview: ScannerSnapshot;
  validation: ValidationResult;
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
          {tab === 'backtest' && <BacktestTab stats={stats} />}
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

function BacktestTab({ stats }: { stats: StrategyVersionStats[] }) {
  const stat = latestStats(stats);
  if (!stat) return <EmptyLine text="Select or create a strategy to run a deterministic backtest." />;
  return (
    <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
      <MetricTile label="Signals" value={<Num.Compact value={stat.signals} />} />
      <MetricTile label="Resolved" value={<Num.Compact value={stat.resolved} />} />
      <MetricTile label="Win Rate" value={<Num.Pct value={stat.winRate} signed={false} precision={0} />} />
      <MetricTile label="Expectancy" value={<Num value={stat.expectancy} precision={2} tone />} />
      <MetricTile label="Profit Factor" value={<Num value={stat.profitFactor} precision={2} />} />
      <MetricTile label="Max DD" value={<Num value={stat.maxDrawdownR} precision={1} />} />
      <MetricTile label="TP3 Hits" value={<Num.Compact value={stat.tp3Hits} />} />
      <MetricTile label="Avg Bars" value={<Num value={stat.avgBarsHeld} precision={0} />} />
    </div>
  );
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




