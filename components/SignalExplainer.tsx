import type { SignalFlip } from '@/lib/signalMarkers';
import type { HoverPayload } from '@/lib/chartHoverStore';

export function SignalExplainer({
  pos,
  flips,
}: {
  pos: { x: number; y: number; time?: number; hover: HoverPayload };
  flips: SignalFlip[];
}) {
  const flip = flips.find((f) => f.time === pos.hover.base.time);
  if (!flip) return null;

  const gap = flip.ema21 !== 0 ? ((flip.ema9 - flip.ema21) / flip.ema21) * 100 : 0;
  
  // The OHLC tooltip sits to the right of the crosshair (x+20, y+20), so this
  // panel anchors its *right* edge 20px left of the crosshair via
  // translateX(-100%). Clamped so it can't slide off the left edge (~220px wide).
  const top = Math.max(10, pos.y + 20);
  const left = Math.max(240, pos.x) - 20;

  const formatPct = (n: number) => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const formatRsi = (n: number) => n.toFixed(1);

  return (
    <div
      className="pointer-events-none absolute z-[51] flex min-w-[200px] flex-col gap-2 rounded-xl border border-line/80 bg-surface-1/95 p-3 shadow-2xl backdrop-blur-md"
      style={{ left, top, transform: 'translateX(-100%)' }}
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex h-5 items-center rounded px-1.5 text-[11px] font-bold uppercase tracking-wider text-white ${
            flip.side === 'buy' ? 'bg-bull-bright' : 'bg-bear-bright'
          }`}
        >
          {flip.side} Signal
        </div>
        <span className="text-[11px] text-ink-muted">Condition Met</span>
      </div>

      <div className="flex flex-col gap-1 text-[12px]">
        <div className="flex justify-between">
          <span className="text-ink-muted">Trend (EMA9/21 Gap)</span>
          <span className={`font-mono font-medium ${gap > 0 ? 'text-bull-bright' : gap < 0 ? 'text-bear-bright' : 'text-ink'}`}>
            {formatPct(gap)}
          </span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-ink-muted">Momentum (RSI 14)</span>
          <span className="font-mono font-medium text-ink">
            {formatRsi(flip.rsi14)}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">Volatility (ATR%)</span>
          <span className="font-mono font-medium text-ink">
            {flip.atrPct.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}
