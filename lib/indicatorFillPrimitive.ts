import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { IndicatorFill } from '@/lib/indicatorFramework';

// Draws solid horizontal band fills between two price levels across the pane —
// e.g. the RSI 70↔30 channel. Mirrors the PineScript `fill(hline, hline, ...)`.
class FillRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: IndicatorFillPrimitive,
  ) {}

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const series = this._api.series;
      const ts = this._api.chart.timeScale();
      const w = Math.round(ts.width() * scope.horizontalPixelRatio);

      for (const f of this._prim.fills) {
        const yA = series.priceToCoordinate(f.from);
        const yB = series.priceToCoordinate(f.to);
        if (yA === null || yB === null) continue;
        const top = Math.round(Math.min(yA, yB) * scope.verticalPixelRatio);
        const bottom = Math.round(Math.max(yA, yB) * scope.verticalPixelRatio);
        ctx.fillStyle = f.color;
        ctx.fillRect(0, top, w, bottom - top);
      }
    });
  }
}

class FillPaneView implements IPrimitivePaneView {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: IndicatorFillPrimitive,
  ) {}
  // Behind the line/series.
  zOrder(): 'bottom' { return 'bottom'; }
  renderer() { return new FillRenderer(this._api, this._prim); }
}

export class IndicatorFillPrimitive implements ISeriesPrimitive {
  private _api: SeriesAttachedParameter<Time> | null = null;
  constructor(public fills: IndicatorFill[]) {}

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
    return [new FillPaneView(this._api, this)];
  }
}
