import { useEffect } from 'react';
import type { ISeriesMarkersPluginApi, SeriesMarker, Time } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { ChartPalette } from '@/lib/chartTheme';
import type { Candle } from '@/lib/types';
import { shiftTime } from './types';
import type { IndicatorRender } from './types';
import type { SignalFlip } from '@/lib/signalMarkers';

/**
 * Merges BUY/SELL signals — primary mood flips, the indicator stack, and
 * cross-TF divergence openings — into candle markers (arrows), sorted
 * ascending by time (setMarkers requirement).
 * Hidden when signals are toggled off, in Renko mode, or with no data.
 */
export function useSignalMarkers(
  markersRef: RefObject<ISeriesMarkersPluginApi<Time> | null>,
  candles: Candle[],
  showSignals: boolean,
  isRenko: boolean,
  visibleResults: IndicatorRender[],
  palette: ChartPalette,
  flips: SignalFlip[] = [],
  divergenceMarkers: SeriesMarker<Time>[] = [],
) {
  useEffect(() => {
    const mk = markersRef.current;
    if (!mk) return;
    // Mood flips and divergence markers don't depend on the indicator stack,
    // so an empty stack no longer hides them.
    if (!showSignals || isRenko || candles.length === 0) {
      mk.setMarkers([]);
      return;
    }

    const markers: SeriesMarker<Time>[] = [];

    // 1. Primary mood signals
    for (const flip of flips) {
      if (flip.side === 'buy') {
        markers.push({
          time: shiftTime(flip.time),
          position: 'belowBar',
          color: palette.markerBuy,
          shape: 'arrowUp',
          text: 'BUY',
        });
      } else {
        markers.push({
          time: shiftTime(flip.time),
          position: 'aboveBar',
          color: palette.markerSell,
          shape: 'arrowDown',
          text: 'SELL',
        });
      }
    }

    // 2. Indicator signals
    for (const { result } of visibleResults) {
      for (let i = 0; i < result.signals.length; i++) {
        const sig = result.signals[i];
        if (!candles[i]) continue;
        if (sig === 'buy') {
          markers.push({
            time: shiftTime(candles[i].time as number),
            position: 'belowBar',
            color: palette.markerBuy,
            shape: 'arrowUp',
            text: 'BUY',
          });
        } else if (sig === 'sell') {
          markers.push({
            time: shiftTime(candles[i].time as number),
            position: 'aboveBar',
            color: palette.markerSell,
            shape: 'arrowDown',
            text: 'SELL',
          });
        }
      }
    }

    // 3. Divergence markers
    for (const m of divergenceMarkers) {
      markers.push(m);
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    mk.setMarkers(markers);
  }, [candles, showSignals, isRenko, visibleResults, palette, markersRef, flips, divergenceMarkers]);
}
