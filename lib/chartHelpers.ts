import { useMemo } from 'react';
import type { Candle } from '@/lib/types';
import { toHeikinAshi } from '@/lib/heikinAshi';
import { toRenko, type RenkoOptions } from '@/lib/renko';

export function useBaseCandles(
  candles: Candle[],
  type: string,
  renkoOptions?: RenkoOptions
): Candle[] {
  return useMemo(() => {
    if (type === 'heikinAshi') {
      return toHeikinAshi(candles);
    }
    if (type === 'renko') {
      return toRenko(candles, renkoOptions ?? {});
    }
    return candles;
  }, [candles, type, renkoOptions]);
}
