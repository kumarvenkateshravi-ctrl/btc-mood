import { useEffect } from 'react';
import { LineStyle, PriceScaleMode, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { PriceScaleModeOption } from './types';

type PriceLineEntry = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;

/**
 * Owns the three price-scale-related effects:
 *  - Renko hides the time axis labels (bricks are not time-based).
 *  - Linear / Log / Percent right-price-scale mode toggle.
 *  - Horizontal price lines (price alerts) diffed on the candle series.
 */
export function usePriceScaleLines(
  chartRef: RefObject<IChartApi | null>,
  candleSeriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  priceLinesRef: RefObject<Map<string, PriceLineEntry>>,
  isRenko: boolean,
  priceScaleMode: PriceScaleModeOption,
  priceLines?: { id: string; price: number; color: string; title: string }[],
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
    const existing = priceLinesRef.current;
    const lines = priceLines ?? [];
    const wanted = new Set(lines.map((l) => l.id));
    for (const [id, line] of existing) {
      if (!wanted.has(id)) {
        try { series.removePriceLine(line); } catch {}
        existing.delete(id);
      }
    }
    for (const l of lines) {
      const cur = existing.get(l.id);
      if (cur) {
        try { cur.applyOptions({ price: l.price, color: l.color, title: l.title }); } catch {}
      } else {
        try {
          existing.set(
            l.id,
            series.createPriceLine({
              price: l.price,
              color: l.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: l.title,
            }),
          );
        } catch {}
      }
    }
  }, [priceLines, candleSeriesRef, priceLinesRef]);
}
