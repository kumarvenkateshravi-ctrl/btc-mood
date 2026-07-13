// D Smart Line — chart overlay (plan: docs/superpowers/plans/2026-07-12-dsmart-line.md).
//
// Renders the adaptive cloud from lib/indicators/dsmartLine.ts: Walking +
// Running lines, bull/bear cloud fills, and the three signal families
// (continuation arrows, P pullbacks, exhaustion stars). Because the chart
// pipeline feeds bricks in as Candle[] when the chart type is Renko, the same
// overlay is brick-native there with zero extra plumbing.

import type { Candle } from '../types';
import type {
  CustomIndicatorConfig,
  IndicatorMarker,
  IndicatorPlot,
  IndicatorResult,
  SignalSide,
} from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';
import { computeDsmart, DSMART_DEFAULTS, type DsmartConfig, type DsmartResult } from './dsmartLine';

interface DsmartOverlayInputs {
  mode: 'cloud' | 'single';
  showArrows: boolean;
  showPullbacks: boolean;
  showStars: boolean;
  donchianLen: number;
  dispLen: number;
  /** Disparity trigger in percent (UI-friendly; engine wants a fraction). */
  dispThresholdPct: number;
  maxPullbackLen: number;
}

const DEFAULTS: DsmartOverlayInputs = {
  mode: 'cloud',
  showArrows: true,
  showPullbacks: true,
  showStars: true,
  donchianLen: DSMART_DEFAULTS.donchianLen,
  dispLen: DSMART_DEFAULTS.dispLen,
  dispThresholdPct: DSMART_DEFAULTS.dispThreshold * 100,
  maxPullbackLen: DSMART_DEFAULTS.maxPullbackLen,
};

const GREEN = '#22c55e';
const RED = '#ef4444';
const GREEN_FILL = 'rgba(34,197,94,0.55)';
const RED_FILL = 'rgba(239,68,68,0.55)';
const YELLOW = '#f5b93e';

// Closed-bar result cache (tick-perf rule): recompute only when a bar closes
// or the config changes; intra-bar ticks reuse the snapshot.
let cache: { key: string; result: DsmartResult } | null = null;

function getResult(candles: Candle[], cfg: DsmartConfig): DsmartResult {
  const last = candles[candles.length - 1];
  // Fingerprint the ARRAY, not just its shape: raw and Heikin Ashi candles
  // share length + last-bar time but differ in values, and the key must stay
  // stable within a bar (the whole point of the closed-bar cache) — so use
  // the last CLOSED bar's close + the first bar's open.
  const closed = candles.length > 1 ? candles[candles.length - 2].close : 0;
  const key = `${candles.length}:${last ? last.time : 0}:${candles[0]?.open ?? 0}:${closed}:${cfg.donchianLen}:${cfg.dispLen}:${cfg.dispThreshold}:${cfg.maxPullbackLen}`;
  if (cache && cache.key === key) return cache.result;
  const result = computeDsmart(candles, cfg);
  cache = { key, result };
  return result;
}

export function computeDsmartOverlay(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inputs = resolveInputs<DsmartOverlayInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const cfg: DsmartConfig = {
    ...DSMART_DEFAULTS,
    donchianLen: inputs.donchianLen,
    dispLen: inputs.dispLen,
    dispThreshold: inputs.dispThresholdPct / 100,
    maxPullbackLen: inputs.maxPullbackLen,
  };
  const r = getResult(candles, cfg);

  const plots: IndicatorPlot[] = [];

  // Walking Line — regime-colored, the stop-loss line. Primary plot (axis label).
  const walkData: IndicatorPlot['data'] = r.walk.map((v, i) =>
    v == null ? null : { value: v, color: r.regime[i] === -1 ? RED : GREEN },
  );
  plots.push({
    id: 'dsmart_walk',
    title: 'Walking',
    color: GREEN,
    type: 'line',
    lineWidth: 2,
    data: walkData,
  });

  if (inputs.mode === 'cloud') {
    // Running Line — thinner, hugs price.
    const runData: IndicatorPlot['data'] = r.run.map((v, i) =>
      v == null ? null : { value: v, color: r.regime[i] === -1 ? RED : GREEN },
    );
    plots.push({
      id: 'dsmart_run',
      title: 'Running',
      color: GREEN,
      type: 'line',
      lineWidth: 1,
      data: runData,
      axisLabel: false,
    });

    // Cloud fills, split by regime so the color flips with the trend.
    // In a bullish regime Running >= Walking (engine clamp), so the band is
    // [walk, run]; mirrored when bearish.
    const bull: IndicatorPlot['data'] = new Array(n).fill(null);
    const bear: IndicatorPlot['data'] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const w = r.walk[i];
      const ru = r.run[i];
      if (w == null || ru == null) continue;
      if (r.regime[i] === 1) bull[i] = { upper: ru, lower: w };
      else if (r.regime[i] === -1) bear[i] = { upper: w, lower: ru };
    }
    plots.push({
      id: 'dsmart_cloud_bull',
      title: 'D Smart Cloud',
      color: GREEN_FILL,
      type: 'band',
      data: bull,
      zoneStyle: { boundary: 'upper', emphasis: 0.5 },
      axisLabel: false,
    });
    plots.push({
      id: 'dsmart_cloud_bear',
      title: 'D Smart Cloud',
      color: RED_FILL,
      type: 'band',
      data: bear,
      zoneStyle: { boundary: 'lower', emphasis: 0.5 },
      axisLabel: false,
    });
  }

  // ---- signal markers ---------------------------------------------------------
  const markers: IndicatorMarker[] = [];
  for (const e of r.events) {
    if (e.barIndex < 0 || e.barIndex >= n) continue;
    const bullish = e.direction === 'bullish';
    if (e.type === 'arrow' && inputs.showArrows) {
      markers.push({
        index: e.barIndex,
        position: bullish ? 'belowBar' : 'aboveBar',
        color: bullish ? GREEN : RED,
        shape: bullish ? 'arrowUp' : 'arrowDown',
      });
    } else if (e.type === 'pullback' && inputs.showPullbacks) {
      // Article: P prints on the pullback brick, trend side.
      markers.push({
        index: e.barIndex,
        position: bullish ? 'belowBar' : 'aboveBar',
        color: bullish ? GREEN : RED,
        shape: 'circle',
        text: 'P',
      });
    } else if (e.type === 'star' && inputs.showStars) {
      // Star sits on the exhaustion side: above the brick when an uptrend
      // looks stretched (bearish warning), below when a downtrend does.
      markers.push({
        index: e.barIndex,
        position: e.direction === 'bearish' ? 'aboveBar' : 'belowBar',
        color: YELLOW,
        shape: 'circle',
        text: '★',
      });
    }
  }

  return { plots, signals, markers };
}
