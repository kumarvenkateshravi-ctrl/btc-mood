// Smart Money Concepts chart overlay — a RENDER-ONLY adapter over the SMC
// Intelligence Engine (lib/smc/engine.ts). It never computes market logic:
// it maps an SmcSnapshot onto indicator-framework primitives (band plots for
// OB/FVG/zone boxes, markers for BOS/CHoCH/EQH/EQL labels).
//
// Perf: computeSmc is cached on a closed-bar signature so live in-bar ticks
// reuse the snapshot (see lib/smc — indicator tick-perf rule); only this
// cheap mapping re-runs per render.

import type { Candle } from '../types';
import type { IndicatorEvaluationContext } from '../indicatorEvaluation';
import { selectIndicatorCandles } from '../indicatorEvaluation';
import type {
  CustomIndicatorConfig,
  IndicatorMarker,
  IndicatorPlot,
  IndicatorResult,
  SignalSide,
} from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';
import { computeSmcWindowed } from '../smc/engine';
import type { SmcObject, SmcSnapshot } from '../smc/types';

interface SmcOverlayInputs {
  showSwing: boolean;
  showInternal: boolean;
  showOrderBlocks: boolean;
  showFvg: boolean;
  showLiquidity: boolean;
  showZones: boolean;
  showLabels: boolean;
  labelStyle: 'full' | 'compact';
  /** BOS/CHoCH annotation: 'full' = "Bullish BOS", 'compact' = "BOS",
   *  'hidden' = structure lines only, no text. */
  structureLabels: 'full' | 'compact' | 'hidden';
  /** HH / HL / LH / LL labels on swing pivots. */
  showSwingLabels: boolean;
  debugMode: boolean;
  swingsLength: number;
  internalLength: number;
}

const DEFAULTS: SmcOverlayInputs = {
  showSwing: true,
  showInternal: true,
  showOrderBlocks: true,
  showFvg: false, // script default
  showLiquidity: true,
  showZones: false, // script default
  showLabels: true,
  labelStyle: 'full',
  structureLabels: 'full', // no abbreviations for beginners
  showSwingLabels: false, // script default (showSwingsInput = false)
  debugMode: false,
  swingsLength: 50,
  internalLength: 5,
};

// Human-readable lifecycle for zone labels ("Fresh" = untouched, per SMC lingo).
const STATE_LABEL: Record<string, string> = {
  active: 'Fresh',
  tested: 'Tested',
  partial: 'Partial',
  mitigated: 'Mitigated',
  invalidated: 'Invalidated',
  archived: 'Old',
};

/**
 * Label for an OB/FVG box so no rectangle is ever anonymous (a trader should
 * never have to remember color coding). Full: "Bullish OB • 91 · Fresh";
 * compact: "OB 91". Debug mode shows the raw state + all three metrics.
 */
function boxLabel(o: SmcObject, inputs: SmcOverlayInputs): string | undefined {
  const kindName = o.kind === 'orderBlock' ? 'OB' : 'FVG';
  if (inputs.debugMode) {
    return `${kindName} ${o.state} ${o.strength}/${o.quality}/${o.confidence}`;
  }
  if (!inputs.showLabels) return undefined;
  if (inputs.labelStyle === 'compact') {
    return o.kind === 'orderBlock' ? `OB ${o.strength}` : 'FVG';
  }
  const dir = o.direction === 'bullish' ? 'Bullish' : 'Bearish';
  if (o.kind === 'fvg') {
    const fill = o.state === 'partial' && o.touches > 0 ? ` · ${o.touches}% filled` : '';
    return `${dir} FVG${fill}`;
  }
  return `${dir} OB • ${o.strength} · ${STATE_LABEL[o.state] ?? o.state}`;
}

// LuxAlgo default colors mapped to rgba.
const GREEN = '#089981';
const RED = '#F23645';
const YELLOW = '#f5b93e'; // CHoCH — instantly distinguishable from BOS green/red
const GRAY = '#878b94'; // HH/HL/LH/LL swing labels
const OB_COLORS: Record<string, string> = {
  'internal:bullish': 'rgba(49,121,245,0.20)',
  'internal:bearish': 'rgba(247,124,128,0.20)',
  'swing:bullish': 'rgba(24,72,204,0.20)',
  'swing:bearish': 'rgba(178,40,51,0.20)',
};
const FVG_COLORS: Record<string, string> = {
  bullish: 'rgba(0,255,104,0.30)',
  bearish: 'rgba(255,0,8,0.30)',
};
const ZONE_COLORS: Record<string, string> = {
  premium: 'rgba(242,54,69,0.20)',
  equilibrium: 'rgba(135,139,148,0.20)',
  discount: 'rgba(8,153,129,0.20)',
};

/** Halve the alpha of an rgba() color for dimmed (debug) rendering. */
function dim(rgba: string): string {
  return rgba.replace(/,([\d.]+)\)$/, (_, a) => `,${(parseFloat(a) / 2).toFixed(2)})`);
}

const LIVE = new Set(['active', 'tested', 'partial']);

// Closed-bar snapshot cache (module scope; one chart series per module load
// path is fine — the key includes length, last bar time and config).
let cache: { key: string; snap: SmcSnapshot } | null = null;

function contextIdentity(context?: IndicatorEvaluationContext): string {
  if (!context) return 'direct';
  const replay = context.replay ? `${context.replay.sessionId}:${context.replay.cutTime}:${context.replay.executionTimeframe}` : 'live';
  return [context.mode, replay, context.symbol, context.timeframe, context.sourceRevision, context.transform].join('|');
}

function getSnapshot(candles: Candle[], inputs: SmcOverlayInputs, context?: IndicatorEvaluationContext): SmcSnapshot {
  const last = candles[candles.length - 1];
  const closed = candles.length > 1 ? candles[candles.length - 2].close : 0;
  const key = `${contextIdentity(context)}:${candles.length}:${last ? last.time : 0}:${candles[0]?.open ?? 0}:${closed}:${inputs.swingsLength}:${inputs.internalLength}`;
  if (context && cache && cache.key === key) return cache.snap;
  const snap = computeSmcWindowed(candles, 2500, {
    swingsLength: inputs.swingsLength,
    internalLength: inputs.internalLength,
  }, context);
  if (context) cache = { key, snap };
  return snap;
}

function bandPlot(
  id: string,
  title: string,
  color: string,
  from: number,
  top: number,
  bottom: number,
  n: number,
  zoneStyle: {
    label?: string;
    /** Price-facing edge. REQUIRED for visibility: bands without a boundary
     *  render as "subtle context" (0.03 fill alpha, no borders). */
    boundary?: 'upper' | 'lower';
    /** 0..1 — drives border weight. */
    emphasis?: number;
    lineStyle?: 'solid' | 'dashed';
  } = {},
): IndicatorPlot {
  const data: IndicatorPlot['data'] = new Array(n).fill(null);
  for (let j = Math.max(0, from); j < n; j++) data[j] = { upper: top, lower: bottom };
  return {
    id,
    title,
    color,
    type: 'band',
    data,
    pane: 'overlay',
    zoneStyle,
  };
}

// Result-object cache: the per-run chart sync pushes setData for EVERY plot
// on EVERY pass. Returning the SAME result object for an unchanged closed bar
// lets the chart layer skip those pushes entirely (reference equality).
let resultCache: { key: string; result: IndicatorResult } | null = null;

export function computeSmcOverlay(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  _computedSources?: Record<string, (number | null)[]>,
  context?: IndicatorEvaluationContext,
): IndicatorResult {
  const inputs = resolveInputs<SmcOverlayInputs>(config, DEFAULTS);
  const selected = context ? selectIndicatorCandles(context, 'raw', 'closed') : candles;
  const analytical = context?.replay ? selected.filter((c) => c.time <= context.replay!.cutTime) : selected;
  const evaluationContext = context ? { ...context, rawCandles: analytical, displayCandles: analytical, closedCandles: analytical, hasFormingBar: false } : undefined;
  const lastC = analytical[analytical.length - 1];
  const closedC = analytical.length > 1 ? analytical[analytical.length - 2].close : 0;
  const resultKey = [contextIdentity(evaluationContext), analytical.length, lastC?.time ?? 0, analytical[0]?.open ?? 0, closedC, JSON.stringify(inputs)].join('|');
  if (context && resultCache && resultCache.key === resultKey) return resultCache.result;
  const result = buildSmcOverlay(analytical, inputs, evaluationContext);
  if (context) resultCache = { key: resultKey, result };
  return result;
}

function buildSmcOverlay(candles: Candle[], inputs: SmcOverlayInputs, context?: IndicatorEvaluationContext): IndicatorResult {
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const snap = getSnapshot(candles, inputs, context);
  const plots: IndicatorPlot[] = [];
  const markers: IndicatorMarker[] = [];
  const debug = inputs.debugMode;

  // ---- BOS / CHoCH → structure line on the broken level + text label ----
  // TradingView-style: a horizontal segment from the pivot bar to the break
  // bar at the broken level, labelled "Bullish BOS" / "Bearish CHoCH".
  // CHoCH is yellow (trend change warning); BOS is green/red (confirmation).
  const levelById = new Map(snap.objects.structureLevels.map((l) => [l.id, l]));
  // Each structure segment is its OWN chart series with an n-length array.
  // Unbounded, a deep-loaded history (tens of thousands of bars, hundreds of
  // breaks) means hundreds of series that are all torn down and rebuilt on
  // every lazy-load prepend (bar indices shift -> plot ids shift -> signature
  // churn) — which froze the chart during zoom-out. Render only the most
  // recent breaks; older ones are far off-screen anyway.
  const MAX_STRUCT_SEGMENTS = 40;
  let structTotal = 0;
  for (const e of snap.events) {
    if (e.type === 'BOS' || e.type === 'CHOCH') structTotal++;
  }
  let structSeen = 0;
  for (const e of snap.events) {
    if (e.type === 'BOS' || e.type === 'CHOCH') {
      structSeen++;
      if (structTotal - structSeen >= MAX_STRUCT_SEGMENTS) continue;
      if (e.scope === 'swing' && !inputs.showSwing) continue;
      if (e.scope === 'internal' && !inputs.showInternal) continue;
      const lvl = e.objectId ? levelById.get(e.objectId) : undefined;
      const from = lvl ? lvl.createdAtBar : Math.max(0, e.barIndex - 10);
      const color = e.type === 'CHOCH' ? YELLOW : e.direction === 'bullish' ? GREEN : RED;
      const lineData: IndicatorPlot['data'] = new Array(n).fill(null);
      for (let j = Math.max(0, from); j <= Math.min(e.barIndex, n - 1); j++) lineData[j] = e.price;
      plots.push({
        // Time-based id: bar indices shift on every lazy-load prepend, which
        // changed `e.id`-based ids -> signature churn -> full teardown and
        // rebuild of every series per prepend (the zoom-out freeze). Times
        // never shift.
        id: `struct_${e.type}_${e.scope}_${e.direction}_${candles[Math.min(e.barIndex, n - 1)]?.time ?? e.barIndex}`,
        title: e.type,
        color,
        type: 'line',
        data: lineData,
        lineWidth: e.scope === 'swing' ? 2 : 1,
        pane: 'overlay',
        axisLabel: false, // annotation segment — keep the price scale clean
      });
      if (inputs.structureLabels !== 'hidden') {
        const tag = e.type === 'CHOCH' ? 'CHoCH' : 'BOS';
        const dir = e.direction === 'bullish' ? 'Bullish' : 'Bearish';
        markers.push({
          index: e.barIndex,
          position: e.direction === 'bullish' ? 'belowBar' : 'aboveBar',
          color,
          shape: e.scope === 'internal' ? 'circle' : e.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
          text: inputs.structureLabels === 'full' ? `${dir} ${tag}` : tag,
        });
      }
    } else if ((e.type === 'EQH_FORMED' || e.type === 'EQL_FORMED') && inputs.showLiquidity) {
      markers.push({
        index: e.barIndex,
        position: e.type === 'EQH_FORMED' ? 'aboveBar' : 'belowBar',
        color: e.type === 'EQH_FORMED' ? RED : GREEN,
        shape: 'circle',
        text: e.type === 'EQH_FORMED' ? 'EQH' : 'EQL',
      });
    } else if (e.type === 'LIQUIDITY_SWEEP' && (inputs.showLiquidity || debug)) {
      markers.push({
        index: e.barIndex,
        position: e.direction === 'bearish' ? 'aboveBar' : 'belowBar',
        color: e.direction === 'bearish' ? RED : GREEN,
        shape: 'square',
        text: 'SWEEP',
      });
    }
  }

  // ---- HH / HL / LH / LL swing labels (derived render-side from the swing
  // pivot sequence — presentation only, no engine change) ----
  if (inputs.showSwingLabels) {
    let prevHigh = NaN;
    let prevLow = NaN;
    for (const l of snap.objects.structureLevels) {
      if (l.scope !== 'swing') continue;
      if (l.direction === 'bearish') {
        // swing HIGH pivot (price crossing UP through it would be bullish)
        const text = !Number.isFinite(prevHigh) || l.top > prevHigh ? 'HH' : 'LH';
        prevHigh = l.top;
        markers.push({ index: l.createdAtBar, position: 'aboveBar', color: GRAY, shape: 'circle', text });
      } else {
        const text = !Number.isFinite(prevLow) || l.bottom < prevLow ? 'LL' : 'HL';
        prevLow = l.bottom;
        markers.push({ index: l.createdAtBar, position: 'belowBar', color: GRAY, shape: 'circle', text });
      }
    }
  }

  // ---- Order blocks → band plots ----
  if (inputs.showOrderBlocks) {
    const perScope: Record<'internal' | 'swing', number> = { internal: 0, swing: 0 };
    const maxPer = { internal: snap.metadata.config.maxInternalOrderBlocks, swing: snap.metadata.config.maxSwingOrderBlocks };
    for (const ob of snap.objects.orderBlocks) {
      const scope = ob.scope ?? 'internal';
      if ((scope === 'swing' && !inputs.showSwing) || (scope === 'internal' && !inputs.showInternal)) continue;
      const live = LIVE.has(ob.state);
      if (!live && !debug) continue;
      if (live && perScope[scope] >= maxPer[scope]) continue;
      if (live) perScope[scope] += 1;
      const base = OB_COLORS[`${scope}:${ob.direction}`];
      plots.push(
        bandPlot(
          `ob_${ob.id}`,
          `OB ${scope}`,
          live ? base : dim(base),
          ob.createdAtBar,
          ob.top,
          ob.bottom,
          n,
          {
            label: boxLabel(ob, inputs),
            // Bullish OBs sit below price (price approaches the top edge).
            boundary: ob.direction === 'bullish' ? 'upper' : 'lower',
            emphasis: ob.strength / 100,
            lineStyle: scope === 'internal' ? 'dashed' : 'solid',
          },
        ),
      );
    }
  }

  // ---- Fair value gaps → band plots ----
  if (inputs.showFvg) {
    let count = 0;
    for (const gap of snap.objects.fvgs) {
      const live = LIVE.has(gap.state);
      if (!live && !debug) continue;
      if (live && count >= 10) continue;
      if (live) count += 1;
      const base = FVG_COLORS[gap.direction];
      plots.push(
        bandPlot(
          `fvg_${gap.id}`,
          'FVG',
          live ? base : dim(base),
          gap.createdAtBar,
          gap.top,
          gap.bottom,
          n,
          {
            label: boxLabel(gap, inputs),
            boundary: gap.direction === 'bullish' ? 'upper' : 'lower',
            emphasis: gap.strength / 100,
            lineStyle: 'dashed',
          },
        ),
      );
    }
  }

  // ---- Premium / discount zones → band plots ----
  if (inputs.showZones) {
    for (const zone of snap.objects.zones) {
      const name = zone.id.split('_')[1] ?? 'equilibrium';
      const label = inputs.showLabels || debug
        ? name.charAt(0).toUpperCase() + name.slice(1) // "Premium" / "Equilibrium" / "Discount"
        : undefined;
      plots.push(
        bandPlot(`zone_${name}`, name, ZONE_COLORS[name] ?? ZONE_COLORS.equilibrium, zone.createdAtBar, zone.top, zone.bottom, n, {
          label,
          boundary: name === 'premium' ? 'lower' : 'upper',
          emphasis: 0.4,
          lineStyle: 'dashed',
        }),
      );
    }
  }

  // ---- Setup state → last-bar signal ----
  if (
    (snap.state.setup === 'ready' || snap.state.setup === 'confirmed') &&
    snap.state.setupDirection
  ) {
    signals[n - 1] = snap.state.setupDirection === 'bullish' ? 'buy' : 'sell';
  }

  return { plots, signals, markers: markers.length > 150 ? markers.slice(-150) : markers };
}
