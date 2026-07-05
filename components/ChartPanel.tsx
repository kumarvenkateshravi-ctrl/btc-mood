'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart, { type ChartType, type PriceScaleModeOption, type ChartOverlay, type OverlayKind, type ChartApi } from './Chart';
import { type RenkoConfig, DEFAULT_RENKO, renkoConfigToOptions } from '@/lib/renko';
import ChartContextMenu from './trade/ChartContextMenu';
import { usePaperStore, setPositionOverlay } from '@/lib/paperStore';
import { projectedPnl, unrealizedPnl } from '@/lib/paper';
import ReverseConfirmDialog from '@/components/trade/ReverseConfirmDialog';
import CloseConfirmDialog from '@/components/trade/CloseConfirmDialog';
import type { OverlayLineBadge } from '@/lib/orderOverlayPrimitive';
import { setMarkPrice } from '@/lib/markPriceStore';
import {
  useReplaySession,
  startReplaySession,
  endReplaySession,
  replayReconcileBar,
  replaySetOverlay,
  replayClose,
} from '@/lib/replaySession';
import { usePriceAlerts, removePriceAlert, updatePriceAlertPrice } from '@/lib/priceAlertsStore';
import DrawingLayer from './DrawingLayer';
import DrawingToolbar from './DrawingToolbar';
import { useDrawings, clearDrawings, DRAWING_COLORS, type Tool } from '@/lib/drawings';
import ReplayBar from './ReplayBar';
import ReplaySelector from './ReplaySelector';
import ChartToolbar from './ChartToolbar';
import RenkoSettingsModal from './trade/RenkoSettingsModal';
import OrderModal from '@/components/trade/OrderModal';
import { FALLBACK_HEIGHT } from '@/lib/chartHeight';
import type { Candle, Timeframe } from '@/lib/types';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { IndicatorSettings } from '@/lib/indicatorFramework';
import { useBaseCandles } from '@/lib/chartHelpers';

interface ChartPanelProps {
  candles: Candle[];
  type: ChartType;
  onTypeChange: (t: ChartType) => void;
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  symbol: string;
  price: number | null;
  change: number | null;
  status: 'live' | 'demo' | 'loading';
  showVolume?: boolean;
  onQuickTrade?: (side: 'buy' | 'sell') => void;
  bid?: number | null;
  ask?: number | null;
  activeIndicatorIds: string[];
  onToggleIndicator: (id: string) => void;
  onClearIndicators: () => void;
  /** Lazy-load older history for the selected timeframe. */
  onLoadOlder?: () => void;
  /** Jump-to-date: a focused historical window is being shown. */
  historyActive?: boolean;
  onJumpToDate?: (ms: number) => void;
  onReturnToLive?: () => void;
  /** Bump to fit the chart to the current data (after a jump / return). */
  fitSignal?: number;
  /** Grid layout controls forwarded to the toolbar. */
  gridCount: import('@/lib/gridLayout').GridCount;
  onGridChange: (n: import('@/lib/gridLayout').GridCount) => void;
  /** Workspace controls forwarded to the toolbar. */
  workspaceCurrent: import('@/lib/workspaces').WorkspaceConfig;
  onWorkspaceApply: (cfg: import('@/lib/workspaces').WorkspaceConfig) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  candlesByTf?: Record<string, import('@/lib/types').Candle[]>;
}

/** Last Wilder ATR(14) value of a candle series (null when too short). Used to
 *  seed default TP/SL distances the moment a position opens. */
function atr14Last(candles: Candle[]): number | null {
  const n = candles.length;
  if (n < 2) return null;
  let atr = candles[1].high - candles[1].low; // seed with first true range
  for (let i = 2; i < n; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    atr = (atr * 13 + tr) / 14; // RMA smoothing
  }
  return atr > 0 ? atr : null;
}

export default function ChartPanel({
  candles,
  candlesByTf,
  type,
  onTypeChange,
  selected,
  onSelectTf,
  symbol,
  price,
  change,
  status,
  showVolume: parentShowVolume,
  onQuickTrade,
  bid = null,
  ask = null,
  activeIndicatorIds,
  onToggleIndicator,
  onClearIndicators,
  onLoadOlder,
  historyActive = false,
  onJumpToDate,
  onReturnToLive,
  fitSignal,
  gridCount,
  onGridChange,
  workspaceCurrent,
  onWorkspaceApply,
  isSidebarOpen,
  onToggleSidebar,
}: ChartPanelProps) {
  const primaryId = activeIndicatorIds[0] ?? '';


  // BUY/SELL signal markers on the chart, on by default.
  const [showSignals, setShowSignals] = useState(true);
  const toggleSignals = useCallback(() => setShowSignals((v) => !v), []);



  // Renko box-size config (method + params).
  const [renkoConfig, setRenkoConfig] = useState<RenkoConfig>(DEFAULT_RENKO);
  const renkoOptions = useMemo(() => renkoConfigToOptions(renkoConfig), [renkoConfig]);
  const [showRenkoSettings, setShowRenkoSettings] = useState(false);

  // Price-scale mode: linear / log / percentage.
  const [priceScaleMode, setPriceScaleMode] = useState<PriceScaleModeOption>('normal');

  // ---- Drawing tools ----
  const [drawingTool, setDrawingTool] = useState<Tool>('cursor');
  const [drawingColor, setDrawingColor] = useState(DRAWING_COLORS[0]);
  const [magnet, setMagnet] = useState(false);
  const [drawingsLocked, setDrawingsLocked] = useState(false);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const [chartApi, setChartApi] = useState<ChartApi | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const drawingsForSymbol = useDrawings(symbol);

  // ---- Bar Replay ----
  type ReplayMode = 'off' | 'selecting' | 'active';
  const [replayMode, setReplayMode] = useState<ReplayMode>('off');
  const [playIndex, setPlayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [bookmarks, setBookmarks] = useState<number[]>([]);

  // Reset replay when the timeframe or symbol changes (candle array differs).
  useEffect(() => {
    setReplayMode('off');
    setReplayPlaying(false);
    setBookmarks([]);
  }, [selected, symbol]);

  // Advance one candle per tick while playing.
  useEffect(() => {
    if (replayMode !== 'active' || !replayPlaying) return;
    const interval = Math.max(40, 600 / replaySpeed);
    const id = setInterval(() => {
      setPlayIndex((i) => Math.min(candles.length - 1, i + 1));
    }, interval);
    return () => clearInterval(id);
  }, [replayMode, replayPlaying, replaySpeed, candles.length]);

  // Stop at the last candle.
  useEffect(() => {
    if (replayMode === 'active' && replayPlaying && playIndex >= candles.length - 1) {
      setReplayPlaying(false);
    }
  }, [replayMode, replayPlaying, playIndex, candles.length]);

  // Candles fed to the chart: full unless actively replaying (then sliced).
  const replayCandles = useMemo(() => {
    if (replayMode !== 'active') return candles;
    const end = Math.max(2, Math.min(playIndex + 1, candles.length));
    return candles.slice(0, end);
  }, [replayMode, playIndex, candles]);

  const onReplayToggle = () =>
    setReplayMode((m) => {
      if (m === 'off') {
        setReplayPlaying(false);
        return 'selecting';
      }
      return 'off';
    });

  const lastReconciledRef = useRef(-1);
  const onReplayPick = (index: number) => {
    const start = Math.max(1, Math.min(index, candles.length - 1));
    lastReconciledRef.current = start; // don't reconcile bars before the cut
    startReplaySession(symbol); // fresh isolated account for this replay
    setPlayIndex(start);
    setBookmarks([]);
    setReplayPlaying(false);
    setReplayMode('active');
  };

  const stepReplay = (dir: 1 | -1) =>
    setPlayIndex((i) => Math.max(1, Math.min(candles.length - 1, i + dir)));

  const replayLast = replayCandles[replayCandles.length - 1];
  const displayPrice = replayMode === 'active' && replayLast ? replayLast.close : price;

  // Publish the current mark (replay bar's close during replay, else live).
  useEffect(() => {
    if (replayMode === 'active' && replayLast) {
      setMarkPrice(symbol, replayLast.close, replayLast.time);
    } else if (price != null && Number.isFinite(price)) {
      const liveLast = candles[candles.length - 1];
      setMarkPrice(symbol, price, liveLast ? liveLast.time : Math.floor(Date.now() / 1000));
    }
  }, [replayMode, replayLast, price, symbol, candles]);

  // End the isolated session when leaving replay (the live account is never
  // touched during replay — they run independently).
  useEffect(() => {
    if (replayMode !== 'active') {
      endReplaySession();
      lastReconciledRef.current = -1;
    }
    return () => endReplaySession();
  }, [replayMode]);

  // As replay reveals new bars (forward only), reconcile the SESSION's position
  // so a TP/SL hit auto-closes and logs a trade at the replay bar's time.
  useEffect(() => {
    if (replayMode !== 'active') return;
    for (let i = Math.max(1, lastReconciledRef.current + 1); i <= playIndex && i < candles.length; i++) {
      replayReconcileBar(candles[i]);
    }
    if (playIndex > lastReconciledRef.current) lastReconciledRef.current = playIndex;
  }, [replayMode, playIndex, candles]);

  // ---- Chart → trade wiring ----
  const LEVERAGE = 10;
  const paper = usePaperStore();
  const session = useReplaySession();
  // During replay the chart reflects the ISOLATED session's position; otherwise
  // the live account's.
  const replayTrading = replayMode === 'active';
  const pos = replayTrading ? session.position : paper.positions[symbol] ?? null;
  const hasPosition = !!(pos && pos.side !== 'flat' && pos.units > 0);
  const mid = price ?? (candles.length > 0 ? candles[candles.length - 1].close : 0);

  const [ctxMenu, setCtxMenu] = useState<{ price: number; x: number; y: number } | null>(null);
  const [resetTick, setResetTick] = useState(0);
  const [ticketSide, setTicketSide] = useState<'buy' | 'sell' | null>(null);

  // Live-trading quick-trade pills open the order ticket prefilled with the
  // clicked side; during replay they keep routing to the old behavior
  // (right-dock trade tab), since the ticket doesn't stage replay orders.
  const handleQuickTrade = useCallback(
    (side: 'buy' | 'sell') => {
      if (replayTrading) { onQuickTrade?.(side); return; }
      setTicketSide(side);
    },
    [replayTrading, onQuickTrade],
  );

  // ---- Immediate-place trade overlay (position-driven, TV-style) ----
  // The chart overlay is the single management surface for the open position.
  // TP/SL lines are ALWAYS draggable; dragging or toggling a TP/SL chip stages a
  // local draft and reveals Discard/Confirm. Confirm commits to the store;
  // Discard reverts. Reverse = the ⇅ button; Close = the ✕ on the entry pill.
  // The overlay owns only the transient draft; the store stays the source of truth.
  const [draftTpSl, setDraftTpSl] = useState<{ tp: number | null; sl: number | null } | null>(null);
  const [showReverseConfirm, setShowReverseConfirm] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Effective TP/SL shown on the chart: the draft when editing, else committed.
  const effTp = draftTpSl ? draftTpSl.tp : pos?.tp ?? null;
  const effSl = draftTpSl ? draftTpSl.sl : pos?.sl ?? null;
  // "Dirty" once a staged draft differs from the committed levels.
  const isDirty = !!draftTpSl && (draftTpSl.tp !== (pos?.tp ?? null) || draftTpSl.sl !== (pos?.sl ?? null));

  // Leaving a position clears any pending edit + dialogs.
  useEffect(() => {
    if (!hasPosition) {
      setDraftTpSl(null);
      setShowReverseConfirm(false);
      setShowCloseConfirm(false);
    }
  }, [hasPosition]);

  // A placed order shows only the entry line — no auto TP/SL. The trader adds
  // exits on demand with the TP/SL chips (each seeds an ATR-based default line
  // that can then be dragged), so nothing appears until they ask for it.

  // Entry / TP / SL lines. Entry is fixed; TP/SL are draggable for a live position.
  const overlays = useMemo<ChartOverlay[]>(() => {
    if (!hasPosition || !pos) return [];
    const o: ChartOverlay[] = [{ kind: 'entry', price: pos.entryPrice, draggable: false }];
    const draggable = !replayTrading;
    if (effTp != null) o.push({ kind: 'tp', price: effTp, draggable });
    if (effSl != null) o.push({ kind: 'sl', price: effSl, draggable });
    return o;
  }, [hasPosition, pos, effTp, effSl, replayTrading]);

  // Dragging a TP/SL line stages the draft (store untouched until Confirm);
  // during replay it routes straight to the isolated session.
  const handleOverlayDrag = useCallback(
    (kind: OverlayKind, price: number) => {
      if (kind !== 'tp' && kind !== 'sl') return;
      if (replayTrading) { replaySetOverlay(kind, price); return; }
      setDraftTpSl((d) => ({
        tp: d?.tp ?? pos?.tp ?? null,
        sl: d?.sl ?? pos?.sl ?? null,
        [kind]: price,
      }));
    },
    [replayTrading, pos],
  );

  const handleOverlayChipClick = useCallback(
    (key: 'tp' | 'sl' | 'close') => {
      if (key === 'close') {
        if (replayTrading) replayClose(replayLast?.close ?? mid, replayLast?.time ?? Math.floor(Date.now() / 1000));
        else setShowCloseConfirm(true); // confirm dialog before booking P&L
        return;
      }
      // ✕ on a TP/SL line removes that exit (staged until Confirm).
      if (replayTrading) replaySetOverlay(key, null);
      else setDraftTpSl((d) => ({ tp: d?.tp ?? pos?.tp ?? null, sl: d?.sl ?? pos?.sl ?? null, [key]: null }));
    },
    [replayTrading, replayLast, mid, pos],
  );

  const handlePriceAlertDrag = useCallback((id: string, newPrice: number) => {
    updatePriceAlertPrice(id, newPrice);
  }, []);

  // ---- Overlay actions (live account only) ----
  const onOverlayConfirm = useCallback(() => {
    if (draftTpSl) {
      setPositionOverlay('tp', draftTpSl.tp, symbol);
      setPositionOverlay('sl', draftTpSl.sl, symbol);
    }
    setDraftTpSl(null);
  }, [draftTpSl, symbol]);
  const onOverlayDiscard = useCallback(() => setDraftTpSl(null), []);
  const onToggleTp = useCallback(() => {
    if (!pos) return;
    const cur = draftTpSl ? draftTpSl.tp : pos.tp;
    const atr = atr14Last(candles) ?? pos.entryPrice * 0.005;
    const sign = pos.side === 'long' ? 1 : -1;
    const next = cur != null ? null : Number((pos.entryPrice + sign * atr * 3).toFixed(1));
    setDraftTpSl((d) => ({ tp: next, sl: d?.sl ?? pos.sl ?? null }));
  }, [pos, draftTpSl, candles]);
  const onToggleSl = useCallback(() => {
    if (!pos) return;
    const cur = draftTpSl ? draftTpSl.sl : pos.sl;
    const atr = atr14Last(candles) ?? pos.entryPrice * 0.005;
    const sign = pos.side === 'long' ? 1 : -1;
    const next = cur != null ? null : Number((pos.entryPrice - sign * atr * 1.5).toFixed(1));
    setDraftTpSl((d) => ({ tp: d?.tp ?? pos.tp ?? null, sl: next }));
  }, [pos, draftTpSl, candles]);
  const doReverse = useCallback(() => {
    setShowReverseConfirm(false);
    if (!pos) return;
    const newSide = pos.side === 'long' ? 'sell' : 'buy';
    // Reverse = flatten current + open the opposite of equal size (2× units at
    // market). The new position opens with no exits — add TP/SL via the chips.
    paper.placeOrder({
      symbol, side: newSide, type: 'market', units: pos.units * 2, price: null,
      tp: null, sl: null, reduceOnly: false, postOnly: false, leverage: pos.leverage, midPrice: mid,
    });
    setDraftTpSl(null);
  }, [pos, symbol, mid, paper]);
  const doClose = useCallback(() => {
    setShowCloseConfirm(false);
    paper.closePosition(mid, symbol);
  }, [paper, mid, symbol]);

  const overlaySide = hasPosition && pos ? (pos.side === 'long' ? 'buy' : 'sell') : null;
  const overlayEntryPrice = hasPosition && pos ? pos.entryPrice : null;
  const overlayTpPrice = effTp;
  const overlaySlPrice = effSl;
  const overlayHasTp = effTp != null;
  const overlayHasSl = effSl != null;
  const overlayUnitsLabel = hasPosition && pos ? String(pos.units) : '—';
  const overlayTypeLabel = 'Market';
  const overlayLeverage = hasPosition && pos ? pos.leverage : LEVERAGE;

  // `qty | ±USD | ✕` pills on the TP/SL lines (projected P&L). The entry pill is
  // rendered in the DOM TradeOverlay row instead of on the canvas.
  const overlayBadges = useMemo<OverlayLineBadge[]>(() => {
    if (!hasPosition || !pos) return [];
    const side = pos.side === 'long' ? 'buy' as const : 'sell' as const;
    const b: OverlayLineBadge[] = [];
    if (effTp != null) b.push({ kind: 'tp', qty: String(pos.units), pnl: projectedPnl(side, pos.units, pos.entryPrice, effTp) });
    if (effSl != null) b.push({ kind: 'sl', qty: String(pos.units), pnl: projectedPnl(side, pos.units, pos.entryPrice, effSl) });
    return b;
  }, [hasPosition, pos, effTp, effSl]);

  // Data for the on-chart TradeOverlay control row (null when flat / replay).
  const tradeOverlay = useMemo(
    () =>
      hasPosition && pos && !replayTrading
        ? {
            entryPrice: pos.entryPrice,
            qty: pos.units,
            pnl: unrealizedPnl(pos, mid),
            isDirty,
            hasTp: effTp != null,
            hasSl: effSl != null,
          }
        : null,
    [hasPosition, pos, mid, replayTrading, isDirty, effTp, effSl],
  );

  // Price alerts for this symbol → dashed lines on the chart + management pills.
  const allPriceAlerts = usePriceAlerts();
  const symbolAlerts = useMemo(
    () => allPriceAlerts.filter((a) => a.symbol === symbol),
    [allPriceAlerts, symbol],
  );
  const priceLines = useMemo(
    () =>
      symbolAlerts.map((a) => ({
        id: a.id,
        price: a.price,
        color: !a.enabled ? '#7b88a0' : a.side === 'above' ? '#22d39a' : '#fb5168',
        title: `🔔 ${a.price}`,
      })),
    [symbolAlerts],
  );

  // Indicator settings
  const [indicatorSettings, setIndicatorSettings] = useState<Record<string, IndicatorSettings>>(() => {
    const state: Record<string, IndicatorSettings> = {};
    if (typeof window !== 'undefined') {
      try {
        const defaultsStr = localStorage.getItem('indicator_defaults') || '{}';
        const defaultsObj = JSON.parse(defaultsStr);
        activeIndicatorIds.forEach(id => {
          if (defaultsObj[id]) state[id] = defaultsObj[id];
        });
      } catch {}
    }
    return state;
  });

  useEffect(() => {
    setIndicatorSettings((prev) => {
      let changed = false;
      const next = { ...prev };
      try {
        const defaultsStr = localStorage.getItem('indicator_defaults') || '{}';
        const defaultsObj = JSON.parse(defaultsStr);
        activeIndicatorIds.forEach((id) => {
          if (!next[id] && defaultsObj[id]) {
            next[id] = defaultsObj[id];
            changed = true;
          }
        });
      } catch {}
      return changed ? next : prev;
    });
  }, [activeIndicatorIds]);

  const handleUpdateIndicatorSettings = useCallback((id: string, settings: IndicatorSettings) => {
    setIndicatorSettings((prev) => ({ ...prev, [id]: settings }));
  }, []);

  const sectionRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartHeight, setChartHeight] = useState(FALLBACK_HEIGHT);
  const chartApiRef = useRef<ChartApi | null>(null);

  // Measure the chart drawing area for the SVG drawing overlay + chart height.
  // The chart box is flex-1, so its height is determined by the remaining
  // space after the toolbar/OHLC/replay bar — this keeps both axes visible.
  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      if (rect.width > 0) setChartWidth(rect.width);
      if (rect.height > 0) setChartHeight(rect.height);
    });
    ro.observe(el);
    setChartWidth(el.clientWidth);
    setChartHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Track fullscreen state via the Fullscreen API so the toolbar icon
  // and `Esc` handler can stay in sync.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // Keyboard: `F` toggles fullscreen on this section, `Esc` exits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
        e.preventDefault();
      } else if (e.key === 'Escape' && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);



  const handleChartReady = useCallback((api: ChartApi) => {
    chartApiRef.current = api;
    setChartApi(api);
  }, []);

  const fitContent = useCallback(() => {
    chartApiRef.current?.fitContent();
  }, []);

  // Fit the view after a jump-to-date / return-to-live (once data has rendered).
  useEffect(() => {
    if (!fitSignal) return;
    const id = requestAnimationFrame(() => chartApiRef.current?.fitContent());
    return () => cancelAnimationFrame(id);
  }, [fitSignal]);

  const loading = candles.length === 0;

  // Pre-calculate synthetic/smoothed candles (Renko/Heikin Ashi) so indicators
  // align with the actual visual bricks/smoothed prices rather than raw time-based candles.
  const baseCandlesForIndicators = useBaseCandles(candles, type, renkoOptions);

  // The whole indicator stack, computed once per candle/settings change.
  // We process sequentially so that indicators can use prior indicators as inputs.
  const indicatorResults = useMemo(() => {
    if (loading) return [];
    
    const computedSources: Record<string, (number | null)[]> = {};
    const results: Array<{ key: string; result: NonNullable<ReturnType<typeof CUSTOM_INDICATORS[number]['compute']>> }> = [];
    
    activeIndicatorIds.forEach((id) => {
      const def = CUSTOM_INDICATORS.find((d) => d.id === id);
      if (!def) return;
      
      let result;
      try {
        result = def.compute(baseCandlesForIndicators, { id, settings: indicatorSettings[id] }, computedSources);
      } catch (err) {
        // One indicator throwing must not blank the entire chart.
        console.error(`Indicator "${id}" failed to compute:`, err);
        result = { plots: [], signals: Array.from({ length: baseCandlesForIndicators.length }, () => 'neutral' as const) };
      }

      // Feed line/histogram plot outputs into the computed sources for downstream indicators
      result.plots.forEach(plot => {
        if (plot.type === 'line' || plot.type === 'histogram') {
          const dataArr = plot.data.map(d => {
            if (typeof d === 'number') return d;
            if (!d) return null;
            if ('value' in d) return d.value;
            return null;
          });
          computedSources[`${id}:${plot.id}`] = dataArr;
        }
      });
      
      results.push({ key: id, result });
    });
    
    return results;
  }, [baseCandlesForIndicators, loading, activeIndicatorIds, indicatorSettings]);

  // The primary (first) indicator still drives the legend + settings modal.
  const indicatorResult = indicatorResults[0]?.result ?? null;

  // The in-chart legend's Remove ('') maps to removing the primary indicator.
  const handleChartIndicatorChange = useCallback(
    (id: string) => {
      if (id === '') {
        if (primaryId) onToggleIndicator(primaryId);
      } else {
        onToggleIndicator(id);
      }
    },
    [primaryId, onToggleIndicator],
  );

  return (
    <section
      ref={sectionRef}
      className={[
        'flex flex-col flex-1 min-h-0 w-full overflow-hidden',
        isFullscreen ? 'fixed inset-0 z-50 bg-base' : '',
      ].join(' ')}
    >
      <ChartToolbar
        symbol={symbol}
        price={displayPrice}
        change={change}
        status={status}
        selected={selected}
        onSelectTf={onSelectTf}
        chartType={type}
        onSelectType={onTypeChange}
        showSignals={showSignals}
        onToggleSignals={toggleSignals}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onFitContent={fitContent}
        renko={renkoConfig}
        onRenkoChange={setRenkoConfig}
        activeIndicatorIds={activeIndicatorIds}
        onToggleIndicator={onToggleIndicator}
        onClearIndicators={onClearIndicators}
        replayActive={replayMode !== 'off'}
        onReplayToggle={onReplayToggle}
        historyActive={historyActive}
        onJumpToDate={onJumpToDate}
        onReturnToLive={onReturnToLive}
        gridCount={gridCount}
        onGridChange={onGridChange}
        workspaceCurrent={workspaceCurrent}
        onWorkspaceApply={onWorkspaceApply}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={onToggleSidebar}
      />
      <div className="flex min-h-0 flex-1">
        <DrawingToolbar
          tool={drawingTool}
          onToolChange={setDrawingTool}
          color={drawingColor}
          onColorChange={setDrawingColor}
          magnet={magnet}
          onMagnetToggle={() => setMagnet((v) => !v)}
          locked={drawingsLocked}
          onLockToggle={() => setDrawingsLocked((v) => !v)}
          hidden={drawingsHidden}
          onHiddenToggle={() => setDrawingsHidden((v) => !v)}
          onClear={() => clearDrawings(symbol)}
          count={drawingsForSymbol.length}
        />
        <div ref={chartBoxRef} className="relative min-h-0 min-w-0 flex-1">
        {loading && <ChartSkeleton height={chartHeight} />}
        {!loading && (
          <Chart
            candles={baseCandlesForIndicators}
            candlesByTf={candlesByTf}
            type={type}
            height={chartHeight}
            indicatorResult={indicatorResult}
            indicatorResults={indicatorResults}
            priceScaleMode={priceScaleMode}
            onPriceScaleModeChange={setPriceScaleMode}
            showSignals={showSignals}
            renko={renkoOptions}
            onReady={handleChartReady}
            onLoadOlder={replayMode === 'off' ? onLoadOlder : undefined}
            tf={selected}
            showVolume={parentShowVolume}
            onQuickTrade={handleQuickTrade}
            onOpenRenkoSettings={() => setShowRenkoSettings(true)}
            bid={bid}
            ask={ask}
            overlays={overlays}
            onOverlayDrag={handleOverlayDrag}
            onOverlayChipClick={handleOverlayChipClick}
            overlaySide={overlaySide}
            overlayTypeLabel={overlayTypeLabel}
            overlayEntryPrice={overlayEntryPrice}
            overlayTpPrice={overlayTpPrice}
            overlaySlPrice={overlaySlPrice}
            overlayHasTp={overlayHasTp}
            overlayHasSl={overlayHasSl}
            overlayUnitsLabel={overlayUnitsLabel}
            overlayLeverage={overlayLeverage}
            overlayBadges={overlayBadges}
            tradeOverlay={tradeOverlay}
            onOverlayDiscard={onOverlayDiscard}
            onOverlayConfirm={onOverlayConfirm}
            onOverlayToggleTp={onToggleTp}
            onOverlayToggleSl={onToggleSl}
            onOverlayReverse={() => setShowReverseConfirm(true)}
            onOverlayClose={() => setShowCloseConfirm(true)}
            priceLines={priceLines}
            onPriceLineDrag={handlePriceAlertDrag}
            onChartContextMenu={(p, x, y) => setCtxMenu({ price: p, x, y })}
            activeIndicatorId={primaryId}
            onIndicatorChange={handleChartIndicatorChange}
            indicatorSettings={indicatorSettings[primaryId]}
            onUpdateIndicatorSettings={(settings) => handleUpdateIndicatorSettings(primaryId, settings)}
            activeIndicatorIds={activeIndicatorIds}
            indicatorSettingsMap={indicatorSettings}
            onRemoveIndicator={onToggleIndicator}
            onUpdateIndicatorSettingsFor={handleUpdateIndicatorSettings}
            resetTick={resetTick}
          />
        )}
        {!loading && (
          <DrawingLayer
            api={chartApi}
            symbol={symbol}
            tool={drawingTool}
            color={drawingColor}
            magnet={magnet}
            locked={drawingsLocked}
            hidden={drawingsHidden}
            width={chartWidth}
            height={chartHeight}
            revision={candles.length}
            onToolUsed={() => setDrawingTool('cursor')}
          />
        )}
        {!loading && replayMode === 'selecting' && (
          <ReplaySelector
            api={chartApi}
            width={chartWidth}
            height={chartHeight}
            onPick={onReplayPick}
            onCancel={() => setReplayMode('off')}
          />
        )}
        </div>
      </div>

      {replayMode !== 'off' && (
        <div className="border-t border-line bg-surface-2/40 px-3 py-2">
          <ReplayBar
            selecting={replayMode === 'selecting'}
            playing={replayPlaying}
            index={playIndex}
            total={candles.length}
            speed={replaySpeed}
            bookmarks={bookmarks}
            onExit={() => {
              setReplayMode('off');
              setReplayPlaying(false);
            }}
            onTogglePlay={() => setReplayPlaying((p) => !p)}
            onStep={stepReplay}
            onScrub={(i) => setPlayIndex(i)}
            onSpeed={setReplaySpeed}
            onBookmark={() => setBookmarks((b) => (b.includes(playIndex) ? b : [...b, playIndex].sort((x, y) => x - y)))}
            onJumpBookmark={(i) => setPlayIndex(i)}
            onRemoveBookmark={(i) => setBookmarks((b) => b.filter((x) => x !== i))}
          />
        </div>
      )}

      {symbolAlerts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-surface-2/40 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Price alerts
          </span>
          {symbolAlerts.map((a) => (
            <span
              key={a.id}
              className={[
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums',
                !a.enabled
                  ? 'border-line text-ink-faint'
                  : a.side === 'above'
                    ? 'border-bull/30 text-bull-bright'
                    : 'border-bear/30 text-bear-bright',
              ].join(' ')}
            >
              {a.side === 'above' ? '▲' : '▼'} {a.price}
              <button
                onClick={() => removePriceAlert(a.id)}
                className="ml-0.5 text-ink-faint transition hover:text-ink"
                aria-label={`Remove alert at ${a.price}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {showRenkoSettings && (
        <RenkoSettingsModal
          initialConfig={renkoConfig}
          onClose={() => setShowRenkoSettings(false)}
          onSave={setRenkoConfig}
        />
      )}

      {ctxMenu && (
        <ChartContextMenu
          price={ctxMenu.price}
          x={ctxMenu.x}
          y={ctxMenu.y}
          symbol={symbol}
          midPrice={mid}
          leverage={LEVERAGE}
          onClose={() => setCtxMenu(null)}
          onResetChart={() => setResetTick(t => t + 1)}
        />
      )}

      <OrderModal
        open={ticketSide !== null}
        onClose={() => setTicketSide(null)}
        symbol={symbol}
        midPrice={mid}
        leverage={LEVERAGE}
        onLeverageChange={() => {}}
        reduceAvailable={hasPosition && pos ? pos.units : 0}
        initialSide={ticketSide ?? undefined}
      />

      <ReverseConfirmDialog
        open={showReverseConfirm}
        side={overlaySide ?? 'buy'}
        symbol={symbol}
        onConfirm={doReverse}
        onCancel={() => setShowReverseConfirm(false)}
      />
      <CloseConfirmDialog
        open={showCloseConfirm}
        pnl={hasPosition && pos ? unrealizedPnl(pos, mid) : 0}
        onConfirm={doClose}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </section>
  );
}

function ChartSkeleton(_props: { height: number }) {
  return (
    <div
      role="status"
      aria-label="Loading chart"
      className="absolute inset-0 flex items-center justify-center overflow-hidden bg-chart-bg"
    >
      <div
        className="h-full w-full"
        style={{
          backgroundImage:
            'linear-gradient(90deg, transparent 0%, oklch(0.30 0.03 264 / 0.5) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s linear infinite',
        }}
      />
      <span className="sr-only">Loading chart…</span>
    </div>
  );
}
