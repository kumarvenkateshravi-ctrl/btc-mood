import { useEffect, useRef } from 'react';
import type { ChartRefs } from './refs';
import type { ChartApi } from './types';
import type { Time, MouseEventParams } from 'lightweight-charts';
import { canUseChartApi } from '@/lib/chartLifecycle';

export function useChartApi(
  refs: ChartRefs,
  onReady?: (api: ChartApi) => void
) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const lifecycleEpoch = refs.lifecycleRef.current.epoch;
    const active = () => canUseChartApi(refs.lifecycleRef.current, lifecycleEpoch);
    if (!onReadyRef.current || !active()) return;

    onReadyRef.current({
      fitContent: () => { if (active()) refs.chartRef.current?.timeScale().fitContent(); },
      timeToX: (t) => {
        const c = refs.chartRef.current;
        if (!active() || !c) return null;
        const x = c.timeScale().timeToCoordinate(t as Time);
        return x == null ? null : x;
      },
      priceToY: (p) => {
        const s = refs.candleSeriesRef.current;
        if (!active() || !s) return null;
        const y = s.priceToCoordinate(p);
        return y == null ? null : y;
      },
      xToTime: (x) => {
        const c = refs.chartRef.current;
        if (!active() || !c) return null;
        const t = c.timeScale().coordinateToTime(x);
        return t == null ? null : (t as number);
      },
      yToPrice: (y) => {
        const s = refs.candleSeriesRef.current;
        if (!active() || !s) return null;
        const p = s.coordinateToPrice(y);
        return p == null ? null : p;
      },
      candleAtX: (x) => {
        const c = refs.chartRef.current;
        if (!active() || !c) return null;
        const lg = c.timeScale().coordinateToLogical(x);
        if (lg == null) return null;
        return refs.hoverInputsRef.current.base[Math.round(lg)] ?? null;
      },
      logicalAt: (x) => {
        const c = refs.chartRef.current;
        if (!active() || !c) return null;
        const lg = c.timeScale().coordinateToLogical(x);
        return lg == null ? null : Math.round(lg);
      },
      subscribe: (cb) => {
        const c = refs.chartRef.current;
        if (!active() || !c) return () => {};
        c.timeScale().subscribeVisibleLogicalRangeChange(cb);
        return () => c.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
      },
      setVisibleLogicalRange: (range) => {
        if (active()) refs.chartRef.current?.timeScale().setVisibleLogicalRange(range);
      },
      getVisibleLogicalRange: () => {
        if (!active()) return null;
        return refs.chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;
      },
      setCrosshairTime: (t) => {
        const c = refs.chartRef.current;
        const s = refs.candleSeriesRef.current;
        if (active() && c && s) {
          if (t === null) {
            c.clearCrosshairPosition();
          } else {
            // Placeholder: Lightweight charts lacks a public setCrosshair(time) API without price
          }
        }
      },
      subscribeLogicalRange: (cb) => {
        const c = refs.chartRef.current;
        if (!active() || !c) return () => {};
        c.timeScale().subscribeVisibleLogicalRangeChange(cb);
        return () => c.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
      },
      subscribeCrosshairTime: (cb) => {
        const c = refs.chartRef.current;
        if (!active() || !c) return () => {};
        const handler = (param: MouseEventParams) => { if (active()) cb((param.time as number) ?? null); };
        c.subscribeCrosshairMove(handler);
        return () => c.unsubscribeCrosshairMove(handler);
      },
    });
  }, [refs]);
}
