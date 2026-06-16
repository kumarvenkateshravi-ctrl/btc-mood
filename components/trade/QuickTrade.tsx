'use client';

// One-click market entry with auto-attached SL/TP, TradingView-style.
// Wraps the `executeOrder` facade from paperStore so the UI reads like
// the spec — pick BUY/SELL, hit it, and the position is open with both
// risk lines already on the chart and ready to drag.

import { useCallback } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { executeOrder, usePaperStore } from '@/lib/paperStore';

interface QuickTradeProps {
  symbol: string;
  midPrice: number;
  leverage: number;
  /** Size in base units (e.g. BTC). Tied to the ticket's units field so
   *  switching back and forth feels coherent. */
  size: number;
  /** TP/SL distance as a fraction of mid (e.g. 0.01 = 1%). */
  riskPct?: number;
  /** Compact layout for the on-chart floater; expanded for the rail. */
  variant?: 'overlay' | 'panel';
}

/** SHORT (sell): SL ABOVE entry, TP BELOW entry.
 *  LONG  (buy):  SL BELOW entry, TP ABOVE entry. */
function levelsFor(
  type: 'BUY' | 'SELL',
  mid: number,
  riskPct: number,
): { tp: number; sl: number } {
  const tpSign = type === 'BUY' ? +1 : -1;
  const slSign = -tpSign;
  return {
    tp: Number((mid * (1 + tpSign * riskPct)).toFixed(1)),
    sl: Number((mid * (1 + slSign * riskPct)).toFixed(1)),
  };
}

export default function QuickTrade({
  symbol,
  midPrice,
  leverage,
  size,
  riskPct = 0.01,
  variant = 'overlay',
}: QuickTradeProps) {
  const lastError = usePaperStore().lastError;

  const fire = useCallback(
    (type: 'BUY' | 'SELL') => {
      if (!Number.isFinite(midPrice) || midPrice <= 0 || size <= 0) return;
      const { tp, sl } = levelsFor(type, midPrice, riskPct);
      executeOrder({
        type,
        size,
        orderType: 'MARKET',
        symbol,
        midPrice,
        leverage,
        takeProfit: tp,
        stopLoss: sl,
      });
    },
    [symbol, midPrice, leverage, size, riskPct],
  );

  const disabled = !Number.isFinite(midPrice) || midPrice <= 0 || size <= 0;
  const { tp: tpBuy, sl: slBuy } = levelsFor('BUY', midPrice, riskPct);
  const { tp: tpSell, sl: slSell } = levelsFor('SELL', midPrice, riskPct);

  if (variant === 'overlay') {
    return (
      <div
        role="group"
        aria-label="Quick trade"
        className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-line bg-surface-1/85 p-1.5 shadow-xl backdrop-blur-md"
      >
        <Pill
          tone="buy"
          disabled={disabled}
          onClick={() => fire('BUY')}
          title={`Market BUY ${size} ${symbol}\nTP ${tpBuy.toFixed(1)} · SL ${slBuy.toFixed(1)}`}
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          BUY
        </Pill>
        <Pill
          tone="sell"
          disabled={disabled}
          onClick={() => fire('SELL')}
          title={`Market SELL ${size} ${symbol}\nTP ${tpSell.toFixed(1)} · SL ${slSell.toFixed(1)}`}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          SELL
        </Pill>
      </div>
    );
  }

  // Panel variant for the right rail.
  return (
    <section
      aria-label="Quick trade"
      className="rounded-xl border border-line bg-surface-1/70 p-3"
    >
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          Quick trade
        </h2>
        <span className="font-mono text-[10px] text-ink-faint">
          ±{(riskPct * 100).toFixed(2)}% TP/SL
        </span>
      </header>
      <div className="grid grid-cols-2 gap-2">
        <BigPill
          tone="buy"
          disabled={disabled}
          onClick={() => fire('BUY')}
          headline={`BUY ${size}`}
          tp={tpBuy}
          sl={slBuy}
        />
        <BigPill
          tone="sell"
          disabled={disabled}
          onClick={() => fire('SELL')}
          headline={`SELL ${size}`}
          tp={tpSell}
          sl={slSell}
        />
      </div>
      {lastError && (
        <p className="mt-2 text-[11px] text-bear-bright" role="status">
          {lastError}
        </p>
      )}
    </section>
  );
}

function Pill({
  tone,
  children,
  onClick,
  disabled,
  title,
}: {
  tone: 'buy' | 'sell';
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title?: string;
}) {
  const styles =
    tone === 'buy'
      ? 'bg-bull text-[#0a0e16] hover:bg-bull-bright'
      : 'bg-bear text-[#0a0e16] hover:bg-bear-bright';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'focus-ring inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold tracking-wide transition',
        styles,
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function BigPill({
  tone,
  headline,
  tp,
  sl,
  onClick,
  disabled,
}: {
  tone: 'buy' | 'sell';
  headline: string;
  tp: number;
  sl: number;
  onClick: () => void;
  disabled: boolean;
}) {
  const styles =
    tone === 'buy'
      ? 'bg-bull text-[#0a0e16] hover:bg-bull-bright'
      : 'bg-bear text-[#0a0e16] hover:bg-bear-bright';
  const Icon = tone === 'buy' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'focus-ring flex flex-col items-stretch gap-1 rounded-xl px-3 py-2 text-left font-semibold transition',
        styles,
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      <span className="flex items-center justify-between text-sm font-bold tracking-wide">
        {headline}
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="font-mono text-[10px] opacity-80">
        TP {tp.toFixed(1)} · SL {sl.toFixed(1)}
      </span>
    </button>
  );
}
