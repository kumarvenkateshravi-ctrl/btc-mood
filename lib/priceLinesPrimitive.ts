import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

export interface PriceLineItem {
  id: string;
  price: number;
  color: string;
  title: string;
}

class PriceLinesRenderer implements IPrimitivePaneRenderer {
  constructor(private _api: SeriesAttachedParameter<Time, 'Candlestick'>, private _prim: PriceLinesPrimitive) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const series = this._api.series;
      const ts = this._api.chart.timeScale();
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const w = Math.round(ts.width() * hpr);

      for (const line of this._prim.lines) {
        const y = series.priceToCoordinate(line.price);
        if (y === null) continue;
        const cy = Math.round(y * vpr);

        const lineColor = line.color;

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(1, vpr);
        ctx.setLineDash([5 * hpr, 5 * hpr]);
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        const text = line.title;
        const fontPx = 11 * vpr;
        ctx.font = `${fontPx}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        
        const padX = 6 * hpr;
        const textWidth = ctx.measureText(text).width;
        const boxW = textWidth + padX * 2;
        const boxH = 16 * vpr;
        
        // Draw label on the right side, just inside the chart
        const boxX = w - boxW - (4 * hpr);
        const boxY = cy - boxH / 2;

        ctx.fillStyle = lineColor;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = '#0a0e16';
        ctx.fillText(text, boxX + padX, cy);
      }
    });
  }
}

class PriceLinesPaneView implements IPrimitivePaneView {
  constructor(private _api: SeriesAttachedParameter<Time, 'Candlestick'>, private _prim: PriceLinesPrimitive) {}
  zOrder(): 'normal' { return 'normal'; }
  renderer() { return new PriceLinesRenderer(this._api, this._prim); }
}

export class PriceLinesPrimitive implements ISeriesPrimitive {
  public lines: PriceLineItem[] = [];
  private _api: SeriesAttachedParameter<Time, 'Candlestick'> | null = null;
  private _draggingId: string | null = null;

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
    return [new PriceLinesPaneView(this._api, this)];
  }

  setLines(lines: PriceLineItem[]) {
    this.lines = lines;
    this.updateAllViews();
  }

  setDragging(id: string | null) {
    this._draggingId = id;
  }

  customHitTest(x: number, y: number): { id: string; price: number } | null {
    if (!this._api) return null;
    const series = this._api.series;
    for (const line of this.lines) {
      const py = series.priceToCoordinate(line.price);
      if (py !== null && Math.abs(y - py) < 15) {
        return { id: line.id, price: line.price };
      }
    }
    return null;
  }
}
