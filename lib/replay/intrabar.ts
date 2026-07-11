// Intrabar execution simulation (Phase 5) — a closed bar hides the ORDER in
// which its extremes printed. When both TP and SL sit inside one bar's range,
// whole-bar reconciliation is ambiguous (the engine's block order silently
// decides). Splitting the bar into the standard O→L→H→C (up bar) or O→H→L→C
// (down bar) tick path resolves fills deterministically at the first touch,
// matching how TradingView's replay approximates intrabar movement.

import type { Candle } from '../types';

/**
 * The bar as four degenerate sub-ticks in path order. Volume is split evenly
 * (only the aggregate matters to fills). Deterministic: pure function of the
 * bar.
 */
export function intrabarSubBars(bar: Candle): Candle[] {
  const path =
    bar.close >= bar.open
      ? [bar.open, bar.low, bar.high, bar.close] // up bar: dip first, then rally
      : [bar.open, bar.high, bar.low, bar.close]; // down bar: pop first, then sell off
  return path.map((p) => ({
    time: bar.time,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: bar.volume / path.length,
  }));
}
