// Fair value gap engine — faithful to the LuxAlgo same-timeframe path of
// drawFairValueGaps (SDD.md:634-649) and the delete rule (SDD.md:625-630).
// v1 supports the chart timeframe only (no request.security MTF).
//
// Bullish: low[i] > high[i-2] && close[i-1] > high[i-2] && delta% > threshold
// Bearish: high[i] < low[i-2] && close[i-1] < low[i-2] && -delta% > threshold
// where delta% = (close[i-1] - open[i-1]) / (open[i-1] * 100) and the auto
// threshold is 2 × cumulative mean |delta%|.
//
// Intelligence on top: partial-fill tracking. `touches` stores the worst fill
// percent (0-100) reached so far; a full cross of the far edge mitigates.

import type { Candle } from '@/lib/types';
import {
  type SmcConfig,
  type SmcEvent,
  type SmcObject,
  smcObjectId,
} from './types';

export interface FvgEngine {
  gaps: SmcObject[];
  onBar(i: number): void;
}

export function createFvgEngine(candles: Candle[], cfg: SmcConfig, events: SmcEvent[]): FvgEngine {
  const gaps: SmcObject[] = [];
  let cumAbsDelta = 0;

  function pushEvent(type: SmcEvent['type'], i: number, gap: SmcObject): void {
    events.push({
      id: `${type}_${i}_${gap.id}`,
      type,
      barIndex: i,
      time: candles[i].time,
      direction: gap.direction,
      objectId: gap.id,
      price: gap.direction === 'bullish' ? gap.bottom : gap.top,
    });
  }

  function detect(i: number): void {
    if (i < 2) return;
    const prev = candles[i - 1];
    const barDeltaPercent = (prev.close - prev.open) / (prev.open * 100);
    cumAbsDelta += Math.abs(barDeltaPercent);
    // Pine: ta.cum(...) / bar_index * 2 (bar_index = i, the script's own off-by-one).
    const threshold = cfg.fvgAutoThreshold ? (cumAbsDelta / i) * 2 : 0;

    const c = candles[i];
    const twoBack = candles[i - 2];

    if (c.low > twoBack.high && prev.close > twoBack.high && barDeltaPercent > threshold) {
      const gap: SmcObject = {
        id: smcObjectId('fvg', undefined, 'bullish', i),
        kind: 'fvg',
        direction: 'bullish',
        top: c.low,
        bottom: twoBack.high,
        createdAtBar: i,
        createdAtTime: c.time,
        updatedAtBar: i,
        state: 'active',
        touches: 0,
        strength: 0,
        quality: 0,
        confidence: 0,
      };
      gaps.unshift(gap);
      pushEvent('FVG_CREATED', i, gap);
    }
    if (c.high < twoBack.low && prev.close < twoBack.low && -barDeltaPercent > threshold) {
      const gap: SmcObject = {
        id: smcObjectId('fvg', undefined, 'bearish', i),
        kind: 'fvg',
        direction: 'bearish',
        top: twoBack.low,
        bottom: c.high,
        createdAtBar: i,
        createdAtTime: c.time,
        updatedAtBar: i,
        state: 'active',
        touches: 0,
        strength: 0,
        quality: 0,
        confidence: 0,
      };
      gaps.unshift(gap);
      pushEvent('FVG_CREATED', i, gap);
    }
  }

  function updateFills(i: number): void {
    const c = candles[i];
    for (const gap of gaps) {
      if (gap.state === 'mitigated' || gap.state === 'archived') continue;
      if (i <= gap.createdAtBar) continue;

      // Faithful delete rule: full cross of the far edge (SDD.md:627).
      const filled = gap.direction === 'bullish' ? c.low < gap.bottom : c.high > gap.top;
      if (filled) {
        gap.touches = 100;
        gap.state = 'mitigated';
        gap.updatedAtBar = i;
        pushEvent('FVG_FILLED', i, gap);
        continue;
      }

      if (i - gap.createdAtBar > cfg.maxAgeBars) {
        gap.state = 'archived';
        gap.updatedAtBar = i;
        continue;
      }

      // Intelligence: worst partial fill percent.
      const size = gap.top - gap.bottom;
      if (size <= 0) continue;
      const penetration =
        gap.direction === 'bullish'
          ? c.low < gap.top ? (gap.top - Math.max(c.low, gap.bottom)) / size : 0
          : c.high > gap.bottom ? (Math.min(c.high, gap.top) - gap.bottom) / size : 0;
      if (penetration > 0) {
        const pct = Math.min(100, Math.round(penetration * 100));
        if (pct > gap.touches) gap.touches = pct;
        if (gap.state === 'active') gap.state = 'partial';
        gap.updatedAtBar = i;
      }
    }
  }

  function onBar(i: number): void {
    detect(i);
    updateFills(i);
  }

  return { gaps, onBar };
}
