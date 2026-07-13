import { useEffect } from 'react';
import type { MouseEventParams, LogicalRange } from 'lightweight-charts';
import type { ChartRefs } from './refs';
import type { HoverPayload } from '@/lib/chartHoverStore';
import type { OverlayKind } from './types';

export function useChartEvents(refs: ChartRefs) {
  useEffect(() => {
    const {
      containerRef,
      chartRef,
      candleSeriesRef,
      overlayPrimitiveRef,
      hoverInputsRef,
      lastCrosshairRef,
      isPointerDownRef,
      setHover,
      setTooltipPos,
      setHoverLine,
      onOverlayDragRef,
      onOverlayChipClickRef,
      onPriceLineDragRef,
      onChartContextMenuRef,
      onLoadOlderRef,
      setIsScrolledBack,
      priceLinesPrimitiveRef,
    } = refs;

    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;

    // ---- Crosshair Sync ----
    const onCrosshair = (param: MouseEventParams) => {
      const cs = candleSeriesRef.current;
      const { src, base: baseCandles, isRenko: renko } = hoverInputsRef.current;
      if (!cs || baseCandles.length === 0 || !param.time || param.point === undefined) {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const timeSec = param.time as number | string;
      if (typeof timeSec !== 'number') {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const data = param.seriesData.get(cs) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!data) {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const idx =
        typeof param.logical === 'number'
          ? Math.round(param.logical)
          : baseCandles.length - 1;
      const base = baseCandles[idx];
      if (!base) {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const srcCandle = renko ? base : src[idx];
      if (!srcCandle) {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const prevIdx = idx > 0 ? idx - 1 : -1;
      const prevBase = prevIdx >= 0 ? baseCandles[prevIdx] ?? null : null;
      const payload: HoverPayload = {
        src: srcCandle,
        base,
        prevBase,
      };
      
      if (lastCrosshairRef.current?.payload.base !== base || lastCrosshairRef.current?.time !== timeSec) {
        setHover(payload);
        lastCrosshairRef.current = { point: param.point, time: timeSec, payload };
        if (isCandlePointerDown) {
          setTooltipPos({ x: param.point.x, y: param.point.y, time: timeSec, hover: payload });
        }
      } else {
        lastCrosshairRef.current.point = param.point;
        if (isCandlePointerDown) {
          setTooltipPos({ x: param.point.x, y: param.point.y, time: timeSec, hover: payload });
        }
      }
    };
    chart.subscribeCrosshairMove(onCrosshair);

    // ---- Lazy Load & Logical Range ----
    const onLogicalRange = (range: LogicalRange | null) => {
      if (range && range.from < 10) onLoadOlderRef.current?.();
      const ts = chartRef.current?.timeScale();
      if (ts) {
        setIsScrolledBack(ts.scrollPosition() < 0);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onLogicalRange);

    // ---- Instant Price-axis (Y) wheel zoom ----
    const onAxisWheel = (e: WheelEvent) => {
      const c = chartRef.current;
      if (!c) return;
      const rect = container.getBoundingClientRect();
      const cursorY = e.clientY - rect.top;

      let targetPane = null;
      let accumulatedHeight = 0;
      let paneLocalY = 0;
      for (const pane of c.panes()) {
        const h = pane.getHeight();
        if (cursorY >= accumulatedHeight && cursorY < accumulatedHeight + h) {
          targetPane = pane;
          paneLocalY = cursorY - accumulatedHeight;
          break;
        }
        accumulatedHeight += h;
      }

      if (!targetPane) return;

      const seriesList = targetPane.getSeries();
      const series = seriesList.length > 0 ? seriesList[0] : null;
      if (!series) return;

      let ps;
      try {
        ps = targetPane.priceScale('right');
      } catch {
        return;
      }

      const axisW = ps.width();
      if (e.clientX < rect.right - axisW - 1) return;
      
      e.preventDefault();
      e.stopPropagation();

      const paneH = targetPane.getHeight();
      if (paneH <= 0) return;
      const margins = ps.options().scaleMargins;

      let range = ps.getVisibleRange();
      if (!range) {
        const high = series.coordinateToPrice(paneH * margins.top);
        const low = series.coordinateToPrice(paneH * (1 - margins.bottom));
        if (high == null || low == null || high <= low) return;
        range = { from: low, to: high };
      }
      ps.setAutoScale(false);

      const { from, to } = range;
      const span = to - from;
      if (!(span > 0)) return;

      const dataTopY = paneH * margins.top;
      const dataBotY = paneH * (1 - margins.bottom);
      const frac = Math.min(1, Math.max(0, (paneLocalY - dataTopY) / (dataBotY - dataTopY)));
      const pivot = to - frac * span;

      const factor = e.deltaY > 0 ? 1.08 : 0.92;
      const newFrom = pivot + (from - pivot) * factor;
      const newTo = pivot + (to - pivot) * factor;
      
      if (Number.isFinite(newFrom) && Number.isFinite(newTo) && newTo - newFrom > 0) {
        ps.setVisibleRange({ from: newFrom, to: newTo });
      }
    };
    container.addEventListener('wheel', onAxisWheel, { passive: false, capture: true });

    // ---- Overlay drag + body pan ----
    let dragKind: 'entry' | 'tp' | 'sl' | null = null;
    let dragPointerId: number | null = null;
    // Badge ✕ click: captured on pointer-down over the ✕ hotspot, fired on
    // pointer-up if the pointer hasn't wandered far enough to be a drag/pan.
    let cancelKind: OverlayKind | null = null;
    let cancelPointerId: number | null = null;
    let cancelStartX = 0;
    let cancelStartY = 0;
    let priceLineDragId: string | null = null;
    let priceLineDragPointerId: number | null = null;
    let bodyPanPointerId: number | null = null;
    let bodyPanStartY: number = 0;
    let bodyPanStartRange: { from: number; to: number } | null = null;
    let isCandlePointerDown = false;
    const isDragKind = (k: string): k is 'entry' | 'tp' | 'sl' =>
      k === 'entry' || k === 'tp' || k === 'sl';

    const onPointerDown = (e: PointerEvent) => {
      isPointerDownRef.current = true;
      isCandlePointerDown = false;
      if (lastCrosshairRef.current && candleSeriesRef.current) {
        const { point, payload, time } = lastCrosshairRef.current;
        const cs = candleSeriesRef.current;
        const yHigh = cs.priceToCoordinate(payload.src.high);
        const yLow = cs.priceToCoordinate(payload.src.low);
        if (yHigh !== null && yLow !== null) {
          const pad = 15;
          if (point.y >= yHigh - pad && point.y <= yLow + pad) {
            isCandlePointerDown = true;
            setTooltipPos({
              x: point.x,
              y: point.y,
              time: time,
              hover: payload
            });
          }
        }
      }
      const prim = overlayPrimitiveRef.current;
      const c = chartRef.current;
      const rect = container.getBoundingClientRect();
      const axisW = c?.priceScale('right').width() ?? 0;
      if (e.clientX >= rect.right - axisW - 1) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      if (prim && c) {
        const hit = prim.customHitTest(localX, localY);
        if (hit && hit.action === 'cancel') {
          cancelKind = hit.kind;
          cancelPointerId = e.pointerId;
          cancelStartX = e.clientX;
          cancelStartY = e.clientY;
          try { container.setPointerCapture(e.pointerId); } catch {}
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (hit && hit.draggable) {
          const k = hit.kind;
          if (!isDragKind(k)) return;
          dragKind = k;
          dragPointerId = e.pointerId;
          prim.setDragging(k);
          try { container.setPointerCapture(e.pointerId); } catch {}
          e.preventDefault();
          e.stopPropagation();
          container.style.cursor = 'ns-resize';
          return;
        }
      }

      const pricePrim = priceLinesPrimitiveRef.current;
      if (pricePrim && c) {
        const hit = pricePrim.customHitTest(localX, localY);
        if (hit) {
          priceLineDragId = hit.id;
          priceLineDragPointerId = e.pointerId;
          pricePrim.setDragging(hit.id);
          try { container.setPointerCapture(e.pointerId); } catch {}
          e.preventDefault();
          e.stopPropagation();
          container.style.cursor = 'ns-resize';
          return;
        }
      }

      if (!c) return;

      const mainPaneSize = c.paneSize();
      if (localY > mainPaneSize.height) return;

      const ps = c.priceScale('right');
      const series = candleSeriesRef.current;
      if (!series) return;
      let range = ps.getVisibleRange();
      if (!range) {
        const paneH = rect.height - c.timeScale().height();
        const margins = ps.options().scaleMargins;
        const high = series.coordinateToPrice(paneH * margins.top);
        const low = series.coordinateToPrice(paneH * (1 - margins.bottom));
        if (high == null || low == null || high <= low) return;
        range = { from: low, to: high };
        ps.setAutoScale(false);
        ps.setVisibleRange(range);
      }
      bodyPanPointerId = e.pointerId;
      bodyPanStartY = e.clientY;
      bodyPanStartRange = { from: range.from, to: range.to };
    };

    const onOverlayMove = (e: PointerEvent) => {
      if (cancelPointerId !== null && cancelPointerId === e.pointerId) {
        // Moved beyond a small threshold — this is a drag/pan gesture, not a
        // click, so don't fire the ✕ action on pointer-up.
        const dx = e.clientX - cancelStartX;
        const dy = e.clientY - cancelStartY;
        if (Math.hypot(dx, dy) > 6) cancelKind = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (priceLineDragId !== null && priceLineDragPointerId === e.pointerId) {
        const pricePrim = priceLinesPrimitiveRef.current;
        const series = candleSeriesRef.current;
        if (!pricePrim || !series) return;
        const rect = container.getBoundingClientRect();
        const localY = e.clientY - rect.top;
        const price = series.coordinateToPrice(localY);
        if (price == null || !Number.isFinite(price as number)) return;
        
        const newLines = pricePrim.lines.map((l) =>
          l.id === priceLineDragId ? { ...l, price: price as number } : l,
        );
        pricePrim.setLines(newLines);
        onPriceLineDragRef.current?.(priceLineDragId, price as number);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (dragKind === null || dragPointerId !== e.pointerId) return;
      const prim = overlayPrimitiveRef.current;
      const series = candleSeriesRef.current;
      if (!prim || !series) return;
      const rect = container.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      const price = series.coordinateToPrice(localY);
      if (price == null || !Number.isFinite(price as number)) return;
      const newOverlays = prim.overlays.map((o) =>
        o.kind === dragKind ? { ...o, price: price as number } : o,
      );
      prim.setOverlays(newOverlays);
      onOverlayDragRef.current?.(dragKind, price as number);
      e.preventDefault();
      e.stopPropagation();
    };

    const endDrag = (e: PointerEvent) => {
      if (priceLineDragId !== null && priceLineDragPointerId === e.pointerId) {
        priceLineDragId = null;
        priceLineDragPointerId = null;
        priceLinesPrimitiveRef.current?.setDragging(null);
        container.style.cursor = '';
        try { container.releasePointerCapture(e.pointerId); } catch {}
      }
      if (dragKind !== null && dragPointerId === e.pointerId) {
        dragKind = null;
        dragPointerId = null;
        overlayPrimitiveRef.current?.setDragging(null);
        container.style.cursor = '';
        try { container.releasePointerCapture(e.pointerId); } catch {}
      }
      if (cancelPointerId !== null && cancelPointerId === e.pointerId) {
        const kind = cancelKind;
        cancelPointerId = null;
        cancelKind = null;
        try { container.releasePointerCapture(e.pointerId); } catch {}
        // Only fire on a genuine pointer-up (not pointer-cancel), and only if
        // no drag/pan happened in between (onOverlayMove clears `kind` above
        // the threshold).
        if (kind && e.type === 'pointerup') {
          onOverlayChipClickRef.current?.(kind === 'entry' ? 'close' : kind);
        }
      }
    };

    const onBodyPanMove = (e: PointerEvent) => {
      if (bodyPanPointerId !== e.pointerId || !bodyPanStartRange) return;
      const c = chartRef.current;
      const series = candleSeriesRef.current;
      if (!c || !series) return;
      const dy = e.clientY - bodyPanStartY;
      const rect = container.getBoundingClientRect();
      const paneH = rect.height - c.timeScale().height();
      const margins = c.priceScale('right').options().scaleMargins;
      const dataTopY = paneH * margins.top;
      const dataBotY = paneH * (1 - margins.bottom);
      const dataH = dataBotY - dataTopY;
      if (dataH <= 0) return;
      const priceTop = series.coordinateToPrice(dataTopY);
      const priceBot = series.coordinateToPrice(dataBotY);
      if (priceTop == null || priceBot == null) return;
      const pricePerPx = (priceBot - priceTop) / dataH;
      const shift = dy * pricePerPx;
      c.priceScale('right').setVisibleRange({
        from: bodyPanStartRange.from + shift,
        to: bodyPanStartRange.to + shift,
      });
    };
    
    const onBodyPanUp = (e: PointerEvent) => {
      isPointerDownRef.current = false;
      isCandlePointerDown = false;
      setTooltipPos(null);
      if (bodyPanPointerId !== e.pointerId) return;
      bodyPanPointerId = null;
      bodyPanStartRange = null;
    };
    
    window.addEventListener('pointermove', onBodyPanMove, { passive: true });
    window.addEventListener('pointerup', onBodyPanUp);
    window.addEventListener('pointercancel', onBodyPanUp);

    // Focus-loss release: minimizing (Win+Down), alt-tabbing, or releasing the
    // mouse outside the window swallows pointerup, leaving the drag state
    // locked (frozen panning, erratic crosshair). Any focus change resets it.
    const onFocusLost = () => {
      isPointerDownRef.current = false;
      isCandlePointerDown = false;
      bodyPanPointerId = null;
      bodyPanStartRange = null;
    };
    window.addEventListener('blur', onFocusLost);
    document.addEventListener('visibilitychange', onFocusLost);

    const onHover = (e: PointerEvent) => {
      if (dragKind !== null) return;
      const prim = overlayPrimitiveRef.current;
      const series = candleSeriesRef.current;
      if (!prim || !series) return;
      const rect = container.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      const localX = e.clientX - rect.left;
      
      const hit = prim.customHitTest(localX, localY);
      let nextState: { kind: OverlayKind; price: number; y: number } | null = null;
      if (hit) {
        const price = series.coordinateToPrice(localY);
        if (price != null && Number.isFinite(price)) {
          nextState = { kind: hit.kind, price: price as number, y: localY };
        }
      } else {
        let best: { kind: OverlayKind; y: number; price: number; dist: number } | null = null;
        const pad = 15;
        for (const o of prim.overlays) {
          if (!o.draggable) continue;
          const ly = series.priceToCoordinate(o.price);
          if (ly == null) continue;
          const d = Math.abs(localY - ly);
          if (d <= pad && (best == null || d < best.dist)) {
            best = { kind: o.kind, y: ly, price: o.price, dist: d };
          }
        }
        if (best) {
          nextState = { kind: best.kind, price: best.price, y: best.y };
        }
      }

      setHoverLine(prev => {
        if (prev === null && nextState === null) return prev;
        if (prev !== null && nextState !== null && prev.kind === nextState.kind && prev.price === nextState.price && prev.y === nextState.y) return prev;
        return nextState;
      });
    };
    
    const onLeave = () => setHoverLine(null);
    
    const onContextMenu = (e: MouseEvent) => {
      const series = candleSeriesRef.current;
      const c = chartRef.current;
      if (!series || !c) return;
      const rect = container.getBoundingClientRect();
      const axisW = c.priceScale('right').width();
      if (e.clientX >= rect.right - axisW - 1) return;
      e.preventDefault();
      const localY = e.clientY - rect.top;
      const price = series.coordinateToPrice(localY);
      if (price == null || !Number.isFinite(price as number)) return;
      onChartContextMenuRef.current?.(price as number, e.clientX, e.clientY);
    };

    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    container.addEventListener('pointermove', onOverlayMove, { capture: true });
    container.addEventListener('pointermove', onHover, { capture: true });
    container.addEventListener('pointerleave', onLeave, { capture: true });
    container.addEventListener('pointerup', endDrag, { capture: true });
    container.addEventListener('pointercancel', endDrag, { capture: true });
    container.addEventListener('contextmenu', onContextMenu, { capture: true });

    return () => {
      window.removeEventListener('blur', onFocusLost);
      document.removeEventListener('visibilitychange', onFocusLost);
      container.removeEventListener('wheel', onAxisWheel, { capture: true });
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('pointermove', onOverlayMove, { capture: true });
      container.removeEventListener('pointerup', endDrag, { capture: true });
      container.removeEventListener('pointercancel', endDrag, { capture: true });
      container.removeEventListener('pointermove', onHover, { capture: true });
      container.removeEventListener('pointerleave', onLeave, { capture: true });
      container.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('pointermove', onBodyPanMove);
      window.removeEventListener('pointerup', onBodyPanUp);
      window.removeEventListener('pointercancel', onBodyPanUp);
      chart.unsubscribeCrosshairMove(onCrosshair);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRange); } catch {}
    };
  }, [refs]);
}
