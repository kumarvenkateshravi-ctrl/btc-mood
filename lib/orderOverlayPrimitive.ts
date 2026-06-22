import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { ChartOverlay, OverlayKind } from '@/components/Chart';

class OrderRenderer implements IPrimitivePaneRenderer {
  constructor(private _api: SeriesAttachedParameter<Time, 'Candlestick'>, private _prim: OrderOverlayPrimitive) {}

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const series = this._api.series;
      const ts = this._api.chart.timeScale();
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const w = Math.round(ts.width() * hpr);
      const opts = this._prim.options || {};

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
  public options: any = {};
  public overlays: ChartOverlay[] = [];
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

  customHitTest(x: number, y: number): { kind: OverlayKind; draggable: boolean; price: number } | null {
    if (!this._api) return null;
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
