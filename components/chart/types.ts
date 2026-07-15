import type { LogicalRange, Time } from 'lightweight-charts';
import type { RenkoOptions } from '@/lib/renko';
import type { IndicatorResult, IndicatorSettings } from '@/lib/indicatorFramework';
import type { Candle } from '@/lib/types';
import type { OverlayLineBadge } from '@/lib/orderOverlayPrimitive';
import type { ChartSettingsState } from './useChartSettings';

export type ChartType = 'candlestick' | 'heikinAshi' | 'renko';

export type PriceScaleModeOption = 'normal' | 'log' | 'percent';

/** Coordinate + lifecycle API exposed via onReady, used by the drawing layer. */
export interface ChartApi {
  fitContent: () => void;
  /** chart-time → x pixel (null if off-scale). */
  timeToX: (time: number) => number | null;
  /** price → y pixel. */
  priceToY: (price: number) => number | null;
  /** x pixel → chart-time. */
  xToTime: (x: number) => number | null;
  /** y pixel → price. */
  yToPrice: (y: number) => number | null;
  /** The base candle nearest an x pixel (for magnet snapping to OHLC). */
  candleAtX: (x: number) => Candle | null;
  /** Rounded logical (candle) index at an x pixel — for the replay cut point. */
  logicalAt: (x: number) => number | null;
  /** Fires on horizontal pan/zoom; returns an unsubscribe fn. */
  subscribe: (cb: () => void) => () => void;
  setVisibleLogicalRange: (range: LogicalRange) => void;
  getVisibleLogicalRange: () => LogicalRange | null;
  setCrosshairTime: (time: number | null) => void;
  subscribeLogicalRange: (cb: (range: LogicalRange | null) => void) => () => void;
  subscribeCrosshairTime: (cb: (time: number | null) => void) => () => void;
}

/** One entry in the indicator stack: a stable instance key + its computed result. */
export interface IndicatorRender {
  key: string;
  result: IndicatorResult;
}

export type OverlayKind = 'entry' | 'tp' | 'sl';

export interface ChartOverlay {
  kind: OverlayKind;
  price: number;
  draggable?: boolean;
  color?: string;
}

export interface ChartProps {
  candles: Candle[];
  candlesByTf?: Record<string, Candle[]>;
  type: ChartType;
  tf?: string;
  height?: number;
  indicatorResult?: IndicatorResult | null;
  indicatorResults?: IndicatorRender[];
  priceScaleMode?: PriceScaleModeOption;
  onPriceScaleModeChange?: (mode: PriceScaleModeOption) => void;
  /** TV-style chart settings popover state. Optional; when omitted, the chart
   *  behaves as before (default price-scale mode = 'normal'). */
  chartSettings?: ChartSettingsState;
  showSignals?: boolean;
  renko?: RenkoOptions;
  priceLines?: { id: string; price: number; color: string; title: string }[];
  onPriceLineDrag?: (id: string, newPrice: number) => void;
  overlays?: ChartOverlay[];
  onOverlayDrag?: (kind: OverlayKind, price: number) => void;
  onOverlayChipClick?: (key: 'tp' | 'sl' | 'close') => void;
  overlaySide?: 'buy' | 'sell' | null;
  overlayUnitsLabel?: string;
  overlayTypeLabel?: string;
  overlayHasTp?: boolean;
  overlayHasSl?: boolean;
  overlayTpPrice?: number | null;
  overlaySlPrice?: number | null;
  overlayEntryPrice?: number | null;
  overlayLeverage?: number;
  /** `qty | ±USD | ✕` pills drawn on each overlay line (Task 5). */
  overlayBadges?: OverlayLineBadge[];
  /** Immediate-place trade control row docked to the entry line. Null when flat
   *  / during replay. TP/SL lines are always draggable; `isDirty` (a staged,
   *  unconfirmed TP/SL change) reveals the Discard/Confirm buttons. */
  tradeOverlay?: {
    entryPrice: number;
    side: 'long' | 'short';
    qty: number;
    pnl: number;
    isDirty: boolean;
    hasTp: boolean;
    hasSl: boolean;
  } | null;
  onOverlayDiscard?: () => void;
  onOverlayConfirm?: () => void;
  onOverlayToggleTp?: () => void;
  onOverlayToggleSl?: () => void;
  onOverlayReverse?: () => void;
  onOverlayClose?: () => void;
  onReady?: (api: ChartApi) => void;
  onLoadOlder?: () => void;
  regime?: number;
  overlayPnL?: number | null;
  onChartContextMenu?: (price: number, x: number, y: number) => void;
  showVolume?: boolean;
  onToggleVolume?: () => void;
  onQuickTrade?: (side: 'buy' | 'sell') => void;
  onOpenRenkoSettings?: () => void;
  bid?: number | null;
  ask?: number | null;
  activeIndicatorId: string;
  onIndicatorChange: (id: string) => void;
  indicatorSettings?: IndicatorSettings;
  onUpdateIndicatorSettings?: (settings: IndicatorSettings) => void;
  activeIndicatorIds?: string[];
  indicatorSettingsMap?: Record<string, IndicatorSettings>;
  onRemoveIndicator?: (id: string) => void;
  onUpdateIndicatorSettingsFor?: (id: string, settings: IndicatorSettings) => void;
  resetTick?: number;
  /** Blind-drill mode: hide the time axis so dates can't reveal the moment. */
  maskTimeAxis?: boolean;
  /**
   * Additional panes to render below the main candle pane. Each entry
   * allocates a new LWC pane + a candlestick series rendered from
   * `candles` at the entry's TF. Time scale and crosshair are shared
   * with the main pane automatically (LWC default). Used by
   * `MultiPaneChart` for the TV-style "4 panes stacked" view.
   */
  additionalPanes?: { key: string; candles: Candle[]; height?: number }[];
  /**
   * Total height in px shared across all `additionalPanes` (used for
   * proportional height allocation when no per-pane `height` is given).
   */
  additionalPanesTotalHeight?: number;
}

/**
 * Strict time-series guard (lightweight-charts throws 'Value is null' on
 * duplicate or out-of-order timestamps — overlapping lazy-load pages are the
 * classic producer). One O(n) validation pass; the common clean case returns
 * the SAME array (no allocation). Dirty input is deduped (last bar wins) and
 * sorted strictly ascending.
 */
export function ensureCleanSeries(candles: Candle[]): Candle[] {
  let dirty = false;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time <= candles[i - 1].time) { dirty = true; break; }
  }
  if (!dirty) return candles;
  const byTime = new Map<number, Candle>();
  for (const c of candles) byTime.set(c.time as number, c);
  return [...byTime.values()].sort((a, b) => (a.time as number) - (b.time as number));
}

/** Offsets a unix-seconds timestamp by the local timezone so lightweight-charts
 *  (which treats timestamps as UTC) renders bars at local wall-clock positions. */
export function shiftTime(t: number): Time {
  const tzOffset = new Date().getTimezoneOffset() * 60;
  return (t - tzOffset) as Time;
}

/** Minutes per supported timeframe — used by the candle-close countdown + future whitespace. */
export function getTfMinutes(tfStr: string): number {
  switch (tfStr) {
    case '5m': return 5;
    case '15m': return 15;
    case '1h': return 60;
    case '4h': return 240;
    case '1d': return 1440;
    default: return 15;
  }
}
