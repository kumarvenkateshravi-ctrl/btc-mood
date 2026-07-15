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
          o.color || (o.kind === 'tp' ? '#22d39a' : o.kind === 'sl' ? '#fb5168' : (opts.side === 'sell' ? '#fb5168' : '#2A62FF'));

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(1, vpr);
        // Entry (the live position) is a solid line; TP/SL stay dashed.
        if (o.kind !== 'entry') ctx.setLineDash([5 * hpr, 5 * hpr]);
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
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, boxX + padX, cy);

        // Right-aligned `[qty][±USD][✕]` pill (TV-style), left of the price axis
        // with a clear gap. The qty sits on a solid line-colour block; the P&L
        // block is dark with green (profit) / red (loss) text.
        // The entry line's pill is rendered in the DOM TradeOverlay row; only
        // the TP/SL pills are drawn here (they live at their own y-coordinates).
        const badge = o.kind === 'entry' ? undefined : (opts.badges ?? []).find((b) => b.kind === o.kind);
        if (badge) {
          const qtyStr = `${badge.qty}`;
          const pnlStr = badge.pnl == null ? null :
            `${badge.pnl >= 0 ? '+' : '−'}${Math.abs(badge.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
          const pnlColor = badge.pnl == null || badge.pnl >= 0 ? '#22d39a' : '#fb5168';
          const xStr = '✕';

          const qtyW = ctx.measureText(qtyStr).width + padX * 2;
          const pnlW = pnlStr ? ctx.measureText(pnlStr).width + padX * 2 : 0;
          const xW = ctx.measureText(xStr).width + padX * 2;
          const bW = qtyW + pnlW + xW;
          const bX = w - bW - 70 * hpr; // gap from the price axis

          // qty block — solid line colour, white text
          ctx.fillStyle = lineColor;
          ctx.fillRect(bX, boxY, qtyW, boxH);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(qtyStr, bX + padX, cy);

          // P&L + ✕ block — dark fill
          ctx.fillStyle = 'rgba(10, 14, 22, 0.95)';
          ctx.fillRect(bX + qtyW, boxY, pnlW + xW, boxH);
          if (pnlStr) {
            ctx.fillStyle = pnlColor;
            ctx.fillText(pnlStr, bX + qtyW + padX, cy);
            ctx.strokeStyle = 'rgba(154, 178, 215, 0.25)';
            ctx.lineWidth = Math.max(1, vpr);
            ctx.beginPath();
            ctx.moveTo(bX + qtyW + pnlW, boxY + 3 * vpr);
            ctx.lineTo(bX + qtyW + pnlW, boxY + boxH - 3 * vpr);
            ctx.stroke();
          }
          ctx.fillStyle = lineColor;
          ctx.fillText(xStr, bX + qtyW + pnlW + padX, cy);

          // outer border
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = Math.max(1, vpr);
          ctx.strokeRect(bX, boxY, bW, boxH);

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
