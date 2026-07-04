import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

// Draws an indicator `band` plot: a per-bar filled rectangle spanning each
// candle's width between its { upper, lower } price pair. Used for
// supply/demand zones and any other indicator that emits `type: 'band'` plots.
// zOrder 'bottom' keeps the candles readable on top of the fill.
class BandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: IndicatorBandPrimitive,
  ) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const series = this._api.series;
      const ts = this._api.chart.timeScale();
      const barSpacing = ts.options().barSpacing ?? 6;
      // Half a bar-spacing each side → contiguous fill with no gaps between bars.
      const halfW = Math.max(0.5, (barSpacing * hpr) / 2);

      const { upper, lower, times, color } = this._prim;
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

  setData(upper: (number | null)[], lower: (number | null)[], times: number[], color: string) {
    this.upper = upper;
    this.lower = lower;
    this.times = times;
    this.color = color;
    this.updateAllViews();
  }
}
