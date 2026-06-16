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
      const w = Math.round(ts.width() * scope.horizontalPixelRatio);

      for (const o of this._prim.overlays) {
        const y = series.priceToCoordinate(o.price);
        if (y === null) continue;
        const cy = Math.round(y * scope.verticalPixelRatio);
        
        ctx.strokeStyle = o.color || '#5aa2e6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();
        ctx.setLineDash([]);
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
