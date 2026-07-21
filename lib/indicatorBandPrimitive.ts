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
        if (this._prim.areaFill && this._prim.areaFillColors) {
          // ---- Two-tone area fill (RSI cloud) ------------------------------
          // Fill between `upper` (e.g. scaled RSI) and `lower` (baseline),
          // colouring each segment by side and splitting at the EXACT
          // interpolated crossing so the colours meet on the line — no notch.
          const { above, below } = this._prim.areaFillColors;
          const xOf = (t: number | null) => (t == null ? null : ts.timeToCoordinate(t as Time));

          const quad = (xa: number, ya0: number, ya1: number, xb: number, yb0: number, yb1: number, fill: string) => {
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.moveTo(xa, ya0 * vpr);
            ctx.lineTo(xb, yb0 * vpr);
            ctx.lineTo(xb, yb1 * vpr);
            ctx.lineTo(xa, ya1 * vpr);
            ctx.closePath();
            ctx.fill();
          };

          for (let i = 0; i < upper.length - 1; i++) {
            const u0 = upper[i]; const l0 = lower[i];
            const u1 = upper[i + 1]; const l1 = lower[i + 1];
            if (u0 == null || l0 == null || u1 == null || l1 == null) continue;
            const x0raw = xOf(times[i]); const x1raw = xOf(times[i + 1]);
            if (x0raw == null || x1raw == null) continue;
            const x0 = x0raw * hpr; const x1 = x1raw * hpr;
            const yU0 = series.priceToCoordinate(u0); const yL0 = series.priceToCoordinate(l0);
            const yU1 = series.priceToCoordinate(u1); const yL1 = series.priceToCoordinate(l1);
            if (yU0 == null || yL0 == null || yU1 == null || yL1 == null) continue;

            const d0 = u0 - l0; const d1 = u1 - l1; // signed distance in price space
            if ((d0 >= 0 && d1 >= 0) || (d0 <= 0 && d1 <= 0)) {
              // No crossing — one colour for the whole segment.
              quad(x0, yU0, yL0, x1, yU1, yL1, (d0 || d1) >= 0 ? above : below);
            } else {
              // Crossing: interpolate where upper == lower.
              const f = d0 / (d0 - d1);
              const xc = x0 + f * (x1 - x0);
              const yc = series.priceToCoordinate(l0 + f * (l1 - l0)); // == upper at crossing
              if (yc == null) { quad(x0, yU0, yL0, x1, yU1, yL1, d0 >= 0 ? above : below); continue; }
              quad(x0, yU0, yL0, xc, yc, yc, d0 >= 0 ? above : below);
              quad(xc, yc, yc, x1, yU1, yL1, d1 >= 0 ? above : below);
            }
          }
          return;
        }
        if (this._prim.areaFill) {
          // ---- Continuous polygon area fill --------------------------------
          // Draws a closed path: forward along upper, backward along lower,
          // then back to start. Handles gaps (null entries) by breaking the
          // path into separate polygons so the fill hugs the RSI line exactly.
          ctx.fillStyle = color;
          const upperPts: { x: number; yU: number; yL: number }[] = [];

          const flush = () => {
            if (upperPts.length < 2) { upperPts.length = 0; return; }
            ctx.beginPath();
            ctx.moveTo(upperPts[0].x, upperPts[0].yU * vpr);
            for (let k = 1; k < upperPts.length; k++)
              ctx.lineTo(upperPts[k].x, upperPts[k].yU * vpr);
            for (let k = upperPts.length - 1; k >= 0; k--)
              ctx.lineTo(upperPts[k].x, upperPts[k].yL * vpr);
            ctx.closePath();
            ctx.fill();
            upperPts.length = 0;
          };

          for (let i = 0; i < upper.length; i++) {
            const u = upper[i];
            const l = lower[i];
            if (u == null || l == null) { flush(); continue; }
            const t = times[i];
            if (t == null) { flush(); continue; }
            const x = ts.timeToCoordinate(t as Time);
            if (x == null) { flush(); continue; }
            const yU = series.priceToCoordinate(u);
            const yL = series.priceToCoordinate(l);
            if (yU === null || yL === null) { flush(); continue; }
            upperPts.push({ x: x * hpr, yU, yL });
          }
          flush();
          return;
        }
        // ---- Legacy flat fill (per-bar rectangles) ---------------------------
        ctx.fillStyle = color;
        for (let i = 0; i < upper.length; i++) {
          const u = upper[i];
          const l = lower[i];
          if (u == null || l == null) continue;
          const t = times[i];
          if (t == null) continue;
          const x = ts.timeToCoordinate(t as Time);
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
          const chip = (text: string, cx: number, cy: number, textRgb: string) => {
            const fontPx = 9 * vpr;
            ctx.font = `500 ${fontPx}px Inter, ui-sans-serif, system-ui`;
            ctx.textBaseline = 'middle';
            const padX = 4 * hpr;
            const w = ctx.measureText(text).width + padX * 2;
            const h = 13 * vpr;
            const lx = Math.max(0, Math.min(cx, scope.bitmapSize.width - w));
            ctx.fillStyle = 'rgba(8,12,20,0.78)';
            ctx.fillRect(lx, cy - h / 2, w, h);
            ctx.fillStyle = `rgba(${textRgb},0.95)`;
            ctx.fillText(text, lx + padX, cy);
            return w;
          };
          const label = zoneStyle.flatLabels[run.start];
          if (label) {
            const fontPx = 9 * vpr;
            ctx.font = `500 ${fontPx}px Inter, ui-sans-serif, system-ui`;
            const w = ctx.measureText(label).width + 8 * hpr;
            chip(label, right - w, top - 8.5 * vpr, rgbF); // outcome, above the box's right end
          }
          // Entry/TP price tags at the trade's start (left edge), each at its own price.
          const tags = zoneStyle.priceTags?.[run.start];
          if (tags) {
            for (const tag of tags) {
              const ty = series.priceToCoordinate(tag.price);
              if (ty === null) continue;
              chip(tag.text, left + 2 * hpr, ty * vpr, '210,220,235');
            }
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
  public times: (number | null)[] = [];
  public color = 'rgba(120,120,120,0.10)';
  public visible = true;
  public areaFill = false;
  public areaFillColors: { above: string; below: string } | undefined;
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
    times: (number | null)[],
    color: string,
    visible = true,
    zoneStyle?: BandZoneStyle,
    areaFill = false,
    areaFillColors?: { above: string; below: string },
  ) {
    this.upper = upper;
    this.lower = lower;
    this.times = times;
    this.color = color;
    this.visible = visible;
    this.areaFill = areaFill;
    this.areaFillColors = areaFillColors;
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
