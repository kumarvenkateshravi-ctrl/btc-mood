'use client';

import { Modal, Button } from '@/components/ui';
import OrderTicket from './OrderTicket';
import { X } from 'lucide-react';
import type { PlaceChartOrder, TradingCommandResult } from '@/lib/chartTradingCommands';
import type { MarketDataIntegrity } from '@/lib/marketDataIntegrity';

interface OrderModalProps {
  open: boolean;
  onClose: () => void;
  symbol: string;
  midPrice: number;
  leverage: number;
  onLeverageChange: (n: number) => void;
  reduceAvailable: number;
  initialSide?: 'buy' | 'sell';
  marketIntegrity?: MarketDataIntegrity;
  onSubmitOrder: (input: PlaceChartOrder) => TradingCommandResult;
}
// The boundary prop is declared with the modal interface above.

/**
 * Modal order ticket — now backed by the canonical <Modal> primitive which
 * provides native <dialog> focus trapping, Escape-key dismissal, and
 * backdrop-click closing out of the box.
 */
export default function OrderModal(p: OrderModalProps) {
  return (
    <Modal open={p.open} onClose={p.onClose} size="sm">
      {/* Custom header with close button — no title prop so we control the layout */}
      <div className="-mt-4 -mx-5 mb-3.5 flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">Order Ticket</span>
          <span className="rounded-md bg-bull/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-bull-bright ring-1 ring-bull/30">
            Live Paper
          </span>
          {p.marketIntegrity && p.marketIntegrity !== 'live' && (
            <span className="rounded-md bg-bear/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-bear-bright ring-1 ring-bear/30">
              Data {p.marketIntegrity}
            </span>
          )}
        </div>
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
        initialSide={p.initialSide}
        active={p.open}
        onPlaced={p.onClose}
        onSubmitOrder={p.onSubmitOrder}
      />
      {/* OrderTicket receives the mode-aware boundary above. */}
    </Modal>
  );
}
