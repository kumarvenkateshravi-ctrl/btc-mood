import type { Candle } from './types';

export function toHeikinAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];

  const ha: Candle[] = [];
  let prevHaOpen = 0;
  let prevHaClose = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;

    let haOpen: number;
    if (i === 0) {
      haOpen = (c.open + c.close) / 2;
    } else {
      haOpen = (prevHaOpen + prevHaClose) / 2;
    }

    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);

    ha.push({
      time: c.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: c.volume,
    });

    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }

  return ha;
}
