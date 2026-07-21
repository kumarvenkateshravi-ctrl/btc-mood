import type { Candle } from './types';

export type SignalSide = 'buy' | 'sell' | 'neutral';

export interface IndicatorInputDef {
  id: string;
  name: string;
  type: 'number' | 'boolean' | 'select' | 'source';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
  group?: string; // e.g. "SMOOTHING"
  tooltip?: string;
  // `any`: input values are a heterogeneous user-config bag (number | string |
  // boolean per input type). Kept loose intentionally — see IndicatorSettings.inputs.
  disabledIf?: (inputs: Record<string, any>) => boolean;
}

export interface IndicatorStyleDef {
  id: string;
  name: string;
  color: string;
  thickness: 1 | 2 | 3 | 4;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  display: boolean;
  hasValue?: boolean;
  value?: number;
  isFill?: boolean;
  hideCheckbox?: boolean;
}

export interface IndicatorSettings {
  // Heterogeneous per-indicator config (number | string | boolean by input type).
  // Intentionally `any`: the settings modal binds these directly to number/select/
  // checkbox controls, so tightening here just forces casts at every input site.
  inputs: Record<string, any>;
  styles: Record<string, { color: string; thickness: number; lineStyle: string; display: boolean; value?: number }>;
  visibility: Record<string, boolean>; // e.g., 'minutes': true, 'hours': true
  labelsOnPriceScale?: boolean;
  valuesInStatusLine?: boolean;
}

/**
 * Premium zone styling for `band` plots (supply/demand zones). When present,
 * the band primitive renders boundary-first: an emphasized edge line facing
 * price, a gradient fill fading away from it, dimmed historical runs, an
 * on-zone label for the active run, and signal-origin anchor dots. When
 * absent, bands keep the legacy flat-fill rendering.
 */
export interface BandZoneStyle {
  /** Which edge faces price (signal side; anchors render here). Omit for
   *  subtle context bands (e.g. measured-move target zones): no borders,
   *  fainter fill. */
  boundary?: 'upper' | 'lower';
  /** Border dash style — differentiates timeframes (e.g. D solid, 4H dashed). */
  lineStyle?: 'solid' | 'dashed';
  /** Label chip for the ACTIVE (latest) zone run, e.g. "D Supply ★ 92". */
  label?: string;
  /** Strength 0..1 (zone score / 100) — drives border weight + label stars. */
  emphasis?: number;
  /** Draw a dashed midline through the zone (TradingView-style anatomy). */
  mid?: boolean;
  /** The nearest decision zone to current price — rendered bright; other
   *  active zones render normal; historical runs render dimmed. */
  focus?: boolean;
  /** Bar indices where a signal originated from this zone — the primitive
   *  draws an origin dot + tick on the boundary at each. */
  anchors?: number[];
  /** FLAT trade-box mode (R:R boxes): fill each run with the plot color as-is
   *  (no zone hierarchy) and draw the label mapped from the run's START bar
   *  index — e.g. a trade's outcome ("+512 pts"). */
  flatLabels?: Record<number, string>;
  /** Run (by start index) to emphasize — the trade selected in the panel. */
  emphasisRunStart?: number | null;
  /** Small price-tagged chips drawn at the run's left edge (flat mode):
   *  e.g. Entry/TP1/TP2 with distance-to-target in points. */
  priceTags?: Record<number, Array<{ price: number; text: string }>>;
}

export interface IndicatorPlot {
  id: string;
  title: string;
  color: string;
  type: 'line' | 'band' | 'histogram';
  // Arrays mapping 1-to-1 with candles.
  // For 'line', array of number | { value: number; color: string } | null.
  // For 'histogram', array of number | { value: number; color: string } | null.
  // For 'band', array of { upper: number; lower: number } | null.
  data: (number | { value: number; color: string } | { upper: number; lower: number } | null)[];
  lineWidth?: number;
  /**
   * Optional pane routing:
   *   - 'overlay' (default): same price scale as the candle chart
   *   - 'separate': dedicated pane below the candles (matches PineScript
   *     `overlay=false`)
   */
  pane?: 'overlay' | 'separate';
  /** Premium zone rendering for band plots (see BandZoneStyle). */
  zoneStyle?: BandZoneStyle;
  /**
   * When true, the band is drawn as a continuous polygon area (upper edge →
   * lower edge back) rather than per-bar filled rectangles. Use this for RSI
   * fill clouds, moving-average ribbon fills, etc. where the shape must
   * follow the line contour exactly without bar-width gaps.
   */
  areaFill?: boolean;
  /**
   * Two-tone area fill (requires `areaFill`). Colours the fill by which side of
   * the baseline the upper edge sits on — `above` where upper > lower, `below`
   * otherwise — and splits each segment at the EXACT interpolated crossing so
   * the two colours meet on the line with no gap or overlap (the RSI cloud).
   */
  areaFillColors?: { above: string; below: string };
  /**
   * Set false to suppress this plot's price-scale label + price line even
   * when the indicator's labelsOnPriceScale is on — for annotation-style
   * plots (e.g. SMC structure segments) that would otherwise stack pills
   * on the axis. Default: follow the indicator setting.
   */
  axisLabel?: boolean;
}

/** A horizontal reference line on the indicator's pane (PineScript `hline`). */
export interface IndicatorLevel {
  value: number;
  color: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  lineWidth?: number;
  title?: string;
}

/** A solid fill between two price levels on the pane (PineScript `fill` between hlines). */
export interface IndicatorFill {
  from: number;
  to: number;
  /** rgba color. */
  color: string;
}

/**
 * Gradient fill between a plot line and a baseline value, clipped to a value
 * band — PineScript `fill(plot, baselinePlot, topValue, bottomValue, topColor,
 * bottomColor)`. Used for the RSI overbought/oversold zones.
 */
export interface IndicatorGradientFill {
  /** Plot id whose per-bar values bound the fill (e.g. 'rsi'). */
  plotId: string;
  /** The other plot's constant value (e.g. the 50 mid-line). */
  baseline: number;
  /** Value band the gradient is mapped/clipped to. */
  top: number;
  bottom: number;
  /** rgba colour at `top` and at `bottom`. */
  topColor: string;
  bottomColor: string;
}

/** A label/marker on the indicator's pane (PineScript `plotshape`). */
export interface IndicatorMarker {
  /** Bar index the marker sits on. */
  index: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text?: string;
  /** Optional scalar payload for consumers (e.g. a signal's confidence score);
   *  render-agnostic — the chart ignores it. */
  value?: number;
}

/**
 * Per-bar candle color overrides injected directly into the CandlestickSeries.
 * Use for confluence highlights that need to color the body independently
 * from the wicks/borders.
 * `styleId` — the indicator style-panel entry whose user-chosen color should
 * override the default `color` values (e.g. 'confluenceCandle').
 */
export interface CandleColorOverride {
  /** Plot style ID to look up for body color in the indicator's style panel. */
  styleId?: string;
  /** Per-bar body fill color. null = keep default. */
  color: (string | null)[];
  /** Per-bar wick color. null = keep default. */
  wickColor: (string | null)[];
  /** Per-bar border color. null = keep default. */
  borderColor: (string | null)[];
}

export interface IndicatorResult {
  plots: IndicatorPlot[];
  // Buy/Sell/Neutral status per candle
  signals: SignalSide[];
  /** Horizontal reference lines (e.g. RSI 70 / 50 / 30). */
  levels?: IndicatorLevel[];
  /** Solid fills between two levels (e.g. the RSI 70↔30 channel). */
  fills?: IndicatorFill[];
  /** Gradient zone fills (e.g. RSI overbought / oversold). */
  gradientFills?: IndicatorGradientFill[];
  /** Pane labels/markers (e.g. divergence Bull/Bear). */
  markers?: IndicatorMarker[];
  /**
   * Per-bar candle series color overrides. When set, the chart merges these
   * colors into the CandlestickData before calling setData, letting indicators
   * color individual candle bodies/wicks without a separate overlay primitive.
   */
  candleColors?: CandleColorOverride;
}

export interface CustomIndicatorConfig {
  id: string;
  settings?: IndicatorSettings;
}

// Function signature that all PineScript translations will follow
export type IndicatorComputeFn = (
  candles: Candle[],
  config?: CustomIndicatorConfig,
  computedSources?: Record<string, (number | null)[]>,
) => IndicatorResult;
