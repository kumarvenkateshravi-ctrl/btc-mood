import { ChevronsRight } from 'lucide-react';
import type { ChartType, PriceScaleModeOption } from './types';
import { ChartOHLCStrip } from './ChartOHLCStrip';

interface ChartFloatingControlsProps {
  type: ChartType;
  onQuickTrade?: (side: 'buy' | 'sell') => void;
  onOpenRenkoSettings?: () => void;
  bid?: number | null;
  ask?: number | null;
  priceScaleMode: PriceScaleModeOption;
  onPriceScaleModeChange?: (mode: PriceScaleModeOption) => void;
  isScrolledBack: boolean;
  onScrollToRealtime: () => void;
}

export function ChartFloatingControls({
  type,
  onQuickTrade,
  onOpenRenkoSettings,
  bid,
  ask,
  priceScaleMode,
  onPriceScaleModeChange,
  isScrolledBack,
  onScrollToRealtime,
}: ChartFloatingControlsProps) {
  return (
    <>
      {/* Floating Controls & OHLC Legend */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col gap-1">
        <div className="flex items-center gap-3">
          {(onQuickTrade || (type === 'renko' && onOpenRenkoSettings)) && (
            <div className="pointer-events-auto flex flex-col gap-2">
              {onQuickTrade && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onQuickTrade('sell')}
                    className="flex min-w-[70px] flex-col items-center justify-center rounded bg-surface-1/80 backdrop-blur-md px-2 py-1 text-[13px] border border-bear-bright/30 transition hover:border-bear-bright/60 hover:bg-bear-bright/10"
                  >
                    <span className="font-semibold text-bear-bright text-[13px]">Sell</span>
                    {ask != null && Number.isFinite(ask) && (
                      <span className="font-mono text-[11px] text-bear-bright/80">{ask.toFixed(1)}</span>
                    )}
                  </button>
                  <button
                    onClick={() => onQuickTrade('buy')}
                    className="flex min-w-[70px] flex-col items-center justify-center rounded bg-surface-1/80 backdrop-blur-md px-2 py-1 text-[13px] border border-bull-bright/30 transition hover:border-bull-bright/60 hover:bg-bull-bright/10"
                  >
                    <span className="font-semibold text-bull-bright text-[13px]">Buy</span>
                    {bid != null && Number.isFinite(bid) && (
                      <span className="font-mono text-[11px] text-bull-bright/80">{bid.toFixed(1)}</span>
                    )}
                  </button>
                </div>
              )}
              {type === 'renko' && onOpenRenkoSettings && (
                <button
                  onClick={onOpenRenkoSettings}
                  className="flex w-full items-center justify-center gap-1.5 rounded bg-surface-1/80 backdrop-blur-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider border border-line text-ink transition hover:border-line-strong hover:bg-surface-2"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  Renko Settings
                </button>
              )}
            </div>
          )}
          <ChartOHLCStrip mode={type} />
        </div>
      </div>

      {/* Price Scale Toggles (Bottom Right Floating) */}
      <div className="absolute bottom-[28px] right-2 z-20 flex gap-1 bg-surface-1/80 backdrop-blur-md rounded px-1 py-0.5 border border-line">
        <button
          onClick={() => onPriceScaleModeChange?.('normal')}
          className={['text-[10px] font-bold px-1.5 py-0.5 rounded transition', priceScaleMode === 'normal' ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:text-ink'].join(' ')}
          title="Auto (Linear)"
        >
          A
        </button>
        <button
          onClick={() => onPriceScaleModeChange?.('log')}
          className={['text-[10px] font-bold px-1.5 py-0.5 rounded transition', priceScaleMode === 'log' ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:text-ink'].join(' ')}
          title="Logarithmic"
        >
          L
        </button>
        <button
          onClick={() => onPriceScaleModeChange?.('percent')}
          className={['text-[10px] font-bold px-1.5 py-0.5 rounded transition', priceScaleMode === 'percent' ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:text-ink'].join(' ')}
          title="Percentage"
        >
          %
        </button>
      </div>

      {/* Scroll to Realtime */}
      {isScrolledBack && (
        <button
          onClick={onScrollToRealtime}
          className="absolute bottom-[2px] right-[65px] z-20 flex h-[24px] w-[24px] items-center justify-center rounded-full bg-surface-2 border border-line-strong text-ink drop-shadow-md transition hover:bg-surface-3"
          title="Scroll to realtime"
        >
          <ChevronsRight size={14} />
        </button>
      )}
    </>
  );
}
