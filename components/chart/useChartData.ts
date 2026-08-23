import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type ISeriesApi,
  type SeriesType,
  type SeriesMarker,
  type CandlestickData,
  type WhitespaceData,
  type Time,
} from 'lightweight-charts';
import { IndicatorFillPrimitive } from '@/lib/indicatorFillPrimitive';
import { GradientZonePrimitive } from '@/lib/gradientZonePrimitive';
import { SessionVolumeProfilePrimitive } from '@/lib/sessionVolumeProfilePrimitive';
import { IndicatorBandPrimitive } from '@/lib/indicatorBandPrimitive';
import { IndicatorLinePrimitive } from '@/lib/indicatorLinePrimitive';
import type { Candle } from '@/lib/types';
import type { IndicatorSettings } from '@/lib/indicatorFramework';
import { shiftTime, getTfMinutes, ensureCleanSeries, type ChartType, type IndicatorRender } from './types';
import { OSC, softHistogram } from './oscillatorTheme';
import type { ChartRefs } from './refs';
import { classifyTailMutation, writeIndicatorSeries, type IndicatorSeriesSnapshot } from './indicatorSeriesWrites';
import { canUseChartApi } from '@/lib/chartLifecycle';
import { analyticalColor, analyticalDecay } from '@/lib/chartAnalyticalPresentation';

/**
 * The core data-push effect: feeds candle data to the chart, generates the
 * right-edge whitespace, re-anchors the view after lazy-loaded prepends, and
 * rebuilds/syncs the entire indicator stack (signature-gated structural
 * rebuild + per-tick data push for every plot, gradient zone, and pane marker).
 *
 * Extracted verbatim from Chart.tsx — pure refactor, zero behavior change.
 */
export function useChartData(
  refs: ChartRefs,
  candles: Candle[],
  type: ChartType,
  tf: string | undefined,
  symbol: string | undefined,
  isRenko: boolean,
  visibleResults: IndicatorRender[],
  indicatorSettingsMap: Record<string, IndicatorSettings> | undefined,
  hiddenKeys: Set<string>,
  applyDefaultView: () => void,
) {
  const {
    chartRef,
    candleSeriesRef,
    dummySeriesRef,
    markersRef,
    indicatorSeriesRef,
    indicatorPanesRef,
    indicatorSigRef,
    indicatorGradientRef,
    indicatorProfileRef,
    indicatorBandRef,
    indicatorLineRef,
    indicatorMarkersRef,
    separatePaneRef,
    hoverInputsRef,
    firstBarTimeRef,
    lastBarTimeRef,
    prevTypeRef,
    prevTfRef,
    prevOpenRef,
    prevCloseRef,
    lastCandleTimeRef,
  } = refs;

  // Previous bar count + first time, for append-by-one detection (smooth
  // replay playback / live bar close: series.update instead of full setData).
  const prevCountRef = useRef(0);
  const prevFirstTimeRef = useRef<number | null>(null);
  // The last symbol we rendered. A switch (e.g. BTC→ETH) is a new context even
  // though tf/type and the bar timestamps are identical — undefined until the
  // parent threads `symbol`, in which case this stays inert (no false resets).
  const prevSymbolRef = useRef<string | undefined>(undefined);
  // Last plot-data reference pushed per series key. Indicators that cache
  // their result object (e.g. SMC) return IDENTICAL arrays on unchanged
  // closed bars — pushing those again costs O(bars x plots) per tick for
  // nothing. Reference inequality is the only trigger for a re-push.
  const lastPushedPlotRef = useRef<Map<string, unknown>>(new Map());
  const plotWriteSnapshotsRef = useRef<Map<string, IndicatorSeriesSnapshot>>(new Map());
  const previousIndicatorSettingsMapRef = useRef<Record<string, IndicatorSettings> | undefined>(undefined);
  const hasIndicatorSettingsRef = useRef(false);
  const primitiveRawRef = useRef<Map<string, readonly unknown[]>>(new Map());

  useEffect(() => {
    const lifecycleEpoch = refs.lifecycleRef.current.epoch;
    const active = () => canUseChartApi(refs.lifecycleRef.current, lifecycleEpoch);
    if (!active()) return;
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    if (candles.length === 0) return;

    const isNewContext =
      prevTfRef.current !== tf || prevTypeRef.current !== type || prevSymbolRef.current !== symbol;
    const indicatorSettingsChanged = hasIndicatorSettingsRef.current &&
      previousIndicatorSettingsMapRef.current !== indicatorSettingsMap;
    previousIndicatorSettingsMapRef.current = indicatorSettingsMap;
    hasIndicatorSettingsRef.current = true;

    if (prevTypeRef.current !== null && prevTypeRef.current !== type) {
      // Full reset when chart type changes: clear series data AND all
      // tracking refs so stale Renko brick timestamps don't corrupt the
      // incremental update logic (isIncremental / isAppendOne) for the
      // new type. Without this reset, candleSeries.update() may be called
      // on an empty series, causing LWC to silently freeze the chart.
      try { candleSeries.setData([]); } catch {}
      try { markersRef.current?.setMarkers([]); } catch {}
      indicatorSeriesRef.current.forEach((s) => {
        try { s.setData([]); } catch {}
      });
      // Reset all state-tracking refs so the next render does a clean setData.
      lastBarTimeRef.current = null;
      firstBarTimeRef.current = null;
      prevCountRef.current = 0;
      prevFirstTimeRef.current = null;
    } else if (prevSymbolRef.current !== undefined && prevSymbolRef.current !== symbol) {
      // Symbol switch (BTC→ETH or vice-versa): clear the old symbol's data so
      // LWC forgets its internal price-axis range. Without this, setData() with
      // the new symbol's prices still renders against the old y-axis bounds
      // (e.g. ETH ~1900 displayed on a 0–100k BTC scale — candles invisible).
      // Enable autoScale on both price scales BEFORE clearing so the layout
      // pass triggered by setData([]) already has autoScale enabled.
      try { chartRef.current?.priceScale('right').applyOptions({ autoScale: true }); } catch {}
      try { chartRef.current?.priceScale('left').applyOptions({ autoScale: true }); } catch {}
      try { candleSeries.setData([]); } catch {}
      try { markersRef.current?.setMarkers([]); } catch {}
      lastBarTimeRef.current = null;
      firstBarTimeRef.current = null;
      prevCountRef.current = 0;
      prevFirstTimeRef.current = null;
    }
    prevTypeRef.current = type;
    prevTfRef.current = tf ?? null;
    prevSymbolRef.current = symbol;

    // LWC #2044 guard 1: strictly ascending, unique timestamps only.
    const baseCandles = ensureCleanSeries(candles);
    hoverInputsRef.current = { src: baseCandles, base: baseCandles, isRenko };

    if (baseCandles.length === 0) return;

    if (isNewContext) {
      // Initialize the hover store with the latest candle if it hasn't been set yet.
      // This ensures the OHLC strip at the top displays the latest values immediately.
      const lastBase = baseCandles[baseCandles.length - 1];
      const prevBase = baseCandles.length > 1 ? baseCandles[baseCandles.length - 2] : null;
      const lastSrc = isRenko ? lastBase : candles[candles.length - 1];
      refs.setHover({ src: lastSrc, base: lastBase, prevBase });
      refs.setHover(null); // Clears 'hover' but persists it in 'last'
    }

    // Detect lazy-loaded older history (time-based modes only) so we can keep
    // the user's view anchored on the same bars after setData shifts indices.
    const canPreserveView = type !== 'renko';
    const newFirstTime = baseCandles[0].time as number;
    let prependedBars = 0;
    if (
      canPreserveView &&
      !isNewContext &&
      firstBarTimeRef.current != null &&
      newFirstTime < firstBarTimeRef.current
    ) {
      const oldFirst = firstBarTimeRef.current;
      const idx = baseCandles.findIndex((c) => (c.time as number) >= oldFirst);
      prependedBars = idx > 0 ? idx : 0;
    }
    const visRangeBefore =
      prependedBars > 0 ? chartRef.current?.timeScale().getVisibleLogicalRange() ?? null : null;

    const lastTime = baseCandles[baseCandles.length - 1].time;
    // In-bar tick: same last-bar time AND same bar count. The count check is
    // load-bearing for Renko: the forming (ghost) brick keeps the last-bar
    // time pinned to the source candle's time, so when price crosses a brick
    // boundary the array grows while lastTime stays constant — without the
    // count check the completed bricks would never be drawn (update() only
    // patches the final bar) and the chart falls further below live price
    // with every crossing.
    // `!isNewContext` is load-bearing: a symbol switch (BTC→ETH) keeps the same
    // last-bar time AND count, so without this guard it would be mistaken for an
    // in-bar tick and only update() the last bar — leaving the old symbol's
    // candles and price scale on screen.
    const isIncremental =
      !isNewContext &&
      lastBarTimeRef.current === lastTime && baseCandles.length === prevCountRef.current;
    // Append-by-one: one new bar at the tail, history untouched — a replay
    // step or a live bar close. LWC's update() appends in O(1); a multi-bar
    // jump or backward scrub falls through to the full setData path.
    const isAppendOne =
      !isNewContext &&
      !isIncremental &&
      prevFirstTimeRef.current === newFirstTime &&
      baseCandles.length === prevCountRef.current + 1 &&
      lastBarTimeRef.current != null &&
      (lastTime as number) > lastBarTimeRef.current;

    if (baseCandles.length > 0) {
      const last = baseCandles[baseCandles.length - 1];
      prevOpenRef.current = last.open;
      prevCloseRef.current = last.close;
      lastCandleTimeRef.current = last.time as number;
    }
    prevCountRef.current = baseCandles.length;
    prevFirstTimeRef.current = newFirstTime;

    // A malformed bar (NaN/null OHLC or time — a half-formed synthetic brick,
    // a bad ws frame) makes LWC throw "Value is null" INSIDE setData/update,
    // which crashes the whole page. Drop such bars; and if LWC still throws
    // (e.g. a just-disposed series surviving in a ref for one frame), reset
    // the tracking refs and skip this frame — the next tick repaints fully.
    //
    // IMPORTANT: `c` itself may be null if the history-prepend merge produced
    // a sparse array. The null check must come FIRST before any field access,
    // otherwise `.filter(isRenderable)` itself throws "Value is null at Array.map".
    const isRenderable = (c: { time: number | Time; open: number; high: number; low: number; close: number } | null | undefined): c is { time: number | Time; open: number; high: number; low: number; close: number } =>
      c != null &&
      Number.isFinite(c.time as number) &&
      Number.isFinite(c.open) && Number.isFinite(c.high) &&
      Number.isFinite(c.low) && Number.isFinite(c.close);
    const recoverNextFrame = (err: unknown) => {
      console.warn('[chart] series write failed — skipping frame, full repaint next tick:', err);
      lastBarTimeRef.current = null;
      prevCountRef.current = 0;
      prevFirstTimeRef.current = null;
    };

    if (isIncremental || isAppendOne) {
      const lastIdx = baseCandles.length - 1;
      const last = baseCandles[lastIdx];
      if (isRenderable(last)) {
        const updateEntry: CandlestickData<Time> = {
          time: shiftTime(last.time as number),
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
        };
        // Apply any candle color overrides for the last bar.
        for (const { key, result } of visibleResults) {
          if (!result.candleColors || hiddenKeys.has(key)) continue;
          const cc = result.candleColors;
          const styleColor = cc.styleId
            ? (indicatorSettingsMap?.[key]?.styles?.[cc.styleId]?.color ?? null)
            : null;
          if (cc.color[lastIdx] != null) updateEntry.color = styleColor ?? cc.color[lastIdx]!;
          if (cc.wickColor[lastIdx] != null) updateEntry.wickColor = cc.wickColor[lastIdx]!;
          if (cc.borderColor[lastIdx] != null) updateEntry.borderColor = cc.borderColor[lastIdx]!;
        }
        try {
          candleSeries.update(updateEntry);
        } catch (err) {
          recoverNextFrame(err);
          return;
        }
      }
      if (isAppendOne && dummySeriesRef.current && tf && !isRenko) {
        // Whitespace shifts by one bar; a single update extends it.
        try {
          dummySeriesRef.current.update({
            time: shiftTime((lastTime as number) + getTfMinutes(tf) * 60 * 300),
          });
        } catch {}
      }
      // Fall through — indicator plots still need sync (they recompute on
      // the appended bar), but the candle + whitespace series are done.
    } else {
      // ── Collect per-bar candle color overrides from indicators ──────────────
      // Scanned BEFORE candleData is built so colors are merged in one setData
      // call (no flicker). Each indicator can emit a `candleColors` result with
      // per-bar body/wick/border arrays; a styleId lets the user pick the body
      // color via the indicator's style panel.
      const bodyOverride: (string | null)[] = new Array(baseCandles.length).fill(null);
      const wickOverride: (string | null)[] = new Array(baseCandles.length).fill(null);
      const borderOverride: (string | null)[] = new Array(baseCandles.length).fill(null);
      for (const { key, result } of visibleResults) {
        if (!result.candleColors || hiddenKeys.has(key)) continue;
        const cc = result.candleColors;
        const styleColor = cc.styleId
          ? (indicatorSettingsMap?.[key]?.styles?.[cc.styleId]?.color ?? null)
          : null;
        for (let ci = 0; ci < baseCandles.length; ci++) {
          if (cc.color[ci] != null) bodyOverride[ci] = styleColor ?? cc.color[ci];
          if (cc.wickColor[ci] != null) wickOverride[ci] = cc.wickColor[ci];
          if (cc.borderColor[ci] != null) borderOverride[ci] = cc.borderColor[ci];
        }
      }

      const candleData: CandlestickData<Time>[] = [];
      const renderIdx = 0;
      for (let ci = 0; ci < baseCandles.length; ci++) {
        const c = baseCandles[ci];
        if (!isRenderable(c)) continue;
        const entry: CandlestickData<Time> = {
          time: shiftTime(c.time as number),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        };
        if (bodyOverride[ci] != null) entry.color = bodyOverride[ci]!;
        if (wickOverride[ci] != null) entry.wickColor = wickOverride[ci]!;
        if (borderOverride[ci] != null) entry.borderColor = borderOverride[ci]!;
        candleData.push(entry);
      }

      const futureData: WhitespaceData<Time>[] = [];
      if (tf && baseCandles.length > 0 && !isRenko) {
        const lastT = baseCandles[baseCandles.length - 1].time as number;
        const minutes = getTfMinutes(tf);
        if (Number.isFinite(lastT) && Number.isFinite(minutes)) {
          let t = lastT;
          for (let i = 1; i <= 300; i++) {
            t += minutes * 60;
            futureData.push({ time: shiftTime(t) });
          }
        }
      }

      // LWC #2044 guard 2: clear the crosshair before repainting a reshaped
      // dataset — its saved hover index points into the OLD bars; remapping
      // it during the prepend/reload throws 'Value is null' inside LWC's
      // own callbacks (uncatchable by React). It repaints on the next
      // mouse move, so the user never notices.
      try { chartRef.current?.clearCrosshairPosition(); } catch {}
      try {
        candleSeries.setData(candleData);
        if (dummySeriesRef.current) dummySeriesRef.current.setData(futureData);
      } catch (err) {
        recoverNextFrame(err);
        return;
      }
    }
    // Re-anchor the view after a prepend so the chart doesn't jump.
    if (prependedBars > 0 && visRangeBefore) {
      try {
        chartRef.current?.timeScale().setVisibleLogicalRange({
          from: visRangeBefore.from + prependedBars,
          to: visRangeBefore.to + prependedBars,
        });
      } catch {}
    }
    firstBarTimeRef.current = newFirstTime;

    // Sync the custom indicator stack. Each indicator instance that has any
    // separate-pane plot gets its OWN pane below the candles. Building series +
    // panes is expensive and order-sensitive, so we only rebuild when the stack
    // *structure* changes (a signature of keys + plot shapes); per-tick we only
    // push fresh data into the already-created series.
    let indicatorStructureChanged = false;
    const refreshIndicatorPrimitives = () => {
      indicatorGradientRef.current.forEach((primitive) => primitive.updateAllViews());
      indicatorProfileRef.current.forEach((primitive) => primitive.updateAllViews());
      indicatorBandRef.current.forEach((primitive) => primitive.updateAllViews());
      indicatorLineRef.current.forEach((primitive) => primitive.updateAllViews());
    };

    if (chartRef.current) {
      const chart = chartRef.current;
      const existing = indicatorSeriesRef.current;
      const panes = indicatorPanesRef.current;

      const signature = visibleResults
        .map((r) => {
          const settings = indicatorSettingsMap?.[r.key];
          const settingsSig = settings ? JSON.stringify({ styles: settings.styles, labelsOnPriceScale: settings.labelsOnPriceScale }) : '';
          const isHidden = hiddenKeys.has(r.key);
          return `${r.key}#${settingsSig}#${isHidden}#${r.result.plots.map((p) => `${p.id}:${p.type}:${p.pane ?? 'overlay'}`).join(',')}#L${r.result.lineSegments?.length ?? 0}`;
        })
        .join('|');

      if (signature !== indicatorSigRef.current) {
        indicatorStructureChanged = true;
        indicatorSigRef.current = signature;
        try { chart.clearCrosshairPosition(); } catch {}

        // Teardown: drop all indicator series, then all oscillator panes.
        // Removing a series detaches its primitives + price-lines + markers.
        for (const [, series] of existing) {
          try { chart.removeSeries(series); } catch {}
        }
        existing.clear();
        indicatorGradientRef.current.clear();
        // Volume profiles also live on the candle series — detach before dropping.
        for (const [, pp] of indicatorProfileRef.current) {
          try { candleSeriesRef.current?.detachPrimitive(pp); } catch {}
        }
        indicatorProfileRef.current.clear();
        // Band primitives live on the candle series (which survives teardown),
        // so detach them explicitly before dropping the refs.
        for (const [, bp] of indicatorBandRef.current) {
          try { candleSeriesRef.current?.detachPrimitive(bp); } catch {}
        }
        indicatorBandRef.current.clear();
        for (const [, lp] of indicatorLineRef.current) {
          try { candleSeriesRef.current?.detachPrimitive(lp); } catch {}
        }
        indicatorLineRef.current.clear();
        // Marker plugins live on the CANDLE series (which survives this
        // teardown) — clearing the map alone leaves their labels rendering
        // forever ("Bullish CHoCH" ghosts after removing the indicator).
        for (const [, mk] of indicatorMarkersRef.current) {
          try { mk.setMarkers([]); } catch {}
          try { (mk as unknown as { detach?: () => void }).detach?.(); } catch {}
        }
        indicatorMarkersRef.current.clear();
        lastPushedPlotRef.current.clear();
        plotWriteSnapshotsRef.current.clear();
        primitiveRawRef.current.clear();
        for (const pane of [...panes.values()].sort((a, b) => b.paneIndex() - a.paneIndex())) {
          try { chart.removePane(pane.paneIndex()); } catch {}
        }
        panes.clear();
        separatePaneRef.current = null;

        let styledPanes = false;
        for (const { key, result } of visibleResults) {
          const hasSeparate = result.plots.some((p) => p.pane === 'separate');
          let paneIndex = 0;
          if (hasSeparate) {
            const pane = chart.addPane();
            pane.setStretchFactor(250);
            paneIndex = pane.paneIndex();
            panes.set(key, pane);
            chart.priceScale('right', paneIndex).applyOptions({
              visible: true,
              borderColor: OSC.paneBorderColor,
              textColor: OSC.axisTextColor,
              autoScale: true,
              scaleMargins: OSC.scaleMargins, // breathing room; curves never clip
            });
            if (!styledPanes) {
              try {
                const mainPane = chart.panes?.()?.[0];
                if (mainPane) mainPane.setStretchFactor(1000);
                
                chart.applyOptions({
                  layout: {
                    panes: {
                      separatorColor: OSC.separatorColor,
                      separatorHoverColor: OSC.separatorHoverColor,
                    },
                  },
                });
              } catch {}
              styledPanes = true;
            }
          }

          for (const plot of result.plots) {
            const targetPane = plot.pane === 'separate' ? paneIndex : 0;
            const st = indicatorSettingsMap?.[key]?.styles?.[plot.id];
            const baseColor = st?.color || plot.color;
            // SMC structure plots are annotation segments. Fade older segments at
            // render time so the latest CHoCH/BOS wins without mutating the
            // analytical result or its replay/cache identity.
            const isStructurePlot = plot.id.startsWith('struct_');
            const firstStructureBar = isStructurePlot ? plot.data.findIndex((value) => value != null) : -1;
            const structureAge = firstStructureBar >= 0 ? plot.data.length - 1 - firstStructureBar : 0;
            const color = isStructurePlot ? analyticalColor(baseColor, analyticalDecay(structureAge)) : baseColor;
            // Oscillator-pane lines inherit the design-system hair-thin default
            // unless the user explicitly thickened this plot; overlays on the
            // price pane keep their own weight.
            const lineWidth = (st?.thickness as 1 | 2 | 3 | 4)
              || (plot.pane === 'separate'
                    ? OSC.lineWidth
                    : ((plot.lineWidth as 1 | 2 | 3 | 4) || 2));
            const isHidden = hiddenKeys.has(key);
            const visible = isHidden ? false : (st?.display !== false);
            const labelsOnPriceScale = indicatorSettingsMap?.[key]?.labelsOnPriceScale ?? true;
            // Price-scale labels: only the indicator's PRIMARY plot labels the
            // axis by default (TV-style; secondary lines like band edges or
            // basis lines were stacking pills). Plots can force with
            // axisLabel: true or suppress with axisLabel: false.
            const isPrimaryPlot = plot === result.plots[0];
            const axisLabels =
              plot.axisLabel === false
                ? false
                : plot.axisLabel === true
                  ? labelsOnPriceScale
                  : labelsOnPriceScale && isPrimaryPlot;
            let series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | undefined;
            // LWC renders `title` on the price scale even with lastValueVisible
            // off, so non-labeled plots must blank it as well.
            const seriesTitle = axisLabels ? plot.title : '';
            if (plot.type === 'histogram') {
              series = chart.addSeries(
                HistogramSeries,
                { color, visible, priceLineVisible: axisLabels, lastValueVisible: axisLabels, title: seriesTitle },
                targetPane,
              );
            } else {
              series = chart.addSeries(
                LineSeries,
                {
                  color,
                  lineWidth,
                  visible,
                  priceLineVisible: axisLabels,
                  lastValueVisible: axisLabels,
                  crosshairMarkerVisible: false,
                  title: seriesTitle,
                },
                targetPane,
              );
            }
            if (series) existing.set(`${key}::${plot.id}`, series);

            // `band` plots have no line data — a per-bar filled rectangle
            // primitive draws them (supply/demand zones etc.). Attach to the
            // CANDLE series: a primitive's priceToCoordinate uses its host
            // series' price mapping, and the band's own series is empty (no
            // range → null coordinates). The candle series has data and shares
            // the main price scale. Detached explicitly on teardown below.
            if (plot.type === 'band' && candleSeriesRef.current) {
              try {
                const bp = new IndicatorBandPrimitive();
                candleSeriesRef.current.attachPrimitive(bp);
                indicatorBandRef.current.set(`${key}::${plot.id}`, bp);
              } catch {}
            }
          }

          // Horizontal levels (hlines) + fills on the indicator's main series.
          const mainSeries = result.plots[0] ? existing.get(`${key}::${result.plots[0].id}`) : undefined;
          if (mainSeries) {
            for (const lv of result.levels ?? []) {
              try {
                mainSeries.createPriceLine({
                  price: lv.value,
                  color: lv.color,
                  lineWidth: (lv.lineWidth as 1 | 2 | 3 | 4) ?? 1,
                  lineStyle:
                    lv.lineStyle === 'dashed'
                      ? LineStyle.Dashed
                      : lv.lineStyle === 'dotted'
                        ? LineStyle.Dotted
                        : LineStyle.Solid,
                  axisLabelVisible: indicatorSettingsMap?.[key]?.labelsOnPriceScale ?? true,
                  title: lv.title ?? '',
                });
              } catch {}
            }
            if (result.fills && result.fills.length > 0) {
              try { mainSeries.attachPrimitive(new IndicatorFillPrimitive(result.fills)); } catch {}
            }
            if (result.gradientFills && result.gradientFills.length > 0) {
              try {
                const gp = new GradientZonePrimitive();
                mainSeries.attachPrimitive(gp);
                indicatorGradientRef.current.set(key, gp);
              } catch {}
            }
          }

          // Volume profiles are price-indexed and own no plot series, so they
          // hang off the candle series (which always has data and shares the
          // main price scale) rather than `mainSeries`, which is undefined here.
          if (result.profiles && result.profiles.length > 0 && candleSeriesRef.current) {
            try {
              const pp = new SessionVolumeProfilePrimitive();
              candleSeriesRef.current.attachPrimitive(pp);
              indicatorProfileRef.current.set(key, pp);
            } catch {}
          }

          if (result.lineSegments && result.lineSegments.length > 0 && candleSeriesRef.current) {
            try {
              const lp = new IndicatorLinePrimitive();
              candleSeriesRef.current.attachPrimitive(lp);
              indicatorLineRef.current.set(key, lp);
            } catch {}
          }

          // Pane markers. Anchor: separate-pane indicators pin markers to
          // their own first series (e.g. divergence labels on the RSI line);
          // overlay indicators pin to the CANDLE series — an overlay's first
          // plot can be a band/annotation series with sparse data, and LWC
          // silently drops markers that fall on whitespace.
          if (result.markers) {
            const hasSeparate = result.plots.some((p) => p.pane === 'separate');
            const markerHost = hasSeparate && mainSeries ? mainSeries : candleSeriesRef.current;
            if (markerHost) {
              try { indicatorMarkersRef.current.set(key, createSeriesMarkers(markerHost, [])); } catch {}
            }
          }
        }
      }

      // Line and histogram plots can use a tail update only after their
      // historical values have been proven unchanged. This remains separate
      // from indicator computation: even a full-computed plot earns the fast
      // path when its previous values are byte-for-byte stable.
      const structuralIndicatorWrite =
        isNewContext || indicatorStructureChanged || indicatorSettingsChanged || (!isIncremental && !isAppendOne);
      for (const { key, result } of visibleResults) {
        for (const plot of result.plots) {
          if (plot.type !== 'line' && plot.type !== 'histogram') continue;
          const seriesKey = `${key}::${plot.id}`;
          const series = existing.get(seriesKey);
          if (!series) continue;
          try {
            const write = writeIndicatorSeries<{ time: Time; value: number; color?: string }>({
              series: series as unknown as {
                setData(data: Array<{ time: Time; value: number; color?: string }>): void;
                update(data: { time: Time; value: number; color?: string }): void;
              },
              raw: plot.data,
              candles,
              structural: structuralIndicatorWrite,
              timeOf: (point) => point.time as number,
              format: (value, index) => {
                if (value == null || !candles[index]) return null;
                let numeric: number;
                let color: string | undefined;
                if (typeof value === 'object' && 'value' in value) {
                  const valued = value as { value: number; color?: string };
                  if (!Number.isFinite(valued.value)) return null;
                  numeric = valued.value;
                  color = valued.color;
                } else {
                  if (!Number.isFinite(value as number)) return null;
                  numeric = value as number;
                }
                const time = shiftTime(candles[index].time as number) as Time;
                if (!Number.isFinite(time as number)) return null;
                const paint = color && plot.type === 'histogram' && plot.pane === 'separate'
                  ? softHistogram(color)
                  : color;
                return paint ? { time, value: numeric, color: paint } : { time, value: numeric };
              },
            }, plotWriteSnapshotsRef.current.get(seriesKey));
            plotWriteSnapshotsRef.current.set(seriesKey, write.snapshot);
          } catch (err) {
            console.error(`Failed to write indicator data for ${key}::${plot.id}:`, err);
          }
        }

        // Band primitives use in-place tail mutation only for simple bands.
        // Zone bands precompute contiguous runs and therefore stay structural.
        for (const plot of result.plots) {
          if (plot.type !== 'band') continue;
          const bandKey = `band::${key}::${plot.id}`;
          const bp = indicatorBandRef.current.get(`${key}::${plot.id}`);
          if (!bp) continue;
          const st = indicatorSettingsMap?.[key]?.styles?.[plot.id];
          const visible = hiddenKeys.has(key) ? false : st?.display !== false;
          const mutation = classifyTailMutation(
            primitiveRawRef.current.get(bandKey),
            plot.data,
            structuralIndicatorWrite || plot.zoneStyle != null || candles.length !== plot.data.length,
          );
          const point = plot.data.at(-1);
          const upper = point != null && typeof point === 'object' && 'upper' in point && Number.isFinite(point.upper)
            ? point.upper : null;
          const lower = point != null && typeof point === 'object' && 'lower' in point && Number.isFinite(point.lower)
            ? point.lower : null;
          const time = candles.at(-1) != null && Number.isFinite(candles.at(-1)!.time as number)
            ? shiftTime(candles.at(-1)!.time as number) as number : null;
          let wroteTail = false;
          if (mutation === 'updateLast' && time != null) wroteTail = bp.updateLast(upper, lower, time, st?.color || plot.color, visible);
          if (mutation === 'append' && time != null) wroteTail = bp.append(upper, lower, time, st?.color || plot.color, visible);
          if (mutation === 'none') wroteTail = true;
          if (!wroteTail) {
            const upperData: (number | null)[] = [];
            const lowerData: (number | null)[] = [];
            for (const value of plot.data) {
              if (value != null && typeof value === 'object' && 'upper' in value && 'lower' in value
                  && Number.isFinite(value.upper) && Number.isFinite(value.lower)) {
                upperData.push(value.upper);
                lowerData.push(value.lower);
              } else {
                upperData.push(null);
                lowerData.push(null);
              }
            }
            const times = candles.map((candle) =>
              candle != null && Number.isFinite(candle.time as number)
                ? shiftTime(candle.time as number) as number
                : null,
            );
            try { bp.setData(upperData, lowerData, times, st?.color || plot.color, visible, plot.zoneStyle, plot.areaFill ?? false, plot.areaFillColors); } catch {}
          }
          primitiveRawRef.current.set(bandKey, plot.data);
        }

        // Gradient primitives have no LWC series, but can still avoid full
        // value/time array replacement when their source tail is the only change.
        const gp = indicatorGradientRef.current.get(key);
        if (gp && result.gradientFills && result.gradientFills.length > 0) {
          const srcId = result.gradientFills[0].plotId;
          const srcPlot = result.plots.find((plot) => plot.id === srcId);
          if (srcPlot) {
            const gradientKey = `gradient::${key}::${srcId}`;
            const zonesChanged = lastPushedPlotRef.current.get(gradientKey) !== result.gradientFills;
            const mutation = classifyTailMutation(
              primitiveRawRef.current.get(gradientKey),
              srcPlot.data,
              structuralIndicatorWrite || zonesChanged || candles.length !== srcPlot.data.length || gp.times.length !== srcPlot.data.length,
            );
            const tail = srcPlot.data.at(-1);
            const value = tail == null ? null : typeof tail === 'object' && 'value' in tail ? tail.value : tail as number;
            const time = candles.at(-1) != null && Number.isFinite(candles.at(-1)!.time as number)
              ? shiftTime(candles.at(-1)!.time as number) as number : null;
            let wroteTail = false;
            if (mutation === 'updateLast' && time != null) wroteTail = gp.updateLast(value != null && Number.isFinite(value) ? value : null, time, result.gradientFills);
            if (mutation === 'append' && time != null) wroteTail = gp.append(value != null && Number.isFinite(value) ? value : null, time, result.gradientFills);
            if (mutation === 'none') wroteTail = true;
            if (!wroteTail) {
              const values = srcPlot.data.map((point) => {
                const numeric = point == null ? null : typeof point === 'object' && 'value' in point ? point.value : point as number;
                return numeric != null && Number.isFinite(numeric) ? numeric : null;
              });
              const times = candles
                .filter((candle) => candle != null && Number.isFinite(candle.time as number))
                .map((candle) => shiftTime(candle.time as number) as number);
              try { gp.setData(values, times, result.gradientFills); } catch {}
            }
            primitiveRawRef.current.set(gradientKey, srcPlot.data);
            lastPushedPlotRef.current.set(gradientKey, result.gradientFills);
          }
        }

        // Volume profiles: the compute layer emits RAW candle time (it is
        // deliberately UI-agnostic), so shift session + level-extension times
        // into chart time here, at the same boundary every other series uses.
        const pp = indicatorProfileRef.current.get(key);
        const profileKey = `profile::${key}`;
        if (pp && result.profiles && result.profileStyle &&
            (structuralIndicatorWrite || lastPushedPlotRef.current.get(profileKey) !== result.profiles)) {
          lastPushedPlotRef.current.set(profileKey, result.profiles);
          const shiftMaybe = (t: number | null | undefined) =>
            t == null ? t : (shiftTime(t) as number);
          const shifted = result.profiles.map((prof) => ({
            ...prof,
            startTime: shiftTime(prof.startTime) as number,
            endTime: shiftTime(prof.endTime) as number,
            pocExtendTo: shiftMaybe(prof.pocExtendTo),
            vahExtendTo: shiftMaybe(prof.vahExtendTo),
            valExtendTo: shiftMaybe(prof.valExtendTo),
          }));
          const shiftedHistorical = result.historicalPocs?.map((record) => ({
            ...record,
            sessionStart: shiftTime(record.sessionStart) as number,
            sessionEnd: shiftTime(record.sessionEnd) as number,
          })) ?? [];
          const visible = hiddenKeys.has(key);
          try { pp.setData(visible ? [] : shifted, result.profileStyle, visible ? [] : shiftedHistorical); } catch {}
        }

        const lp = indicatorLineRef.current.get(key);
        if (lp && result.lineSegments && lastPushedPlotRef.current.get('line::' + key) !== result.lineSegments) {
          lastPushedPlotRef.current.set('line::' + key, result.lineSegments);
          const st = indicatorSettingsMap?.[key]?.styles?.['regression_line'];
          const segments = hiddenKeys.has(key) || st?.display === false ? [] : result.lineSegments.map((segment) => ({
            ...segment,
            startTime: shiftTime(segment.startTime) as number,
            endTime: shiftTime(segment.endTime) as number,
            // Keep the regression segment slope color (rising/falling) intact.
            color: segment.color,
            lineWidth: st?.thickness || segment.lineWidth,
            lineStyle: (st?.lineStyle || segment.lineStyle || 'solid') as 'solid' | 'dashed' | 'dotted',
          }));
          try { lp.setData(segments, true); } catch {}
        }

        // Pane markers (e.g. divergence Bull/Bear).
        const mk = indicatorMarkersRef.current.get(key);
        if (mk && result.markers && lastPushedPlotRef.current.get(`mk::${key}`) !== result.markers) {
          lastPushedPlotRef.current.set(`mk::${key}`, result.markers);
          const isHidden = hiddenKeys.has(key);
          const markers = isHidden ? [] : result.markers
            .filter((m) => {
              const c = candles[m.index];
              return c != null && Number.isFinite(c.time as number);
            })
            .map((m) => ({
              time: shiftTime(candles[m.index].time as number),
              position: m.position,
              color: m.color,
              shape: m.shape,
              text: m.text,
            }))
            .sort((a, b) => (a.time as number) - (b.time as number));
          try { mk.setMarkers(markers as SeriesMarker<Time>[]); } catch {}
        }
      }
    }

    lastBarTimeRef.current = lastTime;

    if ((isNewContext || indicatorStructureChanged) && chartRef.current) {
      // The first primitive paint can happen before Lightweight Charts has
      // established the final visible range. Refresh once after the range
      // settles so overlays are correct on the first render, not only after
      // the next market-data tick.
      let firstRaf = 0;
      firstRaf = requestAnimationFrame(() => {
        refs.pendingAnimationFramesRef.current.delete(firstRaf);
        if (!active()) return;
        if (isNewContext) applyDefaultView();
        let secondRaf = 0;
        secondRaf = requestAnimationFrame(() => {
          refs.pendingAnimationFramesRef.current.delete(secondRaf);
          if (active()) refreshIndicatorPrimitives();
        });
        refs.pendingAnimationFramesRef.current.add(secondRaf);
      });
      refs.pendingAnimationFramesRef.current.add(firstRaf);
    }
  }, [candles, type, isRenko, tf, symbol, visibleResults, indicatorSettingsMap, hiddenKeys]);
}
