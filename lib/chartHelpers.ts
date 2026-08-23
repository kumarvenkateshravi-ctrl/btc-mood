import { useState } from 'react';
import type { Candle } from '@/lib/types';
import { IncrementalHeikinAshi, IncrementalRenko } from '@/lib/incrementalCandleTransforms';
import type { RenkoOptions } from '@/lib/renko';

export function useBaseCandles(
  candles: Candle[],
  type: string,
  renkoOptions?: RenkoOptions
): Candle[] {
  const [heikinAshi] = useState(() => new IncrementalHeikinAshi());
  const [renko] = useState(() => new IncrementalRenko());

  if (type === 'heikinAshi') {
    return heikinAshi.update(candles);
  }
  if (type === 'renko') {
    return renko.update(candles, renkoOptions ?? {});
  }
  return candles;
}
