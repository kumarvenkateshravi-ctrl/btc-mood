// Swing / pivot tracker — faithful port of the LuxAlgo leg() +
// getCurrentStructure() pivot bookkeeping (SDD.md:337-346, 409-457).
//
// leg(size) flips BEARISH when high[size] > highest(size) (a new leg high has
// printed `size` bars back relative to the lookback window), and BULLISH when
// low[size] < lowest(size). A pivot forms on the bar where the leg CHANGES:
// leg → bullish means the bar `size` bars back was a swing LOW; leg → bearish
// means it was a swing HIGH.

import type { Candle } from '@/lib/types';

/** Pine `pivot` UDT (SDD.md:220-225). */
export interface PivotState {
  /** NaN until the first pivot forms. */
  currentLevel: number;
  lastLevel: number;
  crossed: boolean;
  barTime: number;
  barIndex: number;
}

export interface SwingUpdate {
  kind: 'high' | 'low';
  /** Price of the pivot bar's high/low. */
  level: number;
  /** The pivot bar (i - size). */
  barIndex: number;
  barTime: number;
  /** Vs the previous same-side pivot (HH/LH for highs, LL/HL for lows). */
  label: 'HH' | 'LH' | 'LL' | 'HL';
}

export interface SwingTracker {
  high: PivotState;
  low: PivotState;
  /** Call once per bar i in order. Returns an update when a NEW pivot forms. */
  onBar(i: number): SwingUpdate | null;
}

const BULLISH_LEG = 1;
const BEARISH_LEG = 0;

function newPivotState(): PivotState {
  return { currentLevel: NaN, lastLevel: NaN, crossed: false, barTime: 0, barIndex: 0 };
}

export function createSwingTracker(candles: Candle[], size: number): SwingTracker {
  const high = newPivotState();
  const low = newPivotState();
  let leg = 0;
  let prevLeg = 0;

  function onBar(i: number): SwingUpdate | null {
    if (i < size) return null;

    // ta.highest(size)/ta.lowest(size) at bar i cover bars [i-size+1 .. i].
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - size + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }

    prevLeg = leg;
    const newLegHigh = candles[i - size].high > hh;
    const newLegLow = candles[i - size].low < ll;
    if (newLegHigh) leg = BEARISH_LEG;
    else if (newLegLow) leg = BULLISH_LEG;

    if (leg === prevLeg) return null; // ta.change(leg) == 0 → no new pivot

    const pivotBar = i - size;
    const c = candles[pivotBar];

    if (leg === BULLISH_LEG) {
      // start of bullish leg ⇒ pivot LOW at bar i-size (SDD.md:416-427)
      const level = c.low;
      const label: SwingUpdate['label'] =
        !Number.isFinite(low.currentLevel) || level < low.currentLevel ? 'LL' : 'HL';
      low.lastLevel = low.currentLevel;
      low.currentLevel = level;
      low.crossed = false;
      low.barTime = c.time;
      low.barIndex = pivotBar;
      return { kind: 'low', level, barIndex: pivotBar, barTime: c.time, label };
    }

    // start of bearish leg ⇒ pivot HIGH at bar i-size (SDD.md:437-448)
    const level = c.high;
    const label: SwingUpdate['label'] =
      !Number.isFinite(high.currentLevel) || level > high.currentLevel ? 'HH' : 'LH';
    high.lastLevel = high.currentLevel;
    high.currentLevel = level;
    high.crossed = false;
    high.barTime = c.time;
    high.barIndex = pivotBar;
    return { kind: 'high', level, barIndex: pivotBar, barTime: c.time, label };
  }

  return { high, low, onBar };
}
