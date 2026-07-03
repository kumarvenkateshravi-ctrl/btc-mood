import { useEffect } from 'react';
import { ColorType, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { ChartPalette } from '@/lib/chartTheme';

/**
 * Re-skins a LIVE chart in place when the active MDS theme changes — chrome,
 * grid, crosshair, and candle colors update without a remount, preserving
 * zoom/scroll. Also publishes the palette to paletteRef for the long-lived
 * rAF/canvas closures (axis price card, day separators).
 */
export function useChartTheme(
  chartRef: RefObject<IChartApi | null>,
  candleSeriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  paletteRef: RefObject<ChartPalette>,
  palette: ChartPalette,
) {
  useEffect(() => {
    paletteRef.current = palette;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: palette.chartBg },
        textColor: palette.text,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
      crosshair: {
        vertLine: {
          color: palette.crosshairLine,
          labelBackgroundColor: palette.crosshairLabelBg,
        },
        horzLine: {
          color: palette.crosshairLine,
          labelBackgroundColor: palette.crosshairLabelBg,
        },
      },
    });
    series.applyOptions({
      upColor: palette.bullFace,
      downColor: palette.bearFace,
      borderUpColor: palette.bullSide,
      borderDownColor: palette.bearSide,
      wickUpColor: palette.bullWick,
      wickDownColor: palette.bearWick,
    });
  }, [palette, chartRef, candleSeriesRef, paletteRef]);
}
