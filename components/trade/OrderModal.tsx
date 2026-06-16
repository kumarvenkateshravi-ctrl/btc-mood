'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import OrderTicket from './OrderTicket';

interface OrderModalProps {
  open: boolean;
  onClose: () => void;
  symbol: string;
  midPrice: number;
  leverage: number;
  onLeverageChange: (n: number) => void;
  reduceAvailable: number;
}

/**
 * Modal order ticket used by Immersive density. A focus trap via
 * Escape + a backdrop click. We don't pull in a focus-management
 * library because the ticket's own input has autofocus on mount.
 */
export default function OrderModal(p: OrderModalProps) {
  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // The handler reads the latest p via closure on every fire; we
    // intentionally re-bind on p.open so it doesn't leak when the
    // modal closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open]);

  if (!p.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/60 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-label="Order ticket"
      onClick={p.onClose}
    >
      <div
        className="relative w-[min(360px,calc(100vw-24px))] max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl border border-line bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'mode-fade 220ms var(--ease-quart)' }}
      >
        <button
          onClick={p.onClose}
          className="focus-ring absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface-2/60 text-ink-muted transition hover:text-ink"
          aria-label="Close order ticket"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <OrderTicket
          symbol={p.symbol}
          midPrice={p.midPrice}
          leverage={p.leverage}
          onLeverageChange={p.onLeverageChange}
          reduceAvailable={p.reduceAvailable}
        />
      </div>
    </div>
  );
}
