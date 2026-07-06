import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { BandZoneStyle } from './indicatorFramework';

// Draws an indicator `band` plot. Two modes:
//
// 1. Legacy (no zoneStyle): per-bar flat fill between { upper, lower } — used
//    by generic band indicators.
// 2. Zone mode (zoneStyle set): premium supply/demand rendering. Each zone
//    "run" (a contiguous stretch of identical upper/lower) is drawn
//    boundary-first: an emphasized edge line on the side facing price, a
//    gradient fill fading away from that edge, dimmed historical runs, an
//    on-zone label for the active run ("D Supply ★91") and signal-origin
//    anchor dots on the boundary.
//
// zOrder 'bottom' keeps the candles readable on top of the fill.

interface ZoneRun {
  start: number; // first bar index of the run
  end: number;   // last bar index (inclusive)
  upper: number;
  lower: number;
}

/** Extract "r,g,b" from `rgba(r,g,b,a)` / `rgb(...)` / `#rrggbb`. */
function rgbOf(color: string): string {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return `${m[1]},${m[2]},${m[3]}`;
  const h = color.match(/^#([0-9a-f]{6})$/i);
  if (h) {
    const n = parseInt(h[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  return '120,120,120';
}

class BandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: IndicatorBandPrimitive,
  ) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    if (!this._prim.visible) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const series = this._api.series;
      const ts = this._api.chart.timeScale();
      const barSpacing = ts.options().barSpacing ?? 6;
      const halfW = Math.max(0.5, (barSpacing * hpr) / 2);

      const { upper, lower, times, color, zoneStyle } = this._prim;

      if (!zoneStyle) {
        // ---- Legacy flat fill --------------------------------------------
        ctx.fillStyle = color;
        for (let i = 0; i < upper.length; i++) {
          const u = upper[i];
          const l = lower[i];
          if (u == null || l == null) continue;
          const x = ts.timeToCoordinate(times[i] as Time);
          if (x == null) continue;
          const cx = x * hpr;
          const yU = series.priceToCoordinate(u);
          const yL = series.priceToCoordinate(l);
          if (yU === null || yL === null) continue;
          const top = Math.min(yU, yL) * vpr;
          const bot = Math.max(yU, yL) * vpr;
          ctx.fillRect(cx - halfW, top, halfW * 2, bot - top);
        }
        return;
      }

      // ---- FLAT trade-box mode: fill runs with the plot color as-is, label
      //      each run with its trade outcome, emphasize the selected trade. --
      if (zoneStyle.flatLabels) {
        const rgbF = rgbOf(color);
        for (const run of this._prim.runs) {
          const yU = series.priceToCoordinate(run.upper);
          const yL = series.priceToCoordinate(run.lower);
          if (yU === null || yL === null) continue;
          const top = Math.min(yU, yL) * vpr;
          const bot = Math.max(yU, yL) * vpr;
          const x1 = ts.timeToCoordinate(times[run.start] as Time);
          const x2 = ts.timeToCoordinate(times[run.end] as Time);
          if (x1 == null && x2 == null) continue;
          const left = (x1 ?? 0) * hpr - halfW;
          const right = (x2 != null ? x2 * hpr : scope.bitmapSize.width) + halfW;
          if (right < 0 || left > scope.bitmapSize.width) continue;
          const emphasized = zoneStyle.emphasisRunStart === run.start;
          ctx.fillStyle = color;
          ctx.fillRect(left, top, right - left, bot - top);
          if (emphasized) {
            ctx.fillRect(left, top, right - left, bot - top); // double the fill
            ctx.strokeStyle = `rgba(${rgbF},0.7)`;
            ctx.lineWidth = Math.max(1, vpr);
            ctx.strokeRect(left, top, right - left, bot - top);
          }
          const label = zoneStyle.flatLabels[run.start];
          if (label) {
            const fontPx = 9 * vpr;
            ctx.font = `500 ${fontPx}px Inter, ui-sans-serif, system-ui`;
            ctx.textBaseline = 'middle';
            const padX = 4 * hpr;
            const w = ctx.measureText(label).width + padX * 2;
            const h = 13 * vpr;
            const lx = Math.max(left, Math.min(right - w, scope.bitmapSize.width - w));
            const ly = top - h / 2 - 2 * vpr; // just above the box
            ctx.fillStyle = 'rgba(8,12,20,0.78)';
            ctx.fillRect(lx, ly - h / 2, w, h);
            ctx.fillStyle = `rgba(${rgbF},0.95)`;
            ctx.fillText(label, lx + padX, ly);
          }
        }
        return;
      }

      // ---- Zone mode: each run is a market OBJECT --------------------------
      // Border-defined rectangle (upper bound / dashed mid / lower bound) with
      // a soft glassy fill — never a painted block. Hierarchy: focus (nearest
      // decision zone) bright → active normal → historical dimmed.
      const runs = this._prim.runs;
      if (runs.length === 0) return;
      const rgb = rgbOf(color);
      const emphasis = zoneStyle.emphasis ?? 0.6;
      const isSubtle = zoneStyle.boundary == null; // target/context bands
      const dashed = zoneStyle.lineStyle === 'dashed';
      const anchors = zoneStyle.anchors ?? [];
      const lastRun = runs[runs.length - 1];

      const xOf = (i: number): number | null => {
        const x = ts.timeToCoordinate(times[i] as Time);
        return x == null ? null : x * hpr;
      };

      for (const run of runs) {
        const active = run === lastRun;
        const focus = active && zoneStyle.focus === true;
        const yU = series.priceToCoordinate(run.upper);
        const yL = series.priceToCoordinate(run.lower);
        if (yU === null || yL === null) continue;
        const top = Math.min(yU, yL) * vpr;
        const bot = Math.max(yU, yL) * vpr;
        if (bot - top < 1) continue;

        // Run x-extent; clamp to the pane when partially offscreen.
        let x1 = xOf(run.start);
        let x2 = xOf(run.end);
        if (x1 == null && x2 == null) {
          const first = ts.timeToCoordinate(times[Math.max(0, run.start)] as Time);
          const last = ts.timeToCoordinate(times[Math.min(times.length - 1, run.end)] as Time);
          if (first == null && last == null && !(run.start < 0)) continue;
        }
        if (x1 == null) x1 = 0;
        if (x2 == null) x2 = scope.bitmapSize.width;
        const left = x1 - halfW;
        const right = x2 + halfW;
        if (right < 0 || left > scope.bitmapSize.width) continue;

        const boundaryY = zoneStyle.boundary === 'lower' ? bot : top;
        const distalY = zoneStyle.boundary === 'lower' ? top : bot;

        // 1. Fill — flat and glassy, but BRIGHT across all runs: historical
        //    zones keep the same color at near-full strength so past signals
        //    can be analysed against the zones that produced them. Focus is
        //    only one step brighter, not the only visible zone.
        const fillAlpha = isSubtle
          ? (active ? 0.03 : 0.015)
          : focus ? 0.16 : active ? 0.12 : 0.10;
        ctx.fillStyle = `rgba(${rgb},${fillAlpha})`;
        ctx.fillRect(left, top, right - left, bot - top);

        // 2. Borders — upper + lower bounds, 1–2px, weight scales with strength.
        //    Historical borders stay clearly visible (same hue, one step down).
        if (!isSubtle) {
          const borderAlpha = focus ? 1.0 : active ? 0.75 : 0.55;
          const widthPx = Math.min(2, 1 + emphasis); // ★ weak 1px → ★★★★★ 2px
          ctx.strokeStyle = `rgba(${rgb},${borderAlpha})`;
          ctx.lineWidth = Math.max(1, widthPx * vpr);
          ctx.setLineDash(dashed ? [5 * hpr, 4 * hpr] : []);
          for (const ey of [top, bot]) {
            ctx.beginPath();
            ctx.moveTo(left, ey);
            ctx.lineTo(right, ey);
            ctx.stroke();
          }
          // 3. Dashed midline (zone anatomy) — active zones only, half-weight.
          if (zoneStyle.mid && active && bot - top > 8 * vpr) {
            const my = (top + bot) / 2;
            ctx.strokeStyle = `rgba(${rgb},${borderAlpha * 0.45})`;
            ctx.lineWidth = Math.max(1, vpr);
            ctx.setLineDash([3 * hpr, 3 * hpr]);
            ctx.beginPath();
            ctx.moveTo(left, my);
            ctx.lineTo(right, my);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }

        // 4. Label chip — solid bar at the FAR edge (away from price), inside the
        //    zone with clear padding; white text on a muted accent fill.
        if (active && zoneStyle.label) {
          const fontPx = 10 * vpr;
          ctx.font = `500 ${fontPx}px Inter, ui-sans-serif, system-ui`;
          ctx.textBaseline = 'middle';
          const text = zoneStyle.label;
          const padX = 6 * hpr;
          const w = ctx.measureText(text).width + padX * 2;
          const h = 16 * vpr;
          const lx = Math.min(right, scope.bitmapSize.width) - w - 8 * hpr;
          const inset = 4 * vpr + h / 2;
          const ly = distalY === top ? top + inset : bot - inset;
          ctx.fillStyle = `rgba(${rgb},${focus ? 0.9 : 0.55})`;
          ctx.fillRect(lx, ly - h / 2, w, h);
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.fillText(text, lx + padX, ly);
        }

        // 5. Signal-origin anchors — dot + tick on the price-facing boundary.
        if (!isSubtle && anchors.length > 0) {
          for (const a of anchors) {
            if (a < run.start || a > run.end + 1) continue; // +1: confirm bar can close just past the run
            const ax = xOf(Math.min(a, times.length - 1));
            if (ax == null) continue;
            ctx.fillStyle = `rgba(${rgb},0.95)`;
            ctx.beginPath();
            ctx.arc(ax, boundaryY, 3 * hpr, 0, Math.PI * 2);
            ctx.fill();
            const dir = zoneStyle.boundary === 'lower' ? 1 : -1;
            ctx.strokeStyle = `rgba(${rgb},0.6)`;
            ctx.lineWidth = Math.max(1, vpr);
            ctx.beginPath();
            ctx.moveTo(ax, boundaryY);
            ctx.lineTo(ax, boundaryY + dir * 8 * vpr);
            ctx.stroke();
          }
        }
      }
    });
  }
}

class BandPaneView implements IPrimitivePaneView {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: IndicatorBandPrimitive,
  ) {}
  zOrder(): 'bottom' { return 'bottom'; }
  renderer() { return new BandRenderer(this._api, this._prim); }
}

export class IndicatorBandPrimitive implements ISeriesPrimitive {
  public upper: (number | null)[] = [];
  public lower: (number | null)[] = [];
  public times: number[] = [];
  public color = 'rgba(120,120,120,0.10)';
  public visible = true;
  public zoneStyle: BandZoneStyle | undefined;
  /** Contiguous same-value zone runs, precomputed in setData. */
  public runs: ZoneRun[] = [];
  private _api: SeriesAttachedParameter<Time> | null = null;

  attached(api: SeriesAttachedParameter<Time>) {
    this._api = api;
  }
  detached() {
    this._api = null;
  }
  updateAllViews() {
    this._api?.requestUpdate();
  }
  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    return [new BandPaneView(this._api, this)];
  }

  setData(
    upper: (number | null)[],
    lower: (number | null)[],
    times: number[],
    color: string,
    visible = true,
    zoneStyle?: BandZoneStyle,
  ) {
    this.upper = upper;
    this.lower = lower;
    this.times = times;
    this.color = color;
    this.visible = visible;
    this.zoneStyle = zoneStyle;
    this.runs = zoneStyle ? computeRuns(upper, lower) : [];
    this.updateAllViews();
  }
}

/** Split per-bar band data into contiguous same-value runs (zone instances). */
export function computeRuns(
  upper: (number | null)[],
  lower: (number | null)[],
): ZoneRun[] {
  const runs: ZoneRun[] = [];
  let cur: ZoneRun | null = null;
  for (let i = 0; i < upper.length; i++) {
    const u = upper[i];
    const l = lower[i];
    if (u == null || l == null) {
      cur = null;
      continue;
    }
    if (cur && cur.upper === u && cur.lower === l) {
      cur.end = i;
    } else {
      cur = { start: i, end: i, upper: u, lower: l };
      runs.push(cur);
    }
  }
  return runs;
}
