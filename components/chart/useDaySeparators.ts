import { useEffect } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { ChartPalette } from '@/lib/chartTheme';
import type { Candle } from '@/lib/types';
import { shiftTime } from './types';

interface HoverInputs {
  src: Candle[];
  base: Candle[];
  isRenko: boolean;
}

/**
 * Draws dotted vertical lines at UTC day boundaries on a dedicated overlay
 * canvas, matching TradingView's style. Re-renders on visible-range change
 * via a rAF-throttled subscription. Skipped for daily charts and Renko.
 */
export function useDaySeparators(
  chartRef: RefObject<IChartApi | null>,
  daySepCanvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  hoverInputsRef: RefObject<HoverInputs>,
  paletteRef: RefObject<ChartPalette>,
  daySepRafRef: RefObject<number>,
  candles: Candle[],
  tf: string | undefined,
  isRenko: boolean,
  palette: ChartPalette,
) {
  useEffect(() => {
    const chart = chartRef.current;
    const canvas = daySepCanvasRef.current;
    if (!chart || !canvas || isRenko || tf === '1d') {
      // Clear canvas if not applicable
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const drawSeparators = () => {
      const c = chartRef.current;
      const container = containerRef.current;
      if (!c || !canvas || !container) return;

      const ts = c.timeScale();
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;

      // Resize canvas backing store only if dimensions changed
      const needsResize = canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr);
      if (needsResize) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Skip separators for daily chart (the days ARE the bars)
      if (!tf || tf === '1d') return;

      // Find day boundaries in the candle data
      const src = hoverInputsRef.current.src;
      if (src.length < 2) return;

      const seenDays = new Set<number>();
      for (let i = 1; i < src.length; i++) {
        const t = src[i].time as number;
        // UTC day number
        const dayNum = Math.floor(t / 86400);
        const prevDayNum = Math.floor((src[i - 1].time as number) / 86400);
        if (dayNum !== prevDayNum && !seenDays.has(dayNum)) {
          seenDays.add(dayNum);
          const x = ts.timeToCoordinate(shiftTime(t) as Time);
          if (x == null || x < 0 || x > w) continue;
          const xRounded = Math.round(x) + 0.5;

          ctx.save();
          ctx.strokeStyle = paletteRef.current.daySep;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 4]);
          ctx.lineDashOffset = 0;
          ctx.beginPath();
          ctx.moveTo(xRounded, 0);
          ctx.lineTo(xRounded, h);
          ctx.stroke();
          ctx.restore();
        }
      }
    };

    drawSeparators();

    const onChange = () => {
      cancelAnimationFrame(daySepRafRef.current);
      daySepRafRef.current = requestAnimationFrame(drawSeparators);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onChange);
    return () => {
      cancelAnimationFrame(daySepRafRef.current);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onChange); } catch {}
    };
  }, [candles, tf, isRenko, palette, chartRef, daySepCanvasRef, containerRef, hoverInputsRef, paletteRef, daySepRafRef]);
}
