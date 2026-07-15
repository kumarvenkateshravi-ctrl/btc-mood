import { useEffect } from 'react';
import type { ISeriesMarkersPluginApi, SeriesMarker, Time } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { ChartPalette } from '@/lib/chartTheme';
import type { Candle } from '@/lib/types';
import { shiftTime } from './types';
import type { IndicatorRender } from './types';

/**
 * BUY/SELL candle markers. Only Volume Distribution Zones emits trade
 * signals on the chart (per-indicator generic signals produced stacked
 * marker spam that buried price action); divergence openings keep their
 * own labels. Markers render on signal TRANSITIONS only — a signal that
 * persists across bars prints once, not once per bar.
 * Hidden when signals are toggled off, in Renko mode, or with no data.
 */
export function useSignalMarkers(
  markersRef: RefObject<ISeriesMarkersPluginApi<Time> | null>,
  candles: Candle[],
  showSignals: boolean,
  isRenko: boolean,
  visibleResults: IndicatorRender[],
  palette: ChartPalette,
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

    // Volume Distribution Zones signals (multi-chart keys are tf-prefixed,
    // e.g. "5m:volume_distribution_zones" — match by inclusion).
    for (const { key, result } of visibleResults) {
      if (!key.includes('volume_distribution_zones')) continue;
      let prev: (typeof result.signals)[number] = 'neutral';
      for (let i = 0; i < result.signals.length; i++) {
        const sig = result.signals[i];
        const c = candles[i];
        if (c == null || !Number.isFinite(c.time as number)) continue;
        if (sig !== prev) {
          if (sig === 'buy') {
            markers.push({
              time: shiftTime(c.time as number),
              position: 'belowBar',
              color: palette.markerBuy,
              shape: 'arrowUp',
              text: 'BUY',
            });
          } else if (sig === 'sell') {
            markers.push({
              time: shiftTime(c.time as number),
              position: 'aboveBar',
              color: palette.markerSell,
              shape: 'arrowDown',
              text: 'SELL',
            });
          }
        }
        prev = sig;
      }
    }

    // Divergence markers
    for (const m of divergenceMarkers) {
      markers.push(m);
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    mk.setMarkers(markers);
  }, [candles, showSignals, isRenko, visibleResults, palette, markersRef, divergenceMarkers]);
}
