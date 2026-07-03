'use client';

import { Modal, Button } from '@/components/ui';
import OrderTicket from './OrderTicket';
import { X } from 'lucide-react';

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
 * Modal order ticket — now backed by the canonical <Modal> primitive which
 * provides native <dialog> focus trapping, Escape-key dismissal, and
 * backdrop-click closing out of the box.
 */
export default function OrderModal(p: OrderModalProps) {
  return (
    <Modal open={p.open} onClose={p.onClose} size="sm">
      {/* Custom header with close button — no title prop so we control the layout */}
      <div className="-mt-4 -mx-5 flex items-center justify-between border-b border-line px-5 py-3 mb-4">
        <span className="text-sm font-semibold text-ink">Order Ticket</span>
        <Button
          variant="ghost"
          size="sm"
          icon={<X className="h-3.5 w-3.5" />}
          onClick={p.onClose}
          aria-label="Close order ticket"
        />
      </div>
      <OrderTicket
        symbol={p.symbol}
        midPrice={p.midPrice}
        leverage={p.leverage}
        onLeverageChange={p.onLeverageChange}
        reduceAvailable={p.reduceAvailable}
      />
    </Modal>
  );
}
