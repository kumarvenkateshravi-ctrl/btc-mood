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

      // ---- Zone mode ------------------------------------------------------
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
          // Entirely offscreen — unless it spans the view (start left, end right).
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

        // 1. Fill — gradient fading away from the boundary; historical runs flat + faint.
        if (active && !isSubtle) {
          const grad = ctx.createLinearGradient(0, boundaryY, 0, distalY);
          grad.addColorStop(0, `rgba(${rgb},${0.05 + 0.10 * emphasis})`);
          grad.addColorStop(1, `rgba(${rgb},0.015)`);
          ctx.fillStyle = grad;
        } else if (active) {
          ctx.fillStyle = `rgba(${rgb},0.035)`; // active target band: whisper-quiet
        } else {
          ctx.fillStyle = `rgba(${rgb},${isSubtle ? 0.015 : 0.03})`; // history
        }
        ctx.fillRect(left, top, right - left, bot - top);

        // 2. Boundary line (entry zones only) — the visual spine of the zone.
        if (!isSubtle) {
          const alpha = active ? 0.35 + 0.55 * emphasis : 0.18;
          ctx.strokeStyle = `rgba(${rgb},${alpha})`;
          ctx.lineWidth = Math.max(1, (active ? 2 : 1) * vpr);
          ctx.setLineDash(dashed ? [5 * hpr, 4 * hpr] : []);
          ctx.beginPath();
          ctx.moveTo(left, boundaryY);
          ctx.lineTo(right, boundaryY);
          ctx.stroke();
          // Distal hairline closes the zone quietly (active only).
          if (active) {
            ctx.strokeStyle = `rgba(${rgb},0.15)`;
            ctx.lineWidth = Math.max(1, vpr);
            ctx.beginPath();
            ctx.moveTo(left, distalY);
            ctx.lineTo(right, distalY);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }

        // 3. Label — active run only, tucked against the boundary at the right end.
        if (active && zoneStyle.label) {
          const fontPx = 10 * vpr;
          ctx.font = `500 ${fontPx}px Inter, ui-sans-serif, system-ui`;
          ctx.textBaseline = 'middle';
          const text = zoneStyle.label;
          const padX = 5 * hpr;
          const w = ctx.measureText(text).width + padX * 2;
          const h = 15 * vpr;
          const lx = Math.min(right, scope.bitmapSize.width) - w - 6 * hpr;
          // Inside the zone, hugging the boundary edge.
          const inset = 3 * vpr + h / 2;
          const ly = zoneStyle.boundary === 'lower' ? bot - inset : top + inset;
          ctx.fillStyle = 'rgba(8,12,20,0.72)';
          ctx.fillRect(lx, ly - h / 2, w, h);
          ctx.fillStyle = `rgba(${rgb},0.95)`;
          ctx.fillText(text, lx + padX, ly);
        }

        // 4. Signal-origin anchors — dot + tick on the boundary at trigger bars.
        if (!isSubtle && anchors.length > 0) {
          for (const a of anchors) {
            if (a < run.start || a > run.end + 1) continue; // +1: confirm bar can close just past the run
            const ax = xOf(Math.min(a, times.length - 1));
            if (ax == null) continue;
            ctx.fillStyle = `rgba(${rgb},0.95)`;
            ctx.beginPath();
            ctx.arc(ax, boundaryY, 3 * hpr, 0, Math.PI * 2);
            ctx.fill();
            // Tick pointing out of the zone toward price.
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
