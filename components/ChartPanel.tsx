'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart, { type ChartType, type PriceScaleModeOption, type ChartOverlay, type OverlayKind, type ChartApi } from './Chart';
import ChartErrorBoundary from '@/components/chart/ChartErrorBoundary';
import { type RenkoConfig, DEFAULT_RENKO, renkoConfigToOptions } from '@/lib/renko';
import ChartContextMenu from './trade/ChartContextMenu';
import { usePaperStore, setPositionOverlay } from '@/lib/paperStore';
import { projectedPnl, unrealizedPnl } from '@/lib/paper';
import ReverseConfirmDialog from '@/components/trade/ReverseConfirmDialog';
import CloseConfirmDialog from '@/components/trade/CloseConfirmDialog';
import type { OverlayLineBadge } from '@/lib/orderOverlayPrimitive';
import { setMarkPrice } from '@/lib/markPriceStore';
import {
  configureReplaySession,
  getLastSessionConfig,
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
import { useChartSettings } from './chart/useChartSettings';
import { CHART_SETTINGS_SHORTCUTS } from './chart/chartSettingsKeys';
import { featureFlags } from '@/lib/featureFlags';
import type { Candle, Timeframe } from '@/lib/types';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { IndicatorSettings } from '@/lib/indicatorFramework';
import { useBaseCandles } from '@/lib/chartHelpers';
import { setReplayCut, clearReplayCut } from '@/lib/replay/replayCut';
import { validateReplayData } from '@/lib/replay/validate';
import { replayActions, useReplayState, isReplayActive, getReplayState } from '@/lib/replay/replayState';
import { replayIndexForTime, TF_SECONDS } from '@/lib/replay/replaySlice';
import { earliestReplayDateMs } from '@/lib/replay/deepLoad';
import { verifyReplayIntegrity, type IntegrityReport } from '@/lib/replay/verify';
import { buildTrainingReport, type TrainingReport } from '@/lib/replay/trainingReport';
import TrainingReportModal from '@/components/replay/TrainingReportModal';
import SessionSetupCard from '@/components/replay/SessionSetupCard';
import SessionHud from '@/components/replay/SessionHud';
import SessionReportModal from '@/components/replay/SessionReportModal';
import { vdAtr } from '@/lib/indicators/vdEngine';
import type { SessionConfig, TradeBehavior } from '@/lib/replay/sessionSim';
import type { PaperTrade } from '@/lib/paper';

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
  onRemoveIndicator?: (id: string) => void;
  onClearIndicators: () => void;
  /** Lazy-load older history for the selected timeframe. */
  onLoadOlder?: () => void;
  /** Deep-backfill history to a target date (replay practice from years back). */
  onDeepLoadHistory?: (targetMs: number, onProgress?: (p: { tf: Timeframe; pages: number; oldestMs: number }) => void) => Promise<void>;
  /** Jump-to-date: a focused historical window is being shown. */
  historyActive?: boolean;
  onJumpToDate?: (ms: number) => void;
  onReturnToLive?: () => void;
  /** Bump to fit the chart to the current data (after a jump / return). */
  fitSignal?: number;
  /** Grid layout controls forwarded to the toolbar. */
  gridCount: import('@/lib/gridLayout').GridCount;
  onGridChange: (n: import('@/lib/gridLayout').GridCount) => void;
  /**
   * Optional multi-pane mode. When > 1, the inner chart is rendered
   * with `additionalPanes` (TV-style stacked panes). v1 supports 2 or 4.
   */
  paneCount?: import('@/lib/gridLayout').LayoutCount;
  /** When set, ChartPanel renders this multi-chart grid as its body instead
   *  of the single chart — so the toolbar (TF/type/indicators/layout switcher)
   *  and trade controls stay available in multi-chart layouts. */
  multiChartSlot?: React.ReactNode;
  /** Full layout (mode + count + sync). Forwarded to the toolbar. */
  layout?: import('@/lib/gridLayout').Layout;
  onLayoutChange?: (next: import('@/lib/gridLayout').Layout) => void;
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
  onRemoveIndicator,
  onClearIndicators,
  onLoadOlder,
  onDeepLoadHistory,
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
  paneCount = 1,
  multiChartSlot,
  layout,
  onLayoutChange,
}: ChartPanelProps) {
  const primaryId = activeIndicatorIds[0] ?? '';


  // BUY/SELL signal markers on the chart, on by default.
  const [showSignals, setShowSignals] = useState(true);
  const toggleSignals = useCallback(() => setShowSignals((v) => !v), []);



  // Renko box-size config (method + params).
  const [renkoConfig, setRenkoConfig] = useState<RenkoConfig>(DEFAULT_RENKO);
  const renkoOptions = useMemo(() => renkoConfigToOptions(renkoConfig), [renkoConfig]);
  const [showRenkoSettings, setShowRenkoSettings] = useState(false);

  // TV-style chart settings (gear popover). Source of truth for price-scale
  // mode, invert, auto-scale, active price-scale id, etc. Some keys persist
  // to localStorage (see useChartSettings.ts).
  const {
    settings: chartSettings,
    patch: patchChartSettings,
    reset: resetChartSettings,
  } = useChartSettings();
  const priceScaleMode = chartSettings.scaleMode;
  const setPriceScaleMode = (m: PriceScaleModeOption) => patchChartSettings({ scaleMode: m });

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

  // ---- Bar Replay (state machine: lib/replay/replayState.ts) ----
  const { phase: replayPhase, playIndex, startIndex: replayStartIndex } = useReplayState();
  const replayActive = isReplayActive(replayPhase);
  const replayPlaying = replayPhase === 'playing';
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [bookmarks, setBookmarks] = useState<number[]>([]);

  // Reset replay only when the SYMBOL changes. A timeframe change REBASES
  // instead (Phase 3 multi-TF replay): the wall-clock moment is preserved
  // and the head indices are re-derived on the new TF's candles.
  useEffect(() => {
    replayActions.exit();
    setBookmarks([]);
  }, [symbol]);

  const lastTfRef = useRef(selected);
  useEffect(() => {
    if (lastTfRef.current === selected) return;
    lastTfRef.current = selected;
    setBookmarks([]); // bookmark indices are TF-specific
    const st = getReplayState();
    if (!isReplayActive(st.phase) || st.cutTime == null || candles.length === 0) return;
    const head = replayIndexForTime(candles, selected, st.cutTime);
    // TP/SL reconciliation is index-based per TF: resume from the new head
    // instead of replaying bars that were already reconciled on the old TF.
    lastReconciledRef.current = head;
    replayActions.rebase(head, replayIndexForTime(candles, selected, st.startTime ?? st.cutTime));
  }, [selected, candles]);

  // Keep the wall-clock moment in sync as the head moves on the eval TF.
  useEffect(() => {
    if (!replayActive) return;
    const bar = candles[playIndex];
    if (bar) replayActions.syncCutTime(bar.time + TF_SECONDS[selected]);
  }, [replayActive, playIndex, candles, selected]);

  // Advance one candle per tick while playing; the machine flips to
  // 'finished' when the head reaches the last bar.
  useEffect(() => {
    if (!replayPlaying) return;
    const interval = Math.max(40, 600 / replaySpeed);
    const id = setInterval(() => replayActions.stepBy(1, candles.length), interval);
    return () => clearInterval(id);
  }, [replayPlaying, replaySpeed, candles.length]);

  // Candles fed to the chart: full unless replay is armed (then sliced).
  const replayCandles = useMemo(() => {
    if (!replayActive) return candles;
    const end = Math.max(2, Math.min(playIndex + 1, candles.length));
    return candles.slice(0, end);
  }, [replayActive, playIndex, candles]);

  // Data problems surface instead of silently replaying corrupt history.
  const [replayDataError, setReplayDataError] = useState<string | null>(null);

  const onReplayToggle = () => {
    if (replayPhase === 'idle') {
      const v = validateReplayData(candles, selected);
      if (!v.ok) {
        setReplayDataError(`Replay cannot start — ${v.problems.join(' ')}`);
        return;
      }
      setReplayDataError(null);
      replayActions.enterSelecting();
    } else {
      replayActions.exit();
    }
  };

  const lastReconciledRef = useRef(-1);
  const onReplayPick = (index: number) => {
    const start = Math.max(1, Math.min(index, candles.length - 1));
    lastReconciledRef.current = start; // don't reconcile bars before the cut
    startReplaySession(symbol); // fresh isolated account for this replay
    setSessionSkipped(false);
    setBookmarks([]);
    replayActions.startAt(start, candles[start] ? candles[start].time + TF_SECONDS[selected] : null);
  };

  const stepReplay = (dir: 1 | -1) => replayActions.stepBy(dir, candles.length);

  // ---- Phase 4: blind drill + training report ----
  const [blindMode, setBlindMode] = useState(false);
  // Trading-session simulator (replayBar.md): setup -> HUD -> end report.
  const [sessionSkipped, setSessionSkipped] = useState(false);
  const [sessionReport, setSessionReport] = useState<{
    config: SessionConfig;
    trades: PaperTrade[];
    behaviors: TradeBehavior[];
  } | null>(null);
  const [trainingReport, setTrainingReport] = useState<TrainingReport | null>(null);

  // Jump-to-datetime start (selection mode): pick the bar containing the
  // moment. If the date is older than loaded history, deep-backfill first
  // (5-year practice) with live progress, then pick against the FRESH data
  // via ref — the closure's `candles` is stale after the awaits.
  const [deepLoading, setDeepLoading] = useState<{ tf: Timeframe; pages: number; oldestMs: number } | null>(null);
  const candlesForPickRef = useRef(candles);
  candlesForPickRef.current = candles;
  const onPickTime = useCallback(
    async (ms: number) => {
      const t = Math.floor(ms / 1000);
      if (onDeepLoadHistory && candlesForPickRef.current[0] && t < candlesForPickRef.current[0].time) {
        setDeepLoading({ tf: selected, pages: 0, oldestMs: Date.now() });
        try {
          await onDeepLoadHistory(ms, (p) => setDeepLoading(p));
        } finally {
          setDeepLoading(null);
        }
      }
      const cur = candlesForPickRef.current;
      let idx = cur.length - 1;
      while (idx > 1 && cur[idx].time > t) idx--;
      onReplayPick(idx);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDeepLoadHistory, selected],
  );

  // Blind drill: random hidden start with room to trade, dates masked.
  const onDrill = useCallback(() => {
    const len = candles.length;
    if (len < 120) return;
    const lo = Math.max(1, Math.floor(len * 0.2));
    const hi = Math.max(lo + 1, len - 60);
    setBlindMode(true);
    onReplayPick(lo + Math.floor(Math.random() * (hi - lo)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length]);

  // Replay Verification (developer mode): re-proves the Prime Invariant and
  // engine determinism at the current bar. Cleared whenever the head moves.
  const [verification, setVerification] = useState<IntegrityReport | null>(null);
  const runVerification = useCallback(() => {
    setVerification(
      verifyReplayIntegrity({ candles, playIndex, evalTf: selected, candlesByTf: candlesByTf ?? {} }),
    );
  }, [candles, playIndex, selected, candlesByTf]);
  useEffect(() => {
    setVerification(null);
  }, [playIndex, replayPhase]);

  // Duration snapshot for the training report (indices reset on exit).
  const replayDurationRef = useRef(0);
  useEffect(() => {
    if (replayActive) replayDurationRef.current = Math.max(0, playIndex - replayStartIndex);
  }, [replayActive, playIndex, replayStartIndex]);

  const replayLast = replayCandles[replayCandles.length - 1];
  // ATR(14) of the replay-visible candles for HUD stop prefill; keyed on the
  // closed-bar signature so playback ticks reuse it.
  const hudAtr = useMemo(() => {
    if (replayCandles.length < 20) return 0;
    const a = vdAtr(replayCandles);
    return a[a.length - 1] ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayCandles.length, replayCandles[replayCandles.length - 1]?.time]);
  const displayPrice = replayActive && replayLast ? replayLast.close : price;

  // Publish the current mark (replay bar's close during replay, else live).
  useEffect(() => {
    if (replayActive && replayLast) {
      setMarkPrice(symbol, replayLast.close, replayLast.time);
    } else if (price != null && Number.isFinite(price)) {
      const liveLast = candles[candles.length - 1];
      setMarkPrice(symbol, price, liveLast ? liveLast.time : Math.floor(Date.now() / 1000));
    }
  }, [replayActive, replayLast, price, symbol, candles]);

  // End the isolated session when leaving replay (the live account is never
  // touched during replay — they run independently). NOTE: the unmount
  // cleanup lives in its own []-effect — returning it from THIS effect made
  // React run it on every replayActive flip, including false→true, which
  // disarmed the session store immediately after startReplaySession().
  useEffect(() => {
    if (!replayActive) {
      endReplaySession();
      lastReconciledRef.current = -1;
    }
  }, [replayActive]);
  useEffect(() => () => endReplaySession(), []);

  // Publish the replay moment so app-level analytics (mood engine, scanner,
  // SMC, market context) can enforce the Prime Invariant: no consumer sees
  // candles beyond the current replay bar.
  useEffect(() => {
    if (replayActive && replayLast) setReplayCut(selected, replayLast);
    else clearReplayCut();
  }, [replayActive, replayLast, selected]);
  useEffect(() => () => clearReplayCut(), []);

  // As replay reveals new bars (forward only), reconcile the SESSION's position
  // so a TP/SL hit auto-closes and logs a trade at the replay bar's time.
  useEffect(() => {
    if (!replayActive) return;
    for (let i = Math.max(1, lastReconciledRef.current + 1); i <= playIndex && i < candles.length; i++) {
      replayReconcileBar(candles[i]);
    }
    if (playIndex > lastReconciledRef.current) lastReconciledRef.current = playIndex;
  }, [replayActive, playIndex, candles]);

  // ---- Chart → trade wiring ----
  const LEVERAGE = 10;
  const paper = usePaperStore();
  const session = useReplaySession();

  // Training report: whenever replay ends (Exit button, Esc, toolbar toggle,
  // symbol change), grade the session if any trades were closed. The session
  // store keeps its trades after endReplaySession, so reading here is safe.
  const prevPhaseRef = useRef(replayPhase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = replayPhase;
    if (prev !== 'idle' && replayPhase === 'idle') {
      setBlindMode(false);
      if (session.config && session.trades.length > 0) {
        setSessionReport({ config: session.config, trades: session.trades, behaviors: session.behaviors });
      } else if (session.trades.length > 0) {
        setTrainingReport(buildTrainingReport(session.trades, replayDurationRef.current));
      }
    }
  }, [replayPhase, session.trades]);
  // During replay the chart reflects the ISOLATED session's position; otherwise
  // the live account's.
  const replayTrading = replayActive;
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
            side: pos.side as 'long' | 'short', // hasPosition guarantees non-flat
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
          if (defaultsObj[id.split('::')[0]]) state[id] = defaultsObj[id.split('::')[0]];
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
          const baseId = id.split('::')[0];
          if (!next[id] && defaultsObj[baseId]) {
            next[id] = defaultsObj[baseId];
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

  // Keyboard: `F` toggles fullscreen; `Esc` exits fullscreen.
  // Chart-settings shortcuts (Alt+R / Alt+I / Alt+P / Alt+L) when the feature
  // flag is on. Skipped while the settings popover is open or focus is in
  // an editable field.
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      if (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      ) {
        return true;
      }
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      // Popover-open guard: the toolbar sets this dataset attr while the gear
      // popover is mounted so user typing into the ratio input doesn't
      // trigger chart resets.
      if (document.body.dataset.chartSettingsOpen === '1') return;

      if (isEditable(e.target)) return;

      // Alt-modified shortcuts (chart settings popover).
      if (
        featureFlags.chartSettings &&
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey
      ) {
        const k = e.key.toLowerCase();
        if (k === CHART_SETTINGS_SHORTCUTS.reset.key) {
          // Reset price scale.
          patchChartSettings({
            autoScale: true,
            invertScale: false,
            scaleMode: 'normal',
            labelsStatusLine: true,
          });
          chartApiRef.current?.fitContent();
          e.preventDefault();
          return;
        }
        if (k === CHART_SETTINGS_SHORTCUTS.invert.key) {
          patchChartSettings({ invertScale: !chartSettings.invertScale });
          e.preventDefault();
          return;
        }
        if (k === CHART_SETTINGS_SHORTCUTS.cycleMode.key) {
          const order = ['normal', 'percent', 'log'] as const;
          const cur = order.indexOf(chartSettings.scaleMode);
          const next = order[(cur + 1) % order.length];
          patchChartSettings({ scaleMode: next });
          e.preventDefault();
          return;
        }
        if (k === CHART_SETTINGS_SHORTCUTS.log.key) {
          patchChartSettings({
            scaleMode: chartSettings.scaleMode === 'log' ? 'normal' : 'log',
          });
          e.preventDefault();
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ---- Replay shortcuts (Phase 2.C): Space, ←/→, Shift+←/→, Home, Esc ----
      if (replayActive) {
        if (e.key === ' ') {
          if (replayPlaying) replayActions.pause();
          else replayActions.play();
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowRight') {
          replayActions.stepBy(e.shiftKey ? 10 : 1, candles.length);
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowLeft') {
          replayActions.stepBy(e.shiftKey ? -10 : -1, candles.length);
          e.preventDefault();
          return;
        }
        if (e.key === 'Home') {
          replayActions.scrubTo(replayStartIndex, candles.length);
          e.preventDefault();
          return;
        }
        if (e.key === 'Escape') {
          replayActions.exit();
          e.preventDefault();
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
  }, [toggleFullscreen, patchChartSettings, chartSettings.invertScale, chartSettings.scaleMode, replayActive, replayPlaying, replayStartIndex, candles.length]);



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
  // Fed from replayCandles so Bar Replay actually truncates the chart AND the
  // indicator stack (no future data leaks into calculations during replay);
  // outside replay, replayCandles === candles.
  const baseCandlesForIndicators = useBaseCandles(replayCandles, type, renkoOptions);

  // Multi-pane: the main candle pane counts as pane #1, so a "N panes
  // stacked" layout needs N-1 additional panes. v1: all panes share the
  // active TF. We compute this here so the inner chart's
  // `useAdditionalPanes` hook has a stable prop.
  const additionalPanes = useMemo(() => {
    if (paneCount <= 1) return undefined;
    return Array.from({ length: paneCount - 1 }, (_, i) => ({
      key: `pane-${i}`,
      candles: baseCandlesForIndicators,
    }));
  }, [paneCount, baseCandlesForIndicators]);

  // Every pane (main + additional) gets an equal share of the chart height,
  // so the additional panes together get (N-1)/N of it.
  const additionalPanesTotalHeight =
    paneCount > 1 ? Math.max(0, Math.round((chartHeight * (paneCount - 1)) / paneCount)) : 0;



  // The whole indicator stack, computed once per candle/settings change.
  // We process sequentially so that indicators can use prior indicators as inputs.
  const indicatorResults = useMemo(() => {
    if (loading) return [];
    
    const computedSources: Record<string, (number | null)[]> = {};
    const results: Array<{ key: string; result: NonNullable<ReturnType<typeof CUSTOM_INDICATORS[number]['compute']>> }> = [];
    
    activeIndicatorIds.forEach((id) => {
      const def = CUSTOM_INDICATORS.find((d) => d.id === id.split('::')[0]);
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
        onOpenRenkoSettings={() => setShowRenkoSettings(true)}
        activeIndicatorIds={activeIndicatorIds}
        onToggleIndicator={onToggleIndicator}
        onClearIndicators={onClearIndicators}
        replayActive={replayPhase !== 'idle'}
        onReplayToggle={onReplayToggle}
        historyActive={historyActive}
        onJumpToDate={onJumpToDate}
        onReturnToLive={onReturnToLive}
        gridCount={gridCount}
        onGridChange={onGridChange}
        layout={layout}
        onLayoutChange={onLayoutChange}
        workspaceCurrent={workspaceCurrent}
        onWorkspaceApply={onWorkspaceApply}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={onToggleSidebar}
        chartSettings={featureFlags.chartSettings ? chartSettings : undefined}
        onChartSettingsPatch={featureFlags.chartSettings ? patchChartSettings : undefined}
        onChartSettingsReset={featureFlags.chartSettings ? resetChartSettings : undefined}
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
        {!loading && multiChartSlot && (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-line bg-surface-2/50 px-3 py-1.5">
              <button
                type="button"
                onClick={() => handleQuickTrade('sell')}
                className="focus-ring rounded-md border border-bear/40 bg-bear/10 px-3 py-1 text-xs font-semibold text-bear-bright transition hover:bg-bear/20"
              >
                Sell{bid != null ? ` ${bid.toFixed(1)}` : ''}
              </button>
              <button
                type="button"
                onClick={() => handleQuickTrade('buy')}
                className="focus-ring rounded-md border border-bull/40 bg-bull/10 px-3 py-1 text-xs font-semibold text-bull-bright transition hover:bg-bull/20"
              >
                Buy{ask != null ? ` ${ask.toFixed(1)}` : ''}
              </button>
              <span className="ml-1 text-[11px] text-ink-faint">Order applies to {symbol}</span>
            </div>
            <div className="relative min-h-0 flex-1">{multiChartSlot}</div>
          </div>
        )}
        {!loading && !multiChartSlot && (
          <ChartErrorBoundary>
            <Chart
              candles={baseCandlesForIndicators}
              candlesByTf={candlesByTf}
              type={type}
              height={chartHeight}
              additionalPanes={additionalPanes}
              additionalPanesTotalHeight={additionalPanesTotalHeight}
              indicatorResult={indicatorResult}
              indicatorResults={indicatorResults}
              priceScaleMode={priceScaleMode}
              onPriceScaleModeChange={setPriceScaleMode}
              chartSettings={featureFlags.chartSettings ? chartSettings : undefined}
              showSignals={showSignals}
              renko={renkoOptions}
              onReady={handleChartReady}
              maskTimeAxis={blindMode}
              onLoadOlder={replayPhase === 'idle' ? onLoadOlder : undefined}
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
              onRemoveIndicator={onRemoveIndicator}
              onUpdateIndicatorSettingsFor={handleUpdateIndicatorSettings}
              resetTick={resetTick}
            />
          </ChartErrorBoundary>
        )}
        {!loading && !multiChartSlot && (
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
        {!loading && replayPhase === 'selecting' && (
          <ReplaySelector
            api={chartApi}
            width={chartWidth}
            height={chartHeight}
            onPick={onReplayPick}
            onCancel={() => replayActions.exit()}
          />
        )}
        </div>
      </div>

      {replayDataError && (
        <div className="flex items-center justify-between gap-2 border-t border-bear/30 bg-bear/10 px-3 py-2 text-[12px] text-bear-bright">
          <span>{replayDataError}</span>
          <button
            onClick={() => setReplayDataError(null)}
            className="focus-ring shrink-0 rounded p-0.5 transition hover:text-ink"
            aria-label="Dismiss replay data error"
          >
            ✕
          </button>
        </div>
      )}

      {replayPhase !== 'idle' && (
        <div className="border-t border-line bg-surface-2/40 px-3 py-2">
          <ReplayBar
            selecting={replayPhase === 'selecting'}
            playing={replayPlaying}
            phase={replayPhase}
            index={playIndex}
            total={candles.length}
            onVerify={featureFlags.replayDebug ? runVerification : undefined}
            verification={verification}
            onPickTime={onPickTime}
            minPickMs={earliestReplayDateMs(selected, Date.now())}
            deepLoading={deepLoading}
            onDrill={onDrill}
            blind={blindMode}
            onToggleBlind={() => setBlindMode((v) => !v)}
            speed={replaySpeed}
            bookmarks={bookmarks}
            onExit={() => replayActions.exit()}
            onTogglePlay={() => (replayPlaying ? replayActions.pause() : replayActions.play())}
            onStep={stepReplay}
            onScrub={(i) => replayActions.scrubTo(i, candles.length)}
            onSpeed={setReplaySpeed}
            onBookmark={() => setBookmarks((b) => (b.includes(playIndex) ? b : [...b, playIndex].sort((x, y) => x - y)))}
            onJumpBookmark={(i) => replayActions.scrubTo(i, candles.length)}
            onRemoveBookmark={(i) => setBookmarks((b) => b.filter((x) => x !== i))}
          />
        </div>
      )}
      {replayActive && !session.config && !sessionSkipped && !blindMode && (
        <div className="border-t border-line bg-surface-2/40 px-3 py-2">
          <SessionSetupCard
            initial={getLastSessionConfig()}
            onStart={(cfg) => configureReplaySession(cfg)}
            onSkip={() => setSessionSkipped(true)}
          />
        </div>
      )}
      {replayActive && session.config && replayLast && (
        <div className="border-t border-line bg-surface-2/40 px-3 py-2">
          <SessionHud
            session={session}
            lastClose={replayLast.close}
            lastTime={replayLast.time}
            atr={hudAtr}
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

      {trainingReport && (
        <TrainingReportModal report={trainingReport} onClose={() => setTrainingReport(null)} />
      )}
      {sessionReport && (
        <SessionReportModal
          config={sessionReport.config}
          trades={sessionReport.trades}
          behaviors={sessionReport.behaviors}
          onClose={() => setSessionReport(null)}
        />
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
