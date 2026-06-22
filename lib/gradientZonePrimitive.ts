import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { IndicatorGradientFill } from '@/lib/indicatorFramework';

// Per-bar vertical-gradient fill between a plot line and a baseline, clipped to
// a value band — PineScript `fill(plot, baseline, top, bottom, topColor,
// bottomColor)`. Used for the RSI overbought/oversold zones.
class ZoneRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: GradientZonePrimitive,
  ) {}

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const series = this._api.series;
      const ts = this._api.chart.timeScale();
      const barSpacing = (ts.options() as any).barSpacing ?? 6;
      const halfW = Math.max(1, (barSpacing * hpr) / 2);

      const { values, times, zones } = this._prim;

      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v == null) continue;
        const x = ts.timeToCoordinate(times[i] as Time);
        if (x == null) continue;
        const cx = x * hpr;

        for (const z of zones) {
          // Overlap of [min(v,baseline), max(v,baseline)] with the band [bottom, top].
          const lo = Math.max(Math.min(v, z.baseline), z.bottom);
          const hi = Math.min(Math.max(v, z.baseline), z.top);
          if (hi <= lo) continue;

          const yTop = series.priceToCoordinate(z.top);
          const yBot = series.priceToCoordinate(z.bottom);
          const yHiC = series.priceToCoordinate(hi);
          const yLoC = series.priceToCoordinate(lo);
          if (yTop === null || yBot === null || yHiC === null || yLoC === null) continue;

          // Gradient anchored across the full band so the sub-rect samples
          // the correct colours (topColor at `top`, bottomColor at `bottom`).
          const grad = ctx.createLinearGradient(0, yTop * vpr, 0, yBot * vpr);
          grad.addColorStop(0, z.topColor);
          grad.addColorStop(1, z.bottomColor);
          ctx.fillStyle = grad;
          const yHi = yHiC * vpr;
          const yLo = yLoC * vpr;
          ctx.fillRect(cx - halfW, yHi, halfW * 2, yLo - yHi);
        }
      }
    });
  }
}

class ZonePaneView implements IPrimitivePaneView {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: GradientZonePrimitive,
  ) {}
  zOrder(): 'bottom' { return 'bottom'; }
  renderer() { return new ZoneRenderer(this._api, this._prim); }
}

export class GradientZonePrimitive implements ISeriesPrimitive {
  public values: (number | null)[] = [];
  public times: number[] = [];
  public zones: IndicatorGradientFill[] = [];
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
    return [new ZonePaneView(this._api, this)];
  }

  setData(values: (number | null)[], times: number[], zones: IndicatorGradientFill[]) {
    this.values = values;
    this.times = times;
    this.zones = zones;
    this.updateAllViews();
  }
}
