import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';

export interface FxBarRect {
  time: Time;
  x: number;
  w: number;
  y: number;
  h: number;
}

export class ChartFxRenderer implements IPrimitivePaneRenderer {
  draw() {}
}

export class ChartFxPrimitive implements ISeriesPrimitive {
  attached() {}
  detached() {}
  updateAllViews() {}
  paneViews(): IPrimitivePaneView[] { return []; }

  setOptions(opts: any) {}
}
