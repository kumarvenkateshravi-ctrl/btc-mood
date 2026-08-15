import {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { IndicatorLineSegment } from './indicatorFramework';

/** Draws Pine-style line.new segments directly in the candle pane. */
class LineRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly api: SeriesAttachedParameter<Time, 'Candlestick'>,
    private readonly primitive: IndicatorLinePrimitive,
  ) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    if (!this.primitive.visible) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const series = this.api.series;
      const timeScale = this.api.chart.timeScale();
      const width = timeScale.width() * hpr;

      for (const segment of this.primitive.segments) {
        const x1 = timeScale.timeToCoordinate(segment.startTime as Time);
        const x2 = segment.extendRight
          ? timeScale.width()
          : timeScale.timeToCoordinate(segment.endTime as Time);
        const y1 = series.priceToCoordinate(segment.startValue);
        const y2 = series.priceToCoordinate(segment.endValue);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;

        ctx.strokeStyle = segment.color;
        ctx.lineWidth = Math.max(1, (segment.lineWidth ?? 1) * vpr);
        ctx.setLineDash(segment.lineStyle === 'dashed'
          ? [6 * hpr, 4 * hpr]
          : segment.lineStyle === 'dotted'
            ? [2 * hpr, 3 * hpr]
            : []);
        ctx.beginPath();
        ctx.moveTo(x1 * hpr, y1 * vpr);
        ctx.lineTo(Math.min(width, x2 * hpr), y2 * vpr);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }
}

class LinePaneView implements IPrimitivePaneView {
  constructor(
    private readonly api: SeriesAttachedParameter<Time, 'Candlestick'>,
    private readonly primitive: IndicatorLinePrimitive,
  ) {}

  zOrder(): 'normal' { return 'normal'; }
  renderer() { return new LineRenderer(this.api, this.primitive); }
}

export class IndicatorLinePrimitive implements ISeriesPrimitive {
  segments: IndicatorLineSegment[] = [];
  visible = true;
  private api: SeriesAttachedParameter<Time, 'Candlestick'> | null = null;

  attached(api: SeriesAttachedParameter<Time, 'Candlestick'>) {
    this.api = api;
  }

  detached() {
    this.api = null;
  }

  updateAllViews() {
    this.api?.requestUpdate();
  }

  paneViews(): IPrimitivePaneView[] {
    return this.api ? [new LinePaneView(this.api, this)] : [];
  }

  setData(segments: IndicatorLineSegment[], visible = true) {
    this.segments = segments;
    this.visible = visible;
    this.updateAllViews();
  }
}
