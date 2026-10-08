import { useEffect } from 'react';
import type { ISeriesMarkersPluginApi, SeriesMarker, Time } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { Candle } from '@/lib/types';

/**
 * Divergence markers shared with the chart marker plugin.
 * Hidden when signals are toggled off, in Renko mode, or with no data.
 */
export function useSignalMarkers(
  markersRef: RefObject<ISeriesMarkersPluginApi<Time> | null>,
  candles: Candle[],
  showSignals: boolean,
  isRenko: boolean,
  divergenceMarkers: SeriesMarker<Time>[] = [],
) {
  useEffect(() => {
    const mk = markersRef.current;
    if (!mk) return;
    if (!showSignals || isRenko || candles.length === 0) {
      mk.setMarkers([]);
      return;
    }

    const markers: SeriesMarker<Time>[] = [];

    // Divergence markers
    for (const m of divergenceMarkers) {
      markers.push(m);
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    mk.setMarkers(markers);
  }, [candles, showSignals, isRenko, markersRef, divergenceMarkers]);
}
