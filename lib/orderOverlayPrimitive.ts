import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { ChartOverlay, OverlayKind } from '@/components/Chart';

/** Overlay chrome options, set per-render by the Chart host (see Chart.tsx). */
export interface OrderOverlayOptions {
  side?: 'buy' | 'sell' | null;
  unitsLabel?: string;
  typeLabel?: string;
  hasTp?: boolean;
  hasSl?: boolean;
  tpPrice?: number | null;
  slPrice?: number | null;
  entryPrice?: number | null;
  pnl?: number | null;
  badges?: OverlayLineBadge[];
}

/** Right-side `qty | ±USD | ✕` pill drawn on one overlay line. */
export interface OverlayLineBadge {
  kind: OverlayKind;
  qty: string; // '10'
  pnl: number | null; // projected (tp/sl) or live (entry); null = hide
}

class OrderRenderer implements IPrimitivePaneRenderer {
  constructor(private _api: SeriesAttachedParameter<Time, 'Candlestick'>, private _prim: OrderOverlayPrimitive) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const series = this._api.series;
      const ts = this._api.chart.timeScale();
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const w = Math.round(ts.width() * hpr);
      const opts = this._prim.options || {};
      this._prim.badgeRects.clear();

      for (const o of this._prim.overlays) {
        const y = series.priceToCoordinate(o.price);
        if (y === null) continue;
        const cy = Math.round(y * vpr);

        const lineColor =
          o.color || (o.kind === 'tp' ? '#22d39a' : o.kind === 'sl' ? '#fb5168' : '#5aa2e6');

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(1, vpr);
        ctx.setLineDash([5 * hpr, 5 * hpr]);
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label the line (updates live as the line is dragged).
        let text: string;
        if (o.kind === 'entry') {
          const side = opts.side ? String(opts.side).toUpperCase() : 'ENTRY';
          const units = opts.unitsLabel && opts.unitsLabel !== '—' ? `${opts.unitsLabel} ` : '';
          text = `${side} ${units}@ ${o.price.toFixed(1)}`;
        } else if (o.kind === 'tp') {
          text = `TP ${o.price.toFixed(1)}`;
        } else {
          text = `SL ${o.price.toFixed(1)}`;
        }

        const fontPx = 11 * vpr;
        ctx.font = `${fontPx}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        const padX = 6 * hpr;
        const boxW = ctx.measureText(text).width + padX * 2;
        const boxH = 16 * vpr;
        const boxX = 4 * hpr;
        const boxY = cy - boxH / 2;

        ctx.fillStyle = lineColor;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = '#0a0e16';
        ctx.fillText(text, boxX + padX, cy);

        // Right-aligned `qty | ±USD | ✕` pill (TV-style).
        const badge = (opts.badges ?? []).find((b) => b.kind === o.kind);
        if (badge) {
          const pnlTxt = badge.pnl == null ? '' :
            ` | ${badge.pnl >= 0 ? '+' : '−'}${Math.abs(badge.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
          const btxt = `${badge.qty}${pnlTxt} | ✕`;
          const bW = ctx.measureText(btxt).width + padX * 2;
          const bX = w - bW - 8 * hpr;
          ctx.fillStyle = 'rgba(10, 14, 22, 0.9)';
          ctx.fillRect(bX, boxY, bW, boxH);
          ctx.strokeStyle = lineColor;
          ctx.strokeRect(bX, boxY, bW, boxH);
          ctx.fillStyle = lineColor;
          ctx.fillText(btxt, bX + padX, cy);
          this._prim.badgeRects.set(o.kind, { x: bX / hpr, y: boxY / vpr, w: bW / hpr, h: boxH / vpr });
        }
      }
    });
  }
}

class OrderPaneView implements IPrimitivePaneView {
  constructor(private _api: SeriesAttachedParameter<Time, 'Candlestick'>, private _prim: OrderOverlayPrimitive) {}
  zOrder(): 'normal' { return 'normal'; }
  renderer() { return new OrderRenderer(this._api, this._prim); }
}

export class OrderOverlayPrimitive implements ISeriesPrimitive {
  public options: OrderOverlayOptions = {};
  public overlays: ChartOverlay[] = [];
  /** CSS-pixel rects of the last-drawn `qty | ±USD | ✕` badges, keyed by line
   *  kind. Populated at the start of each draw pass; used by customHitTest to
   *  route ✕ clicks (see useChartEvents.ts). */
  public badgeRects: Map<OverlayKind, { x: number; y: number; w: number; h: number }> = new Map();
  private _api: SeriesAttachedParameter<Time, 'Candlestick'> | null = null;
  private _dragging: OverlayKind | null = null;

  attached(api: SeriesAttachedParameter<Time, 'Candlestick'>) {
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
    return [new OrderPaneView(this._api, this)];
  }

  setOverlays(overlays: ChartOverlay[]) {
    this.overlays = overlays;
    this.updateAllViews();
  }

  setDragging(kind: OverlayKind | null) {
    this._dragging = kind;
  }

  customHitTest(
    x: number,
    y: number,
  ):
    | { kind: OverlayKind; draggable: boolean; price: number; action?: undefined }
    | { kind: OverlayKind; action: 'cancel'; draggable?: undefined; price?: undefined }
    | null {
    if (!this._api) return null;

    // Badge ✕ hotspot: the last ~18px of the badge box. Checked first since
    // badges float above (and to the right of) their line's drag hotspot.
    for (const [kind, rect] of this.badgeRects) {
      if (
        x >= rect.x + rect.w - 18 &&
        x <= rect.x + rect.w &&
        y >= rect.y &&
        y <= rect.y + rect.h
      ) {
        return { kind, action: 'cancel' };
      }
    }

    const series = this._api.series;
    for (const o of this.overlays) {
      if (!o.draggable) continue;
      const py = series.priceToCoordinate(o.price);
      if (py !== null && Math.abs(y - py) < 15) {
        return { kind: o.kind, draggable: true, price: o.price };
      }
    }
    return null;
  }
}
