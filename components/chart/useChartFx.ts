import { useEffect } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { ChartFxPrimitive, FxBarRect } from '@/lib/chartFxPrimitive';
import type { Candle } from '@/lib/types';
import type { RenkoOptions } from '@/lib/renko';
import { shiftTime, type ChartType } from './types';

/**
 * Two FX primitive effects:
 *  - Bear hatching: feeds the last ~600 candle body rects to the FX primitive.
 *  - Pulse: emits an up/down pulse whenever the last close changes.
 */
export function useChartFx(
  fxPrimitiveRef: RefObject<ChartFxPrimitive | null>,
  candleSeriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  chartRef: RefObject<IChartApi | null>,
  prevCloseRef: RefObject<number | null>,
  candles: Candle[],
  type: ChartType,
  renko?: RenkoOptions,
) {
  // ---- FX: bear hatching ----
  useEffect(() => {
    const fx = fxPrimitiveRef.current;
    const s = candleSeriesRef.current;
    const c = chartRef.current;
    if (!fx || !s || !c) return;
    if (candles.length === 0) {
      fx.setOptions({ bars: [], latestIndex: -1 });
      return;
    }
    const baseCandles = candles;
    if (baseCandles.length === 0) {
      fx.setOptions({ bars: [], latestIndex: -1 });
      return;
    }
    const rects: FxBarRect[] = [];
    const start = Math.max(0, baseCandles.length - 600);
    for (let i = start; i < baseCandles.length; i++) {
      const b = baseCandles[i];
      const top = s.priceToCoordinate(Math.max(b.open, b.close));
      const bot = s.priceToCoordinate(Math.min(b.open, b.close));
      const x = c.timeScale().timeToCoordinate(shiftTime(b.time as number));
      if (top == null || bot == null || x == null) continue;
      rects.push({
        time: shiftTime(b.time as number),
        x,
        w: 7,
        y: top,
        h: bot - top,
      });
    }
    fx.setOptions({ bars: rects, latestIndex: rects.length - 1 });
  }, [candles, type, renko, fxPrimitiveRef, candleSeriesRef, chartRef]);

  // ---- Pulse ----
  useEffect(() => {
    const fx = fxPrimitiveRef.current;
    if (!fx) return;
    if (candles.length === 0) {
      prevCloseRef.current = null;
      return;
    }
    const last = candles[candles.length - 1];
    const prev = prevCloseRef.current;
    prevCloseRef.current = last.close;
    if (prev == null || last.close === prev) return;
    fx.setOptions({
      pulseAt: performance.now(),
      pulseDir: last.close > prev ? 'up' : 'down',
    });
  }, [candles, fxPrimitiveRef, prevCloseRef]);
}
