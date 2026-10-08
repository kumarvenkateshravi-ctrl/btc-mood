'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  ChevronDown,
  History,
  CalendarSearch,
  X,
  CandlestickChart,
  BarChart3,
  Grid3x3,
  Check,
  LayoutGrid,
  Square,
  Bitcoin,
  Calculator,
  LayoutDashboard,
  ScanLine,
  MoreHorizontal,
  Focus,
  PenLine,
  Menu,
} from 'lucide-react';
import Link from 'next/link';
import MobileSheet from '@/components/ui/MobileSheet';
import { type Timeframe } from '@/lib/types';
import { CHART_INDICATORS } from '@/lib/chartIndicatorCatalog';
import type { RenkoConfig, RenkoMethod } from '@/lib/renko';
import { GRID_COUNTS, type GridCount, type Layout } from '@/lib/gridLayout';
import { LayoutSwitcher, LayoutSwitcherButton } from './LayoutSwitcher';

import { ChartSettingsButton } from './chart/ChartSettingsButton';
import { ChartSettingsPopover } from './chart/ChartSettingsPopover';
import type { ChartSettingsState } from './chart/useChartSettings';

import { featureFlags } from '@/lib/featureFlags';
import Num from '@/components/ui/Num';
import type { MarketDataIntegrity } from '@/lib/marketDataIntegrity';
import type { PositionSide } from '@/lib/paper';
import type { WSStatus } from '@/lib/ws';
import { CHART_INSTRUMENTS, getChartInstrumentPresentation } from '@/lib/chartInstrumentPresentation';
import { ALL_CHART_TIMEFRAMES, MOBILE_PRIMARY_TIMEFRAMES } from '@/lib/chartNavigation';

const FEATURED_INDICATOR_IDS = new Set(['ma_ribbon_tv', 'ma_fvg', 'session_volume_profile', 'dsmart_line']);

export type ToolbarChartType = 'candlestick' | 'heikinAshi' | 'renko';
export type ToolbarPriceScaleMode = 'normal' | 'log' | 'percent';

export interface ChartToolbarProps {
  symbol: string;
  /** Presentation-level selection only; transport ownership remains above the chart. */
  onSelectSymbol?: (symbol: string) => void;
  price: number | null;
  /** UTC-session absolute price change, when the active feed provides it. */
  changeAbs?: number | null;
  change: number | null;
  status: 'live' | 'demo' | 'loading';
  /** Presentation-only view of the authoritative Stage 3 integrity gate. */
  marketIntegrity?: MarketDataIntegrity;
  /** Transport status informs recovery wording only; it never grants trust. */
  connectionStatus?: WSStatus;
  /** Derived from the active Stage 6 chart session. */
  executionMode?: 'live' | 'replay';
  /** Current-symbol position from the shared presentation facade. */
  positionSide?: Exclude<PositionSide, 'flat'> | null;
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  chartType: ToolbarChartType;
  onSelectType: (t: ToolbarChartType) => void;

  showSignals: boolean;
  onToggleSignals: () => void;

  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  isFocusMode?: boolean;
  onToggleFocus?: () => void;
  onFitContent: () => void;
  // Renko controls — only shown when chartType === 'renko'.
  renko: RenkoConfig;
  onRenkoChange: (c: RenkoConfig) => void;
  onOpenRenkoSettings?: () => void;
  activeIndicatorIds: string[];
  onToggleIndicator: (id: string) => void;
  onClearIndicators: () => void;
  replayActive: boolean;
  onReplayToggle: () => void;
  historyActive: boolean;
  onJumpToDate?: (ms: number) => void;
  onReturnToLive?: () => void;
  // Grid layout controls
  gridCount: GridCount;
  onGridChange: (n: GridCount) => void;
  // Full layout (mode + count + sync). When the feature flag is on, the
  // LayoutSwitcher is used instead of the legacy GridChip.
  layout?: Layout;
  onLayoutChange?: (next: Layout) => void;
  // Layout toggles
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onOpenDrawings?: () => void;
  // TV-style chart settings (gear popover). When the feature flag is off,
  // the button is not rendered.
  chartSettings?: ChartSettingsState;
  onChartSettingsPatch?: (p: Partial<ChartSettingsState>) => void;
  onChartSettingsReset?: () => void;
}

export default function ChartToolbar(props: ChartToolbarProps) {
  const {
    symbol,
    onSelectSymbol,
    price,
    changeAbs,
    change,
    status,
    marketIntegrity: suppliedIntegrity,
    connectionStatus,
    executionMode: suppliedExecutionMode,
    positionSide = null,
    selected,
    onSelectTf,
    chartType,
    onSelectType,

    isFullscreen,
    onToggleFullscreen,
    isFocusMode = false,
    onToggleFocus,
    onFitContent,
    renko,
    onRenkoChange,
    onOpenRenkoSettings,
    activeIndicatorIds,
    onToggleIndicator,
    onClearIndicators,
    replayActive,
    onReplayToggle,
    historyActive,
    onJumpToDate,
    onReturnToLive,
    gridCount,
    onGridChange,
    layout,
    onLayoutChange,
    isSidebarOpen,
    onToggleSidebar,
    chartSettings,
    onChartSettingsPatch,
    onChartSettingsReset,
  } = props;

  const marketIntegrity = suppliedIntegrity ?? (status === 'live' ? 'live' : status === 'demo' ? 'demo' : 'loading');
  const executionMode = suppliedExecutionMode ?? (replayActive ? 'replay' : 'live');

  return (
    <>
    <div data-testid="desktop-chart-toolbar" className="relative z-50 hidden h-[40px] w-full shrink-0 flex-nowrap items-center gap-0.5 overflow-visible border-b border-line bg-base px-2 lg:flex">
      <ChartContext
        symbol={symbol}
        onSelectSymbol={onSelectSymbol}
        price={price}
        changeAbs={changeAbs}
        change={change}
        integrity={marketIntegrity}
        connectionStatus={connectionStatus}
        executionMode={executionMode}
        positionSide={positionSide}
      />

      <ToolbarDivider />


      {/* Immediate timeframe access is intentionally kept in the primary chart row. */}
      <div className="flex shrink-0 items-center h-full">
        <TimeframeChip value={selected} onChange={onSelectTf} />
      </div>

      <ToolbarDivider />

      {/* Chart type */}
      <div className="flex shrink-0 items-center h-full">
        <ChartTypeChip value={chartType} onChange={onSelectType} />
      </div>

      {/* Renko config (conditional) */}
      {chartType === 'renko' && onOpenRenkoSettings && (
        <>
          <ToolbarDivider />
          <div className="flex shrink-0 items-center h-full">
            <button
              onClick={onOpenRenkoSettings}
              className="flex items-center justify-center gap-1.5 h-[28px] rounded px-3 text-[12px] font-semibold tracking-wide text-ink transition hover:bg-surface-3"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              Renko Settings
            </button>
          </div>
        </>
      )}

      <ToolbarDivider />

      {/* Indicators dropdown */}
      <div className="flex shrink-0 items-center h-full">
        <IndicatorChip
          activeIds={activeIndicatorIds}
          onToggle={onToggleIndicator}
          onClear={onClearIndicators}
        />
      </div>

      <ToolbarDivider />

      {/* Replay */}
      <div className="flex shrink-0 items-center h-full">
        <ChipButton
          icon={<History className="h-3.5 w-3.5" />}
          label="Replay"
          active={replayActive}
          onClick={onReplayToggle}
          title="Bar Replay"
        />

      </div>

      <ToolbarDivider />

      {/* Standalone historical date query. */}
      <div className="flex shrink-0 items-center h-full">
        <DateChip
          historyActive={historyActive}
          onJump={onJumpToDate}
          onReturn={onReturnToLive}
        />
      </div>

      <ToolbarDivider />

      {/* Layout controls are secondary below laptop width. */}
      <div className="hidden shrink-0 items-center h-full lg:flex">
        {featureFlags.layoutSwitcher && layout && onLayoutChange ? (
          <LayoutSwitcherToolbarMount
            layout={layout}
            onChange={onLayoutChange}
            chartType={chartType}
          />
        ) : (
          <GridChip value={gridCount} onChange={onGridChange} />
        )}
      </div>

      {/* Spacer pushes fullscreen + more to the right */}
      <div className="ml-auto flex shrink-0 items-center h-full gap-1 px-1">
        <Link
          href="/technical-scanner"
          title="Technical Scanner"
          className="focus-ring hidden min-[1600px]:inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-1 px-2.5 text-[12px] font-medium text-ink-muted transition hover:border-line-strong hover:bg-surface-2 hover:text-ink"
        >
          <ScanLine className="h-3.5 w-3.5" />
          Scanner
        </Link>
        <Link
          href="/mycryptostack"
          title="MyCryptoStack — multi-timeframe intelligence dashboard"
          className="focus-ring hidden min-[1600px]:inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-1 px-2.5 text-[12px] font-medium text-ink-muted transition hover:border-line-strong hover:bg-surface-2 hover:text-ink"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <Link
          href="/mystack"
          title="MyStack — risk & position-size cockpit"
          className="focus-ring hidden min-[1600px]:inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-1 px-2.5 text-[12px] font-medium text-ink-muted transition hover:border-line-strong hover:bg-surface-2 hover:text-ink"
        >
          <Calculator className="h-3.5 w-3.5" />
          MyStack
        </Link>
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title={isSidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
            className="focus-ring inline-flex h-full px-2 items-center justify-center text-ink-faint transition hover:text-ink hidden xl:inline-flex"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isSidebarOpen ? (
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                  <path d="m10 15-3-3 3-3" />
                </>
              ) : (
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                  <path d="m8 9 3 3-3 3" />
                </>
              )}
            </svg>
          </button>
        )}
        {onToggleFocus && (
          <button
            type="button"
            onClick={onToggleFocus}
            aria-label={isFocusMode ? 'Exit Focus' : 'Focus chart'}
            aria-pressed={isFocusMode}
            title={isFocusMode ? 'Exit Focus' : 'Focus chart (Shift+F)'}
            className={`focus-ring hidden h-full items-center justify-center px-2 transition hover:text-ink lg:inline-flex ${isFocusMode ? 'text-accent' : 'text-ink-faint'}`}
          >
            <Focus className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
          className="focus-ring hidden h-full px-2 items-center justify-center text-ink-faint transition hover:text-ink lg:inline-flex"
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
        {featureFlags.chartSettings && chartSettings && onChartSettingsPatch && onChartSettingsReset && (
          <ChartSettingsButtonWithPopover
            settings={chartSettings}
            onPatch={onChartSettingsPatch}
            onReset={onChartSettingsReset}
            onFitContent={onFitContent}
          />
        )}
      </div>
    </div>
    <MobileChartToolbar
      {...props}
      effectiveIntegrity={marketIntegrity}
      effectiveExecutionMode={executionMode}
    />
    </>
  );
}

/** Inline gear + popover that signals "open" to ChartPanel via a body data
 *  attribute so the chart-level keyboard handler can early-return while the
 *  popover has focus. */
function ChartSettingsButtonWithPopover({
  settings,
  onPatch,
  onReset,
  onFitContent,
}: {
  settings: ChartSettingsState;
  onPatch: (p: Partial<ChartSettingsState>) => void;
  onReset: () => void;
  onFitContent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) document.body.dataset.chartSettingsOpen = '1';
    else delete document.body.dataset.chartSettingsOpen;
    return () => {
      delete document.body.dataset.chartSettingsOpen;
    };
  }, [open]);
  return (
    <div className="relative">
      <ChartSettingsButton
        ref={buttonRef}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      <ChartSettingsPopover
        open={open}
        onClose={() => setOpen(false)}
        settings={settings}
        onPatch={onPatch}
        onReset={onReset}
        anchorRef={buttonRef}
        onFitContent={onFitContent}
        align="right"
      />
    </div>
  );
}

function MobileChartToolbar({
  symbol,
  onSelectSymbol,
  price,
  changeAbs,
  change,
  connectionStatus,
  selected,
  onSelectTf,
  chartType,
  onSelectType,
  activeIndicatorIds,
  onToggleIndicator,
  onClearIndicators,
  replayActive,
  onReplayToggle,
  historyActive,
  onJumpToDate,
  onReturnToLive,
  isFullscreen,
  onToggleFullscreen,
  isFocusMode,
  onToggleFocus,
  onFitContent,
  gridCount,
  onGridChange,
  chartSettings,
  onChartSettingsPatch,
  onChartSettingsReset,
  onOpenDrawings,
  effectiveIntegrity,
  effectiveExecutionMode,
}: ChartToolbarProps & {
  effectiveIntegrity: MarketDataIntegrity;
  effectiveExecutionMode: 'live' | 'replay';
}) {
  const [sheet, setSheet] = useState<'timeframes' | 'controls' | 'instrument' | null>(null);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSheet(null);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sheet]);
  const instrument = getChartInstrumentPresentation(symbol);
  // A symbol transition can retain the previous feed's last tick while loading.
  const canDisplayPrice = effectiveIntegrity !== 'loading' && effectiveIntegrity !== 'unavailable';
  const hasPrice = canDisplayPrice && price != null && Number.isFinite(price);
  const hasChange = canDisplayPrice && change != null && Number.isFinite(change);
  const hasChangeAbs = canDisplayPrice && changeAbs != null && Number.isFinite(changeAbs);
  const health = integrityPresentation(effectiveIntegrity, connectionStatus);

  return (
    <div data-testid="mobile-chart-toolbar" className="terminal-mobile-header lg:hidden">
      <div className="terminal-instrument-row" data-priority="P1">
        <Link href="/" className="terminal-icon focus-ring" aria-label="Open application home"><Menu size={22} /></Link>
        <button type="button" className="terminal-instrument focus-ring" onClick={() => setSheet('instrument')} aria-label={`Select instrument, current ${instrument.displaySymbol}`}>
          <span className="terminal-coin" aria-hidden>{instrument.kind === 'crypto' ? <Bitcoin size={21} /> : 'Au'}</span>
          <span>{instrument.displaySymbol}</span><ChevronDown size={16} />
        </button>
        <button type="button" className="terminal-icon focus-ring" onClick={() => setSheet('controls')} aria-label="More chart controls"><MoreHorizontal size={22} /></button>
      </div>
      <div className="terminal-market-row">
        <div className="terminal-price">
          {hasPrice ? <Num.Price value={price} precision={instrument.pricePrecision} className={change != null && change < 0 ? 'text-bear-bright' : 'text-bull-bright'} /> : <span className="text-ink-muted">—</span>}
          <div className="terminal-change" aria-label={effectiveExecutionMode === 'replay' ? 'Snapshot price' : 'UTC day change'}>
            {effectiveExecutionMode === 'replay' ? <span className="text-ink-muted">Snapshot price</span> : <>
              {hasChangeAbs && <Num.Delta value={changeAbs} precision={instrument.pricePrecision} />}
              {hasChange && <Num.Pct value={change} tone precision={2} />}
              {!hasChangeAbs && !hasChange && <span className="text-ink-muted">Price unavailable</span>}
            </>}
          </div>
        </div>
        <div className="terminal-feed"><span title={health.description} aria-label={health.description} className={effectiveIntegrity === 'live' ? 'text-bull-bright' : health.className}><i aria-hidden />{health.label}</span><span>{effectiveExecutionMode === 'replay' ? 'REPLAY · SIMULATED' : replayActive ? 'REPLAY SETUP' : 'PAPER'}</span></div>
      </div>
      <div className="terminal-timeframe-row">
        <div role="group" aria-label="Quick chart timeframes" className="terminal-timeframes">
          {MOBILE_PRIMARY_TIMEFRAMES.map((tf) => <button key={tf} type="button" className="focus-ring min-h-11" aria-pressed={selected === tf} onClick={() => onSelectTf(tf)}>{tf}</button>)}
          <button type="button" className="focus-ring" onClick={() => setSheet('timeframes')} aria-label={`All timeframes, current ${selected}`} aria-pressed={!MOBILE_PRIMARY_TIMEFRAMES.includes(selected)}>{MOBILE_PRIMARY_TIMEFRAMES.includes(selected) ? <ChevronDown size={16} /> : selected}</button>
        </div>
        <div className="terminal-indicators"><IndicatorChip activeIds={activeIndicatorIds} onToggle={onToggleIndicator} onClear={onClearIndicators} /></div>
        {onOpenDrawings && <button type="button" className="terminal-icon focus-ring" onClick={onOpenDrawings} aria-label="Open drawing tools"><PenLine size={19} /></button>}
      </div>
      {sheet && <MobileSheet title={sheet === 'instrument' ? 'Select instrument' : sheet === 'timeframes' ? 'All chart timeframes' : 'Chart controls'} onClose={() => setSheet(null)}>
        {sheet === 'instrument' ? <div role="group" aria-label="Chart instrument" className="space-y-2">
          {CHART_INSTRUMENTS.map(candidate => <button key={candidate.symbol} type="button" aria-label={`${candidate.label} ${candidate.displaySymbol}`} aria-pressed={candidate.symbol === symbol} disabled={!onSelectSymbol} onClick={() => { onSelectSymbol?.(candidate.symbol); setSheet(null); }} className="terminal-instrument-option focus-ring"><span>{candidate.label}</span><span>{candidate.displaySymbol}</span>{candidate.symbol === symbol && <Check size={18} />}</button>)}
        </div> : sheet === 'timeframes' ? <div role="group" aria-label="All chart timeframes" className="grid grid-cols-3 gap-2">
          {ALL_CHART_TIMEFRAMES.map(tf => <button key={tf} type="button" aria-pressed={selected === tf} onClick={() => { onSelectTf(tf); setSheet(null); }} className="terminal-sheet-action focus-ring">{tf}</button>)}
        </div> : <div className="terminal-controls-grid">
          <div className="terminal-sheet-action"><ChartTypeChip value={chartType} onChange={onSelectType} /></div>
          <div className="terminal-sheet-action"><IndicatorChip activeIds={activeIndicatorIds} onToggle={onToggleIndicator} onClear={onClearIndicators} /></div>
          <div className="terminal-sheet-action"><DateChip historyActive={historyActive} onJump={onJumpToDate} onReturn={onReturnToLive} /></div>
          <button type="button" onClick={() => { onReplayToggle(); setSheet(null); }} className="terminal-sheet-action focus-ring"><History size={18} />{replayActive ? 'Exit replay' : 'Replay'}</button>
          <button type="button" onClick={() => { onToggleFullscreen(); setSheet(null); }} className="terminal-sheet-action focus-ring"><Maximize2 size={18} />{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
          {onToggleFocus && <button type="button" onClick={onToggleFocus} aria-pressed={isFocusMode} className="terminal-sheet-action focus-ring"><Focus size={18} />Focus chart</button>}
          <div className="terminal-sheet-action"><GridChip value={gridCount} onChange={onGridChange} /></div>
          {featureFlags.chartSettings && chartSettings && onChartSettingsPatch && onChartSettingsReset && <div className="terminal-sheet-action"><ChartSettingsButtonWithPopover settings={chartSettings} onPatch={onChartSettingsPatch} onReset={onChartSettingsReset} onFitContent={onFitContent} /></div>}
        </div>}
      </MobileSheet>}
    </div>
  );
}

function ChartContext({
  symbol,
  onSelectSymbol,
  price,
  changeAbs,
  change,
  integrity,
  connectionStatus,
  executionMode,
  positionSide,
}: {
  symbol: string;
  /** Presentation-level selection only; transport ownership remains above the chart. */
  onSelectSymbol?: (symbol: string) => void;
  price: number | null;
  changeAbs?: number | null;
  change: number | null;
  integrity: MarketDataIntegrity;
  connectionStatus?: WSStatus;
  executionMode: 'live' | 'replay';
  positionSide: Exclude<PositionSide, 'flat'> | null;
}) {
  const instrument = getChartInstrumentPresentation(symbol);
  const canDisplayPrice = integrity !== 'loading' && integrity !== 'unavailable';
  const hasPrice = canDisplayPrice && price != null && Number.isFinite(price);
  const hasChange = canDisplayPrice && change != null && Number.isFinite(change);
  const hasChangeAbs = canDisplayPrice && changeAbs != null && Number.isFinite(changeAbs);
  const positionLabel = positionSide ? positionSide.toUpperCase() : null;
  const positionTone = positionSide === 'long' ? 'text-bull-bright' : 'text-bear-bright';

  return (
    <div
      data-testid="chart-context"
      className="flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap px-0.5"
      aria-label="Active chart context"
    >
      <DesktopInstrumentSelector symbol={symbol} onSelect={onSelectSymbol} />

      <span className="h-4 w-px shrink-0 bg-line" aria-hidden />

      <div className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap" aria-live="polite" aria-atomic="true">
        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">Last</span>
        {hasPrice ? <Num.Price value={price} precision={instrument.pricePrecision} className="text-[13px] font-semibold text-ink" /> : <span className="num text-[13px] text-ink-faint">—</span>}
        {(hasChangeAbs || hasChange) && (
          <span className="hidden items-baseline gap-1 text-[11px] xl:inline-flex" title="UTC day change">
            {hasChangeAbs && <Num.Delta value={changeAbs} precision={instrument.pricePrecision} />}
            {hasChange && <Num.Pct value={change} tone precision={2} />}
          </span>
        )}
      </div>

      <MarketIntegrityState integrity={integrity} connectionStatus={connectionStatus} />

      <div className="hidden items-center gap-1 sm:flex" aria-label={`Execution mode: ${executionMode} paper`}>
        {executionMode === 'replay' && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold tracking-[0.08em] text-regime-hot">
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            REPLAY
          </span>
        )}
        <span className="text-[10px] font-medium tracking-[0.08em] text-ink-faint">PAPER</span>
      </div>

      {positionLabel && (
        <span
          title={`Active ${positionSide} position`}
          aria-label={`Active ${positionSide} position`}
          className={`hidden rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] sm:inline-flex ${positionTone}`}
        >
          {positionLabel}
        </span>
      )}
    </div>
  );
}

function DesktopInstrumentSelector({ symbol, onSelect }: { symbol: string; onSelect?: (symbol: string) => void }) {
  return (
    <div role="group" aria-label="Chart instrument" className="flex h-[28px] shrink-0 items-center rounded border border-line bg-surface-1 p-0.5 md:max-lg:h-[36px]">
      {CHART_INSTRUMENTS.map((instrument) => (
        <button
          key={instrument.symbol}
          type="button"
          aria-pressed={instrument.symbol === symbol}
          title={`Switch to ${instrument.label}`} aria-label={`${instrument.label} ${instrument.displaySymbol}`}
          disabled={!onSelect || instrument.symbol === symbol}
          onClick={() => onSelect?.(instrument.symbol)}
          className={[
            'focus-ring inline-flex h-[24px] items-center gap-1 rounded px-2 text-[11px] font-semibold transition-colors disabled:cursor-default md:max-lg:h-[32px]',
            instrument.symbol === symbol ? 'bg-surface-3 text-ink ring-1 ring-accent/45' : 'text-ink-faint hover:bg-surface-2 hover:text-ink',
          ].join(' ')}
        >
          {instrument.kind === 'crypto' ? <Bitcoin className="h-3.5 w-3.5 text-regime-hot" aria-hidden /> : <span className="text-[10px] font-bold text-regime-hot" aria-hidden>Au</span>}
          {instrument.label}
        </button>
      ))}
    </div>
  );
}
function MarketIntegrityState({
  integrity,
  connectionStatus,
}: {
  integrity: MarketDataIntegrity;
  connectionStatus?: WSStatus;
}) {
  const state = integrityPresentation(integrity, connectionStatus);
  return (
    <span
      title={state.description}
      aria-label={state.description}
      className={['hidden items-center gap-1 text-[10px] font-medium tracking-[0.07em] sm:inline-flex', state.className].join(' ')}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      <span>{state.label}</span>
      {state.paused && <span className="normal-case tracking-normal text-ink-faint">Trading paused</span>}
    </span>
  );
}

function integrityPresentation(integrity: MarketDataIntegrity, connectionStatus?: WSStatus) {
  switch (integrity) {
    case 'live':
      return { label: 'LIVE', description: 'Market data live and synchronized', className: 'text-ink-muted', paused: false };
    case 'stale':
      return { label: 'STALE', description: 'Market data is stale. Price-dependent trading is paused.', className: 'text-bear-bright', paused: true };
    case 'unavailable':
      return { label: 'DATA UNAVAILABLE', description: 'Market data is unavailable. Price-dependent trading is paused.', className: 'text-bear-bright', paused: true };
    case 'partial':
      return connectionStatus === 'open'
        ? { label: 'SYNCHRONIZING', description: 'Market data is synchronizing. Price-dependent trading is paused.', className: 'text-regime-hot', paused: true }
        : { label: 'RECONNECTING', description: 'Market data is reconnecting. Price-dependent trading is paused.', className: 'text-regime-hot', paused: true };
    case 'loading':
      return { label: 'SYNCHRONIZING', description: 'Market data is loading. Price-dependent trading is paused.', className: 'text-regime-hot', paused: true };
    case 'historical':
      return { label: 'HISTORICAL', description: 'Historical market data only. Live price-dependent trading is paused.', className: 'text-ink-muted', paused: true };
    case 'demo':
      return { label: 'DEMO', description: 'Demo market data. Price-dependent live trading is paused.', className: 'text-regime-hot', paused: true };
    case 'replay':
      return { label: 'SNAPSHOT', description: 'Replay snapshot data. Live price-dependent trading is paused.', className: 'text-regime-hot', paused: true };
  }
}
function ToolbarDivider() {
  return <span className="mx-0.5 h-[20px] w-px shrink-0 bg-line" aria-hidden />;
}

/** TradingView-style toolbar control: icon + label + caret, on a raised chip. */
function Chip({
  icon,
  label,
  active = false,
  open = false,
  onClick,
  title,
  ariaLabel,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  open?: boolean;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-haspopup={onClick ? 'menu' : undefined}
      aria-expanded={open}
      className={[
        'focus-ring inline-flex h-full items-center gap-1.5 px-2 text-[13px] font-medium transition-colors',
        active || open
          ? 'text-accent'
          : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {icon && <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span>}
      <span className="leading-none">{label}</span>
      <ChevronDown className="ml-0.5 h-3 w-3 opacity-70" />
    </button>
  );
}

/** Simple chip with no caret — for non-dropdown actions. */
function ChipButton({
  icon,
  label,
  active = false,
  onClick,
  title,
  ariaLabel,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={active}
      className={[
        'focus-ring inline-flex h-full items-center gap-1.5 px-2 text-[13px] font-medium transition-colors',
        active
          ? 'text-accent'
          : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {icon && <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span>}
      <span className="leading-none">{label}</span>
    </button>
  );
}

/** Popover menu anchored to a chip. Closes on outside click / Escape. */
function ChipMenu({
  open,
  onClose,
  children,
  width = 220,
  align = 'left',
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      style={{ width, [align]: 0 } as React.CSSProperties}
      className={[
        'absolute top-full z-40 mt-1.5 rounded-md border border-line-strong bg-surface-1 py-1 shadow-2xl',
        align === 'right' ? 'right-0' : 'left-0',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  active = false,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] font-medium transition',
        active
          ? 'bg-accent/15 text-ink'
          : disabled
            ? 'text-ink-faint/60'
            : danger
              ? 'text-bear-bright hover:bg-surface-2'
              : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      ].join(' ')}
    >
      <span className="flex-1">{children}</span>
      {active && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 h-px bg-line" aria-hidden />;
}

function TimeframeChip({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (t: Timeframe) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Chart timeframe"
      className="flex h-[28px] items-center rounded border border-line bg-surface-1 p-0.5 md:max-lg:h-[36px]"
    >
      {(['5m', '15m', '30m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => {
        const active = value === tf;
        return (
          <button
            key={tf}
            type="button"
            aria-pressed={active}
            title={`Timeframe ${tf}`}
            onClick={() => onChange(tf)}
            className={[
              'focus-ring inline-flex h-full min-w-[29px] items-center justify-center rounded px-1 text-[11px] font-medium tabular-nums transition-colors md:max-lg:min-w-[40px]',
              active
                ? 'bg-surface-3 text-ink ring-1 ring-accent/45'
                : 'text-ink-faint hover:bg-surface-2 hover:text-ink-muted',
            ].join(' ')}
          >
            {tf}
          </button>
        );
      })}
    </div>
  );
}


function ChartTypeChip({
  value,
  onChange,
}: {
  value: ToolbarChartType;
  onChange: (v: ToolbarChartType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ICONS: Record<ToolbarChartType, React.ReactNode> = {
    candlestick: <CandlestickChart className="h-3.5 w-3.5" />,
    heikinAshi: <BarChart3 className="h-3.5 w-3.5" />,
    renko: <Grid3x3 className="h-3.5 w-3.5" />,
  };
  const LABELS: Record<ToolbarChartType, string> = {
    candlestick: 'Candles',
    heikinAshi: 'Heikin Ashi',
    renko: 'Renko',
  };
  return (
    <div className="relative">
      <Chip
        icon={ICONS[value]}
        label={LABELS[value]}
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Chart type"
        ariaLabel="Chart type"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={180}>
        <MenuItem active={value === 'candlestick'} onClick={() => { onChange('candlestick'); setOpen(false); }}>
          <span className="inline-flex items-center gap-2">
            <CandlestickChart className="h-3.5 w-3.5" /> Candles
          </span>
        </MenuItem>
        <MenuItem active={value === 'heikinAshi'} onClick={() => { onChange('heikinAshi'); setOpen(false); }}>
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5" /> Heikin Ashi
          </span>
        </MenuItem>
        <MenuItem active={value === 'renko'} onClick={() => { onChange('renko'); setOpen(false); }}>
          <span className="inline-flex items-center gap-2">
            <Grid3x3 className="h-3.5 w-3.5" /> Renko
          </span>
        </MenuItem>
      </ChipMenu>
    </div>
  );
}

function DateChip({
  historyActive,
  onJump,
  onReturn,
}: {
  historyActive: boolean;
  onJump?: (ms: number) => void;
  onReturn?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="relative">
      <Chip
        icon={<CalendarSearch className="h-3.5 w-3.5" />}
        label="Date"
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Jump to date"
        ariaLabel="Jump to date"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={210} align="right">
        <div className="px-3 py-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Jump to date
          </div>
          <input
            type="date"
            max={today}
            onChange={(e) => {
              const v = e.target.value;
              if (!v || !onJump) return;
              const ms = new Date(`${v}T00:00:00Z`).getTime();
              if (Number.isFinite(ms)) {
                onJump(ms);
                setOpen(false);
              }
            }}
            className="w-full rounded border border-line bg-base px-2 py-1.5 text-[12px] text-ink outline-none [color-scheme:dark] focus:border-line-strong"
            aria-label="Jump to date"
          />
        </div>
        {historyActive && (
          <>
            <MenuDivider />
            <MenuItem
              onClick={() => {
                onReturn?.();
                setOpen(false);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <X className="h-3.5 w-3.5" /> Return to latest
              </span>
            </MenuItem>
          </>
        )}
      </ChipMenu>
    </div>
  );
}



function RenkoChip({
  renko,
  onChange,
}: {
  renko: RenkoConfig;
  onChange: (c: RenkoConfig) => void;
  lastPrice: number | null;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<RenkoConfig>) => onChange({ ...renko, ...patch });
  const METHOD_LABELS: Record<RenkoMethod, string> = {
    traditional: 'Trad',
    atr: 'ATR',
    percentage: '%',
  };
  return (
    <div className="relative">
      <Chip
        icon={<Grid3x3 className="h-3.5 w-3.5" />}
        label={`Renko · ${METHOD_LABELS[renko.method]}`}
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Renko box size"
        ariaLabel="Renko box size"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={210} align="right">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Box size method
        </div>
        <MenuItem active={renko.method === 'traditional'} onClick={() => set({ method: 'traditional' })}>
          Traditional (fixed)
        </MenuItem>
        <MenuItem active={renko.method === 'atr'} onClick={() => set({ method: 'atr' })}>
          ATR
        </MenuItem>
        <MenuItem active={renko.method === 'percentage'} onClick={() => set({ method: 'percentage' })}>
          Percentage
        </MenuItem>
        <MenuDivider />
        {renko.method === 'traditional' && (
          <div className="px-3 py-2">
            <label className="flex items-center gap-2 text-[11px] text-ink-faint">
              Box size
              <input
                type="number"
                min={0}
                step="any"
                value={renko.boxSize ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') return set({ boxSize: null });
                  const n = Number(v);
                  if (Number.isFinite(n) && n > 0) set({ boxSize: n });
                }}
                className="ml-auto w-20 rounded border border-line bg-base px-1.5 py-1 text-right font-mono text-[12px] text-ink outline-none focus:border-line-strong"
              />
            </label>
          </div>
        )}
        {renko.method === 'atr' && (
          <div className="px-3 py-2">
            <label className="flex items-center gap-2 text-[11px] text-ink-faint">
              ATR length
              <input
                type="number"
                min={1}
                step={1}
                value={renko.atrLength}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 1) set({ atrLength: Math.round(n) });
                }}
                className="ml-auto w-20 rounded border border-line bg-base px-1.5 py-1 text-right font-mono text-[12px] text-ink outline-none focus:border-line-strong"
              />
            </label>
          </div>
        )}
        {renko.method === 'percentage' && (
          <div className="px-3 py-2">
            <label className="flex items-center gap-2 text-[11px] text-ink-faint">
              Percent
              <input
                type="number"
                min={0}
                step="any"
                value={renko.percentage}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) set({ percentage: n });
                }}
                className="ml-auto w-20 rounded border border-line bg-base px-1.5 py-1 text-right font-mono text-[12px] text-ink outline-none focus:border-line-strong"
              />
            </label>
          </div>
        )}
      </ChipMenu>
    </div>
  );
}

/** Grid layout chip — icon only, opens a dropdown with 1/2/4/6 selector. */
function GridChip({
  value,
  onChange,
}: {
  value: GridCount;
  onChange: (n: GridCount) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Grid layout"
        aria-label="Grid layout"
        aria-expanded={open}
        className={[
          'focus-ring inline-flex h-full px-2 items-center justify-center transition-colors',
          open || value > 1
            ? 'text-accent'
            : 'text-ink-faint hover:text-ink',
        ].join(' ')}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1.5 w-[200px] overflow-hidden rounded-lg border border-line-strong bg-surface-1 shadow-2xl"
        >
          <div className="border-b border-line px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Layout</p>
          </div>
          <div className="p-3">
            {/* Single chart shortcut */}
            <button
              type="button"
              onClick={() => { onChange(1); setOpen(false); }}
              aria-pressed={value === 1}
              title="Single chart"
              className={[
                'focus-ring mb-2 inline-flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] font-medium transition',
                value === 1
                  ? 'border-line-strong bg-surface-3 text-ink'
                  : 'border-line bg-surface-2 text-ink-muted hover:border-line-strong hover:bg-surface-3 hover:text-ink',
              ].join(' ')}
            >
              <Square className="h-3.5 w-3.5" />
              Single chart
            </button>
            {/* Grid count selector */}
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Multi-chart grid</p>
            <div
              role="radiogroup"
              aria-label="Number of charts"
              className="inline-flex w-full items-center rounded-md border border-line bg-surface-2 p-0.5 font-mono text-[12px]"
            >
              {GRID_COUNTS.filter((n) => n > 1).map((n) => {
                const active = n === value;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => { onChange(n); setOpen(false); }}
                    className={[
                      'focus-ring min-w-0 flex-1 rounded px-2 py-1.5 transition',
                      active
                        ? 'bg-surface-3 text-ink'
                        : 'text-ink-faint hover:bg-surface-2 hover:text-ink',
                    ].join(' ')}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Toolbar mount for the LayoutSwitcher popover. Sets the `body` flag so
 *  the chart-level keyboard handler can early-return while the popover
 *  has focus, and returns focus to the gear button on close. */
function LayoutSwitcherToolbarMount({
  layout,
  onChange,
  chartType,
}: {
  layout: Layout;
  onChange: (next: Layout) => void;
  chartType: 'candlestick' | 'heikinAshi' | 'renko';
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) document.body.dataset.layoutSwitcherOpen = '1';
    else delete document.body.dataset.layoutSwitcherOpen;
    return () => {
      delete document.body.dataset.layoutSwitcherOpen;
    };
  }, [open]);
  return (
    <div className="relative">
      <LayoutSwitcherButton
        ref={buttonRef}
        layout={layout}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      <LayoutSwitcher
        open={open}
        onOpenChange={setOpen}
        layout={layout}
        onChange={onChange}
        multiPaneDisabled={chartType === 'renko'}
        anchorRef={buttonRef}
      />
    </div>
  );
}

export function IndicatorChip({
  activeIds,
  onToggle,
  onClear,
}: {
  activeIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = activeIds.length;
  const label = count > 0 ? `Indicators · ${count}` : 'Indicators';
  const featuredIndicators = CHART_INDICATORS.filter((indicator) => FEATURED_INDICATOR_IDS.has(indicator.id));
  const remainingIndicators = CHART_INDICATORS.filter((indicator) => !FEATURED_INDICATOR_IDS.has(indicator.id));

  return (
    <div className="relative">
      <Chip
        icon={
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 12L5 8l3 3 6.5-7" />
            <path d="M1.5 14h13" />
          </svg>
        }
        label={label}
        active={count > 0}
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Indicators"
        ariaLabel="Indicators"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={260}>
        <div className="max-h-[60vh] overflow-auto">
          <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint" aria-label="Featured indicators">
            Featured indicators
          </div>
          {featuredIndicators.map((ind) => (
            <MenuItem
              key={ind.id}
              onClick={() => { onToggle(ind.id); setOpen(false); }}
            >
              {ind.name}
            </MenuItem>
          ))}
          <MenuDivider />
          {remainingIndicators.map((ind) => (
            <MenuItem
              key={ind.id}
              onClick={() => { onToggle(ind.id); setOpen(false); }}
            >
              {ind.name}
            </MenuItem>
          ))}
        </div>
        {count > 0 && (
          <>
            <MenuDivider />
            <MenuItem danger onClick={() => { onClear(); setOpen(false); }}>
              Clear all ({count})
            </MenuItem>
          </>
        )}
      </ChipMenu>
    </div>
  );
}
