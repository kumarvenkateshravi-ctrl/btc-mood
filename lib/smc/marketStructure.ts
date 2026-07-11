// Market structure engine — faithful port of the LuxAlgo displayStructure()
// (SDD.md:551-612) and trailing-extreme bookkeeping (SDD.md:429-454, 709-713),
// minus all drawing. Emits BOS/CHoCH/SWING_FORMED events, maintains swing +
// internal trend bias, structure-level objects, and trailing extremes.

import type { Candle } from '@/lib/types';
import {
  BULLISH,
  BEARISH,
  type Bias,
  type SmcConfig,
  type SmcDirection,
  type SmcEvent,
  type SmcObject,
  type SmcScope,
  smcObjectId,
} from './types';
import { createSwingTracker, type PivotState, type SwingTracker } from './swings';

/** Pine `trailingExtremes` UDT (SDD.md:181-187). */
export interface TrailingExtremes {
  top: number;
  bottom: number;
  barIndex: number;
  barTime: number;
  lastTopTime: number;
  lastBottomTime: number;
}

export interface StructureBreak {
  scope: SmcScope;
  direction: SmcDirection;
  tag: 'BOS' | 'CHOCH';
  pivot: { level: number; barIndex: number; barTime: number };
}

export interface StructureEngine {
  swingTrend: Bias;
  internalTrend: Bias;
  trailing: TrailingExtremes;
  structureLevels: SmcObject[];
  /** Call once per bar in order. Returns the structure breaks of this bar. */
  onBar(i: number): StructureBreak[];
}

interface ScopeState {
  scope: SmcScope;
  tracker: SwingTracker;
  /** structureLevel object for the current (uncrossed) high/low pivot. */
  highLevel: SmcObject | null;
  lowLevel: SmcObject | null;
}

export function createStructureEngine(
  candles: Candle[],
  cfg: SmcConfig,
  events: SmcEvent[],
): StructureEngine {
  const swing: ScopeState = {
    scope: 'swing',
    tracker: createSwingTracker(candles, cfg.swingsLength),
    highLevel: null,
    lowLevel: null,
  };
  const internal: ScopeState = {
    scope: 'internal',
    tracker: createSwingTracker(candles, cfg.internalLength),
    highLevel: null,
    lowLevel: null,
  };

  const engine: StructureEngine = {
    swingTrend: 0,
    internalTrend: 0,
    trailing: { top: NaN, bottom: NaN, barIndex: 0, barTime: 0, lastTopTime: 0, lastBottomTime: 0 },
    structureLevels: [],
    onBar,
  };

  function pushEvent(type: SmcEvent['type'], i: number, direction: SmcDirection, price: number, scope?: SmcScope, objectId?: string): void {
    events.push({
      id: `${type}_${i}${scope ? `_${scope}` : ''}`,
      type,
      barIndex: i,
      time: candles[i].time,
      direction,
      scope,
      objectId,
      price,
    });
  }

  function makeLevel(scope: SmcScope, direction: SmcDirection, pivot: PivotState): SmcObject {
    const obj: SmcObject = {
      id: smcObjectId('structureLevel', scope, direction, pivot.barIndex),
      kind: 'structureLevel',
      scope,
      direction,
      top: pivot.currentLevel,
      bottom: pivot.currentLevel,
      createdAtBar: pivot.barIndex,
      createdAtTime: pivot.barTime,
      updatedAtBar: pivot.barIndex,
      state: 'active',
      touches: 0,
      strength: 0,
      quality: 0,
      confidence: 0,
    };
    engine.structureLevels.push(obj);
    return obj;
  }

  function onNewPivot(s: ScopeState, i: number): void {
    const u = s.tracker.onBar(i);
    if (!u) return;

    if (u.kind === 'high') {
      // A high pivot is a bearish-direction level (price crossing UP through it is bullish).
      s.highLevel = makeLevel(s.scope, 'bearish', s.tracker.high);
    } else {
      s.lowLevel = makeLevel(s.scope, 'bullish', s.tracker.low);
    }

    if (s.scope === 'swing') {
      // Trailing extremes snap to new swing pivots (SDD.md:429-433, 450-454).
      if (u.kind === 'low') {
        engine.trailing.bottom = u.level;
        engine.trailing.barTime = u.barTime;
        engine.trailing.barIndex = u.barIndex;
        engine.trailing.lastBottomTime = u.barTime;
        if (!Number.isFinite(engine.trailing.top)) engine.trailing.top = candles[i].high;
      } else {
        engine.trailing.top = u.level;
        engine.trailing.barTime = u.barTime;
        engine.trailing.barIndex = u.barIndex;
        engine.trailing.lastTopTime = u.barTime;
        if (!Number.isFinite(engine.trailing.bottom)) engine.trailing.bottom = candles[i].low;
      }
      pushEvent('SWING_FORMED', i, u.kind === 'high' ? 'bearish' : 'bullish', u.level, 'swing',
        (u.kind === 'high' ? s.highLevel : s.lowLevel)!.id);
    }
  }

  function detectBreaks(s: ScopeState, i: number, breaks: StructureBreak[]): void {
    const close = candles[i].close;
    const prevClose = i > 0 ? candles[i - 1].close : close;
    const highPivot = s.tracker.high;
    const lowPivot = s.tracker.low;
    const trendKey = s.scope === 'swing' ? 'swingTrend' : 'internalTrend';

    // Bullish break: ta.crossover(close, level) on an uncrossed high pivot (SDD.md:568).
    // Internal scope requires internal level != swing level (SDD.md:565).
    const bullExtra = s.scope === 'internal' ? highPivot.currentLevel !== swing.tracker.high.currentLevel : true;
    if (
      Number.isFinite(highPivot.currentLevel) &&
      !highPivot.crossed &&
      prevClose <= highPivot.currentLevel &&
      close > highPivot.currentLevel &&
      bullExtra
    ) {
      const tag: 'BOS' | 'CHOCH' = engine[trendKey] === BEARISH ? 'CHOCH' : 'BOS';
      highPivot.crossed = true;
      engine[trendKey] = BULLISH;
      if (s.highLevel) {
        s.highLevel.state = 'mitigated';
        s.highLevel.updatedAtBar = i;
      }
      pushEvent(tag, i, 'bullish', highPivot.currentLevel, s.scope, s.highLevel?.id);
      breaks.push({
        scope: s.scope,
        direction: 'bullish',
        tag,
        pivot: { level: highPivot.currentLevel, barIndex: highPivot.barIndex, barTime: highPivot.barTime },
      });
    }

    // Bearish break: ta.crossunder(close, level) on an uncrossed low pivot (SDD.md:593).
    const bearExtra = s.scope === 'internal' ? lowPivot.currentLevel !== swing.tracker.low.currentLevel : true;
    if (
      Number.isFinite(lowPivot.currentLevel) &&
      !lowPivot.crossed &&
      prevClose >= lowPivot.currentLevel &&
      close < lowPivot.currentLevel &&
      bearExtra
    ) {
      const tag: 'BOS' | 'CHOCH' = engine[trendKey] === BULLISH ? 'CHOCH' : 'BOS';
      lowPivot.crossed = true;
      engine[trendKey] = BEARISH;
      if (s.lowLevel) {
        s.lowLevel.state = 'mitigated';
        s.lowLevel.updatedAtBar = i;
      }
      pushEvent(tag, i, 'bearish', lowPivot.currentLevel, s.scope, s.lowLevel?.id);
      breaks.push({
        scope: s.scope,
        direction: 'bearish',
        tag,
        pivot: { level: lowPivot.currentLevel, barIndex: lowPivot.barIndex, barTime: lowPivot.barTime },
      });
    }
  }

  function onBar(i: number): StructureBreak[] {
    // Pivot updates first (getCurrentStructure runs before displayStructure, SDD.md:782-792).
    onNewPivot(swing, i);
    onNewPivot(internal, i);

    // Trailing extremes track the running max/min once seeded (SDD.md:709-713).
    if (Number.isFinite(engine.trailing.top)) {
      if (candles[i].high >= engine.trailing.top) {
        engine.trailing.top = candles[i].high;
        engine.trailing.lastTopTime = candles[i].time;
      }
      if (candles[i].low <= engine.trailing.bottom) {
        engine.trailing.bottom = candles[i].low;
        engine.trailing.lastBottomTime = candles[i].time;
      }
    }

    const breaks: StructureBreak[] = [];
    detectBreaks(internal, i, breaks);
    detectBreaks(swing, i, breaks);
    return breaks;
  }

  return engine;
}
