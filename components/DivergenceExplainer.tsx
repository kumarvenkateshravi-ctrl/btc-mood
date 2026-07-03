import { memo, useMemo } from 'react';
import type { HoverPayload } from '@/lib/chartHoverStore';
import type { DivergenceMarkerPayload } from '@/lib/divergenceMarkers';


interface DivergenceExplainerProps {
  pos: { x: number; y: number; time?: number; hover: HoverPayload };
  payloads: DivergenceMarkerPayload[];
}

export const DivergenceExplainer = memo(function DivergenceExplainer({
  pos,
  payloads,
}: DivergenceExplainerProps) {
  const { hover, x, y } = pos;

  // Match on the raw candle time: `pos.time` comes from the chart's series data,
  // which is TZ-shifted via shiftTime(); payload times are raw candle times.
  const baseTime = hover.base.time;
  const activePayload = useMemo(
    () => payloads.find((p) => p.time === baseTime) ?? null,
    [baseTime, payloads],
  );

  if (!activePayload) return null;

  return (
    <div
      className="pointer-events-none absolute z-[100] flex min-w-[200px] flex-col overflow-hidden rounded-md border border-line bg-surface/95 text-[11px] shadow-lg backdrop-blur-sm"
      // Left of the crosshair (right edge anchored 20px away) and *above* it,
      // so it overlaps neither the OHLC tooltip (right of crosshair) nor the
      // SignalExplainer (left, below) when a bar triggers both.
      style={{
        left: Math.max(240, x) - 20,
        top: Math.max(10, y - 110),
        transform: 'translateX(-100%)',
      }}
    >
      <div className="flex items-center justify-between border-b border-line bg-muted/50 px-3 py-1.5 font-medium text-white/90">
        <span>Cross-TF Divergence</span>
        <span
          className={`uppercase tracking-wider ${
            activePayload.bias === 'bullish' ? 'text-bull-bright' : 'text-bear-bright'
          }`}
        >
          {activePayload.bias}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex justify-between">
          <span className="text-white/50">Lower TFs (5m, 15m)</span>
          <span
            className={
              activePayload.lowerBias === 'bullish'
                ? 'text-bull'
                : activePayload.lowerBias === 'bearish'
                  ? 'text-bear'
                  : 'text-white/60'
            }
          >
            {activePayload.lowerBias.toUpperCase()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">Higher TFs (1h, 4h, 1d)</span>
          <span
            className={
              activePayload.higherBias === 'bullish'
                ? 'text-bull'
                : activePayload.higherBias === 'bearish'
                  ? 'text-bear'
                  : 'text-white/60'
            }
          >
            {activePayload.higherBias.toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
});
