import type { Timeframe, Candle } from './types';
import { perBarSignals, type Side } from './confluence';
import { LOWER_TFS, HIGHER_TFS, type Bias } from './divergence';
import type { SeriesMarker, Time } from 'lightweight-charts';
import { shiftTime } from '@/components/chart/types';

export interface DivergenceMarkerPayload {
  time: number;
  bias: Bias;
  lowerBias: Bias;
  higherBias: Bias;
}

/**
 * Sweeps through the base timeframe's candles, rebuilding the cross-timeframe
 * divergence state at each bar to place historical markers on the chart.
 * We only emit a marker on the *first* bar a divergence opens.
 */
export function buildDivergenceMarkers(
  candlesByTf: Record<Timeframe, Candle[]>,
  baseTf: Timeframe,
): { markers: SeriesMarker<Time>[]; payloads: DivergenceMarkerPayload[] } {
  const baseCandles = candlesByTf[baseTf] ?? [];
  if (baseCandles.length === 0) return { markers: [], payloads: [] };

  // Precompute signals for all timeframes
  const signalsByTf = {} as Record<Timeframe, Side[]>;
  for (const [tf, c] of Object.entries(candlesByTf)) {
    signalsByTf[tf as Timeframe] = perBarSignals(c);
  }

  const markers: SeriesMarker<Time>[] = [];
  const payloads: DivergenceMarkerPayload[] = [];
  let lastDiverging = false;

  for (let i = 0; i < baseCandles.length; i++) {
    const t = baseCandles[i].time;

    // Build the mock snapshots for this exact timestamp
    const getBias = (tfs: Timeframe[]): Bias => {
      let buy = 0, sell = 0;
      for (const tf of tfs) {
        const c = candlesByTf[tf];
        const sigs = signalsByTf[tf];
        if (!c || !sigs || c.length === 0) continue;
        
        // Find the candle in `tf` that was active at time `t`
        // We binary search or just linear search backwards (since time is increasing)
        // For simplicity in this bounded loop, we can binary search.
        let low = 0;
        let high = c.length - 1;
        let idx = -1;
        while (low <= high) {
          const mid = (low + high) >>> 1;
          if (c[mid].time <= t) {
            idx = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        
        if (idx !== -1) {
          const side = sigs[idx];
          if (side === 'buy') buy++;
          else if (side === 'sell') sell++;
        }
      }
      return buy > sell ? 'bullish' : sell > buy ? 'bearish' : 'neutral';
    };

    const lowerBias = getBias(LOWER_TFS);
    const higherBias = getBias(HIGHER_TFS);

    const isDiverging =
      (lowerBias === 'bullish' && higherBias === 'bearish') ||
      (lowerBias === 'bearish' && higherBias === 'bullish');

    // Only mark the *opening* of a divergence
    if (isDiverging && !lastDiverging) {
      const isBullish = lowerBias === 'bullish';
      
      markers.push({
        time: shiftTime(t),
        position: isBullish ? 'belowBar' : 'aboveBar',
        color: isBullish ? '#10b981' : '#f43f5e', // text-bull-bright / bear-bright
        shape: 'circle',
        text: '◆',
        size: 0.5,
      });

      payloads.push({
        time: t,
        bias: isBullish ? 'bullish' : 'bearish',
        lowerBias,
        higherBias,
      });
    }

    lastDiverging = isDiverging;
  }

  return { markers, payloads };
}
