import type { RefObject, MutableRefObject, Dispatch, SetStateAction } from 'react';
import type {
  IChartApi,
  IPaneApi,
  ISeriesApi,
  SeriesType,
  ISeriesMarkersPluginApi,
  Time,
} from 'lightweight-charts';
import { OrderOverlayPrimitive } from '@/lib/orderOverlayPrimitive';
import { ChartFxPrimitive } from '@/lib/chartFxPrimitive';
import { GradientZonePrimitive } from '@/lib/gradientZonePrimitive';
import { SessionVolumeProfilePrimitive } from '@/lib/sessionVolumeProfilePrimitive';
import { IndicatorBandPrimitive } from '@/lib/indicatorBandPrimitive';
import { IndicatorLinePrimitive } from '@/lib/indicatorLinePrimitive';
import { PriceLinesPrimitive } from '@/lib/priceLinesPrimitive';
import type { ChartPalette } from '@/lib/chartTheme';
import type { HoverPayload } from '@/lib/chartHoverStore';
import type { Candle } from '@/lib/types';
import type { ChartType, OverlayKind } from './types';

type PriceLineEntry = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;

/**
 * Shared bag of all refs + state setters used across the chart's effect hooks.
 * Created once in Chart.tsx and passed to each hook — avoids 20-parameter
 * signatures and keeps the ref plumbing in one typed contract.
 */
export interface ChartRefs {
  // DOM + chart instance refs
  containerRef: RefObject<HTMLDivElement | null>;
  priceCardRef: RefObject<HTMLDivElement | null>;
  priceTextRef: RefObject<HTMLDivElement | null>;
  countdownTextRef: RefObject<HTMLDivElement | null>;
  chartRef: RefObject<IChartApi | null>;
  candleSeriesRef: RefObject<ISeriesApi<'Candlestick'> | null>;
  dummySeriesRef: RefObject<ISeriesApi<'Line'> | null>;
  markersRef: RefObject<ISeriesMarkersPluginApi<Time> | null>;
  overlayPrimitiveRef: RefObject<OrderOverlayPrimitive | null>;
  fxPrimitiveRef: RefObject<ChartFxPrimitive | null>;
  daySepCanvasRef: RefObject<HTMLCanvasElement | null>;
  daySepRafRef: MutableRefObject<number>;
  separatePaneRef: MutableRefObject<{ setHeight: (n: number) => void } | null>;

  // Indicator stack refs
  indicatorSeriesRef: MutableRefObject<Map<string, ISeriesApi<SeriesType>>>;
  indicatorPanesRef: MutableRefObject<Map<string, IPaneApi<Time>>>;
  indicatorSigRef: MutableRefObject<string>;
  indicatorGradientRef: MutableRefObject<Map<string, GradientZonePrimitive>>;
  indicatorProfileRef: MutableRefObject<Map<string, SessionVolumeProfilePrimitive>>;
  indicatorBandRef: MutableRefObject<Map<string, IndicatorBandPrimitive>>;
  indicatorLineRef: MutableRefObject<Map<string, IndicatorLinePrimitive>>;
  indicatorMarkersRef: MutableRefObject<Map<string, ISeriesMarkersPluginApi<Time>>>;
  priceLinesPrimitiveRef: MutableRefObject<PriceLinesPrimitive | null>;

  // Theme + palette
  paletteRef: MutableRefObject<ChartPalette>;

  // Data-tracking refs
  hoverInputsRef: MutableRefObject<{ src: Candle[]; base: Candle[]; isRenko: boolean }>;
  lastBarTimeRef: MutableRefObject<number | null>;
  firstBarTimeRef: MutableRefObject<number | null>;
  prevTypeRef: MutableRefObject<ChartType | null>;
  prevTfRef: MutableRefObject<string | null>;
  prevOpenRef: MutableRefObject<number | null>;
  prevCloseRef: MutableRefObject<number | null>;
  lastCandleTimeRef: MutableRefObject<number | null>;
  initialZoomDoneRef: MutableRefObject<boolean>;
  isPointerDownRef: MutableRefObject<boolean>;
  lastCrosshairRef: MutableRefObject<{ point: { x: number; y: number }; time: number; payload: HoverPayload } | null>;

  // Callback refs (kept current without re-binding event listeners)
  onOverlayDragRef: MutableRefObject<((kind: OverlayKind, price: number) => void) | undefined>;
  onOverlayChipClickRef: MutableRefObject<((key: 'tp' | 'sl' | 'close') => void) | undefined>;
  onChartContextMenuRef: MutableRefObject<((price: number, x: number, y: number) => void) | undefined>;
  onLoadOlderRef: MutableRefObject<(() => void) | undefined>;
  onPriceLineDragRef: MutableRefObject<((id: string, newPrice: number) => void) | undefined>;

  // State setters / store setters (for effects that drive React state)
  setHover: (h: HoverPayload | null) => void;
  setHoverLine: Dispatch<SetStateAction<{ kind: OverlayKind; price: number; y: number } | null>>;
  setTooltipPos: (pos: { x: number; y: number; time?: number; hover: HoverPayload } | null) => void;
  setIsScrolledBack: Dispatch<SetStateAction<boolean>>;
}
