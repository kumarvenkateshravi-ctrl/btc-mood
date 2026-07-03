import { useEffect, useRef } from 'react';
import { PriceScaleMode, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { PriceScaleModeOption } from './types';
import { PriceLinesPrimitive, type PriceLineItem } from '@/lib/priceLinesPrimitive';

/**
 * Owns the three price-scale-related effects:
 *  - Renko hides the time axis labels (bricks are not time-based).
 *  - Linear / Log / Percent right-price-scale mode toggle.
 *  - Horizontal price lines (price alerts) diffed on the candle series.
 */
export function usePriceScaleLines(
  chartRef: RefObject<IChartApi | null>,
  candleSeriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  priceLinesPrimitiveRef: RefObject<PriceLinesPrimitive | null>,
  isRenko: boolean,
  priceScaleMode: PriceScaleModeOption,
  priceLines?: PriceLineItem[],
) {
  // Renko: hide time-axis labels (bricks are not time-based).
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      timeVisible: !isRenko,
      secondsVisible: false,
    });
  }, [isRenko, chartRef]);

  // Right price-scale mode (linear / log / percentage).
  useEffect(() => {
    const mode =
      priceScaleMode === 'log'
        ? PriceScaleMode.Logarithmic
        : priceScaleMode === 'percent'
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal;
    try {
      chartRef.current?.priceScale('right').applyOptions({ mode });
    } catch {}
  }, [priceScaleMode, chartRef]);

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
