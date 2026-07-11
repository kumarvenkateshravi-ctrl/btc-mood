// Smart Money Concepts chart overlay — a RENDER-ONLY adapter over the SMC
// Intelligence Engine (lib/smc/engine.ts). It never computes market logic:
// it maps an SmcSnapshot onto indicator-framework primitives (band plots for
// OB/FVG/zone boxes, markers for BOS/CHoCH/EQH/EQL labels).
//
// Perf: computeSmc is cached on a closed-bar signature so live in-bar ticks
// reuse the snapshot (see lib/smc — indicator tick-perf rule); only this
// cheap mapping re-runs per render.

import type { Candle } from '../types';
import type {
  CustomIndicatorConfig,
  IndicatorMarker,
  IndicatorPlot,
  IndicatorResult,
  SignalSide,
} from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';
import { computeSmc } from '../smc/engine';
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

function getSnapshot(candles: Candle[], inputs: SmcOverlayInputs): SmcSnapshot {
  const last = candles[candles.length - 1];
  const key = `${candles.length}:${last ? last.time : 0}:${inputs.swingsLength}:${inputs.internalLength}`;
  if (cache && cache.key === key) return cache.snap;
  const snap = computeSmc(candles, {
    swingsLength: inputs.swingsLength,
    internalLength: inputs.internalLength,
  });
  cache = { key, snap };
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
  label?: string,
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
    zoneStyle: label ? { label } : undefined,
  };
}

export function computeSmcOverlay(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inputs = resolveInputs<SmcOverlayInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const snap = getSnapshot(candles, inputs);
  const plots: IndicatorPlot[] = [];
  const markers: IndicatorMarker[] = [];
  const debug = inputs.debugMode;

  // ---- Structure + liquidity events → markers ----
  for (const e of snap.events) {
    if (e.type === 'BOS' || e.type === 'CHOCH') {
      if (e.scope === 'swing' && !inputs.showSwing) continue;
      if (e.scope === 'internal' && !inputs.showInternal) continue;
      markers.push({
        index: e.barIndex,
        position: e.direction === 'bullish' ? 'belowBar' : 'aboveBar',
        color: e.direction === 'bullish' ? GREEN : RED,
        shape: e.scope === 'internal' ? 'circle' : e.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
        text: e.type === 'CHOCH' ? 'CHoCH' : 'BOS',
      });
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
          boxLabel(ob, inputs),
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
          boxLabel(gap, inputs),
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
      plots.push(bandPlot(`zone_${name}`, name, ZONE_COLORS[name] ?? ZONE_COLORS.equilibrium, zone.createdAtBar, zone.top, zone.bottom, n, label));
    }
  }

  // ---- Setup state → last-bar signal ----
  if (
    (snap.state.setup === 'ready' || snap.state.setup === 'confirmed') &&
    snap.state.setupDirection
  ) {
    signals[n - 1] = snap.state.setupDirection === 'bullish' ? 'buy' : 'sell';
  }

  return { plots, signals, markers };
}
