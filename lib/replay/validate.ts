// Pre-replay data validation: replaying corrupt history silently produces
// untrustworthy results. Crypto trades 24/7, so a strict fixed interval is
// expected on every supported timeframe.

import type { Candle, Timeframe } from '../types';
import { TF_SECONDS } from './replaySlice';

export interface ReplayValidation {
  ok: boolean;
  problems: string[];
}

export function validateReplayData(candles: Candle[], tf: Timeframe): ReplayValidation {
  const problems: string[] = [];
  if (candles.length < 10) {
    return { ok: false, problems: ['Not enough history to replay (need at least 10 candles).'] };
  }
  const interval = TF_SECONDS[tf];

  let missing = 0;
  let duplicates = 0;
  let broken = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i > 0) {
      const gap = c.time - candles[i - 1].time;
      if (gap === 0) duplicates++;
      else if (gap < 0) duplicates++; // out-of-order counts as duplicate-class corruption
      else if (gap !== interval) missing += Math.round(gap / interval) - 1;
    }
    if (
      c.high < c.low ||
      c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close) ||
      !Number.isFinite(c.open + c.high + c.low + c.close)
    ) {
      broken++;
    }
  }

  if (missing > 0) problems.push(`Missing ${missing} candle${missing === 1 ? '' : 's'}.`);
  if (duplicates > 0) problems.push(`${duplicates} duplicate or out-of-order timestamp${duplicates === 1 ? '' : 's'}.`);
  if (broken > 0) problems.push(`${broken} candle${broken === 1 ? '' : 's'} with broken OHLC.`);

  return { ok: problems.length === 0, problems };
}
