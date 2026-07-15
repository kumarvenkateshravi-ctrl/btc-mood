import { useEffect } from 'react';
import { PriceScaleMode, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { RefObject, MutableRefObject } from 'react';
import type { PriceScaleModeOption } from './types';
import { PriceLinesPrimitive, type PriceLineItem } from '@/lib/priceLinesPrimitive';

/**
 * Owns the chart settings-driven price-scale effects plus the renko time-axis
 * toggle and the alert price-lines primitive. All operations target pane 0
 * (the main candle pane) — indicator panes keep their own default axes.
 */
export function usePriceScaleLines(
  chartRef: RefObject<IChartApi | null>,
  candleSeriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  priceLinesPrimitiveRef: MutableRefObject<PriceLinesPrimitive | null>,
  isRenko: boolean,  // kept for API compatibility — no longer used internally
  priceScaleMode: PriceScaleModeOption,
  priceLines?: PriceLineItem[],
  // New TV-style settings (see useChartSettings.ts):
  autoScale: boolean = true,
  invertScale: boolean = false,
  borderVisible: boolean = false,
  activePriceScaleId: 'left' | 'right' = 'right',
  lockPriceToBarRatio: boolean = false,
) {
  // Renko used to suppress the time axis since bricks had synthetic 1-second
  // timestamps. Now that bricks carry real source-candle timestamps the axis
  // is always visible (like TradingView) — secondsVisible stays off.
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      timeVisible: true,
      secondsVisible: false,
    });
  }, [chartRef]);


  // Right/left price-scale mode (linear / log / percentage) on the main pane.
  useEffect(() => {
    const mode =
      priceScaleMode === 'log'
        ? PriceScaleMode.Logarithmic
        : priceScaleMode === 'percent'
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal;
    try {
      chartRef.current?.priceScale(activePriceScaleId, 0).applyOptions({ mode });
    } catch {}
  }, [priceScaleMode, activePriceScaleId, chartRef]);

  // Auto-scale + invert + border on the main pane's active price scale.
  useEffect(() => {
    try {
      chartRef.current?.priceScale(activePriceScaleId, 0).applyOptions({
        autoScale,
        invertScale,
        borderVisible,
      });
    } catch {}
  }, [autoScale, invertScale, borderVisible, activePriceScaleId, chartRef]);

  // Lock price to bar ratio: APPROXIMATION.
  // LWC v5 has no `lockRatio` knob. We re-apply `autoScale: true` on every
  // visible-range change so the price scale keeps tracking the visible bars.
  // The numeric value is cosmetic — LWC does not surface it as a real ratio.
  useEffect(() => {
    if (!lockPriceToBarRatio) return;
    const chart = chartRef.current;
    if (!chart) return;
    const handler = () => {
      try {
        chart.priceScale(activePriceScaleId, 0).applyOptions({ autoScale: true });
      } catch {}
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      } catch {}
    };
  }, [lockPriceToBarRatio, activePriceScaleId, chartRef]);

  // Horizontal price lines (price alerts) on the candle series.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    if (!priceLinesPrimitiveRef.current) {
      priceLinesPrimitiveRef.current = new PriceLinesPrimitive();
      try { series.attachPrimitive(priceLinesPrimitiveRef.current); } catch {}
    }

    priceLinesPrimitiveRef.current.setLines(priceLines ?? []);
  }, [priceLines, candleSeriesRef, priceLinesPrimitiveRef]);
}
