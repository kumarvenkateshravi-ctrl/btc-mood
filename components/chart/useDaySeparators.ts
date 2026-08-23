import { useEffect, useRef } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import type { RefObject, MutableRefObject } from 'react';
import type { ChartPalette } from '@/lib/chartTheme';
import type { Candle } from '@/lib/types';
import { shiftTime } from './types';
import { buildDaySeparatorIndex, selectVisibleDaySeparators, updateDaySeparatorIndex, type DaySeparator } from '@/lib/daySeparatorIndex';
import type { ChartLifecycle } from '@/lib/chartLifecycle';
import { isChartLifecycleActive } from '@/lib/chartLifecycle';

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
  lifecycleRef?: RefObject<ChartLifecycle>,
  pendingAnimationFramesRef?: MutableRefObject<Set<number>>,
) {
  const dayIndexRef = useRef<{ source: Candle[]; boundaries: DaySeparator[] } | null>(null);

  useEffect(() => {
    const lifecycleEpoch = lifecycleRef?.current?.epoch;
    const active = () => lifecycleRef?.current == null || (lifecycleEpoch != null && isChartLifecycleActive(lifecycleRef.current, lifecycleEpoch));
    const chart = chartRef.current;
    const canvas = daySepCanvasRef.current;
    const source = hoverInputsRef.current.src;
    const previousIndex = dayIndexRef.current;
    if (!previousIndex) {
      dayIndexRef.current = { source, boundaries: buildDaySeparatorIndex(source) };
    } else if (previousIndex.source !== source) {
      dayIndexRef.current = {
        source,
        boundaries: updateDaySeparatorIndex(previousIndex.source, source, previousIndex.boundaries),
      };
    }
    if (!chart || !canvas || (!isRenko && tf === '1d')) {
      // Clear canvas if not applicable
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const drawSeparators = () => {
      if (!active()) return;
      if (pendingAnimationFramesRef && daySepRafRef.current) pendingAnimationFramesRef.current.delete(daySepRafRef.current);
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

      // Skip separators for daily chart (the days ARE the bars), but allow for Renko
      if (!tf || (!isRenko && tf === '1d')) return;

      const indexed = dayIndexRef.current;
      if (!indexed || indexed.source.length < 2) return;
      const logicalRange = ts.getVisibleLogicalRange();
      const boundaries = logicalRange
        ? selectVisibleDaySeparators(indexed.boundaries, logicalRange)
        : indexed.boundaries;
      for (const boundary of boundaries) {
        const x = ts.timeToCoordinate(shiftTime(boundary.time) as Time);
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
    };

    drawSeparators();

    const onChange = () => {
      if (!active()) return;
      cancelAnimationFrame(daySepRafRef.current);
      if (pendingAnimationFramesRef && daySepRafRef.current) pendingAnimationFramesRef.current.delete(daySepRafRef.current);
      daySepRafRef.current = requestAnimationFrame(drawSeparators);
      pendingAnimationFramesRef?.current.add(daySepRafRef.current);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onChange);
    return () => {
      cancelAnimationFrame(daySepRafRef.current);
      pendingAnimationFramesRef?.current.delete(daySepRafRef.current);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onChange); } catch {}
    };
  }, [candles, tf, isRenko, palette, chartRef, daySepCanvasRef, containerRef, hoverInputsRef, paletteRef, daySepRafRef, lifecycleRef, pendingAnimationFramesRef]);
}
