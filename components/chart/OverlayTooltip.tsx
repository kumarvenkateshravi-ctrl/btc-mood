import type { OverlayKind } from './types';

export function OverlayTooltip({ kind, price, y, side, units, leverage, entryPrice }: {
  kind: OverlayKind;
  price: number;
  y: number;
  side: 'buy' | 'sell' | null;
  units: number;
  leverage: number;
  entryPrice: number | null;
}) {
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const notional = units > 0 && price > 0 ? units * price : null;
  const margin = units > 0 && price > 0 && leverage > 0 ? (units * price) / leverage : null;
  const liq =
    kind === 'entry' && side && entryPrice != null && leverage > 1
      ? side === 'buy' ? entryPrice * (1 - 1 / leverage) : entryPrice * (1 + 1 / leverage)
      : null;
  const kindLabel =
    kind === 'entry' ? (side === 'buy' ? 'Entry (Buy)' : side === 'sell' ? 'Entry (Sell)' : 'Entry')
    : kind === 'tp' ? 'Take profit' : 'Stop loss';
  const kindColor =
    kind === 'entry'
      ? side === 'buy' ? 'border-bull/40 text-bull-bright' : 'border-bear/40 text-bear-bright'
      : kind === 'tp' ? 'border-bull/40 text-bull-bright' : 'border-regime-hot/40 text-regime-hot';
  return (
    <div className={['pointer-events-none absolute left-2 z-10 rounded-md border bg-surface-1/90 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur-md', kindColor].join(' ')}
      style={{ top: Math.max(8, Math.min(y - 22, (typeof window !== 'undefined' ? window.innerHeight : 600) - 80)) }}>
      <div className="flex items-center gap-2 font-medium">
        <span>{kindLabel}</span>
        <span className="font-mono text-ink">{fmt(price)}</span>
      </div>
      {kind === 'entry' && notional != null && (
        <div className="mt-0.5 flex gap-3 text-ink-faint">
          <span>Notional <span className="font-mono text-ink">${fmt(notional)}</span></span>
          <span>Margin <span className="font-mono text-ink">${fmt(margin ?? 0)}</span></span>
        </div>
      )}
      {liq != null && (
        <div className="mt-0.5 text-ink-faint">
          Liq <span className="font-mono text-bear-bright">${fmt(liq)}</span>
        </div>
      )}
    </div>
  );
}
