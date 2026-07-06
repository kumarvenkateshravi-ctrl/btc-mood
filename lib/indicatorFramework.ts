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
