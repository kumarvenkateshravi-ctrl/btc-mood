import type { LogicalRange, Time } from 'lightweight-charts';
import type { RenkoOptions } from '@/lib/renko';
import type { IndicatorResult, IndicatorSettings } from '@/lib/indicatorFramework';
import type { Candle } from '@/lib/types';
import type { OverlayLineBadge } from '@/lib/orderOverlayPrimitive';

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
  height: number;
  indicatorResult?: IndicatorResult | null;
  indicatorResults?: IndicatorRender[];
  priceScaleMode?: PriceScaleModeOption;
  onPriceScaleModeChange?: (mode: PriceScaleModeOption) => void;
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
  /** Immediate-place trade control center docked to the entry line. Null when
   *  flat / during replay. `mode` toggles between Normal (Edit/Reverse/Close)
   *  and Edit (Save/Cancel + draggable TP/SL). */
  tradeOverlay?: {
    side: 'buy' | 'sell';
    symbol: string;
    qty: number;
    entryPrice: number;
    mode: 'normal' | 'edit';
  } | null;
  /** Live risk/reward for the edit-mode readout. */
  tradeOverlayRr?: { risk: number; reward: number; ratio: number | null } | null;
  onOverlayEdit?: () => void;
  onOverlaySave?: () => void;
  onOverlayCancel?: () => void;
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
