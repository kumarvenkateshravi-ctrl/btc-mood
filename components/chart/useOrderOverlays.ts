import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { OrderOverlayPrimitive } from '@/lib/orderOverlayPrimitive';
import type { ChartOverlay } from './types';

/**
 * Syncs the open-position order overlay (entry / TP / SL) primitive with the
 * current overlay props + position metadata (side, units, leverage, PnL).
 */
export function useOrderOverlays(
  overlayPrimitiveRef: RefObject<OrderOverlayPrimitive | null>,
  overlays: ChartOverlay[],
  overlaySide: 'buy' | 'sell' | null,
  overlayUnitsLabel: string,
  overlayTypeLabel: string,
  overlayHasTp: boolean,
  overlayHasSl: boolean,
  overlayTpPrice: number | null,
  overlaySlPrice: number | null,
  overlayEntryPrice: number | null,
  overlayPnL: number | null,
) {
  useEffect(() => {
    const prim = overlayPrimitiveRef.current;
    if (!prim) return;
    prim.options.side = overlaySide;
    prim.options.unitsLabel = overlayUnitsLabel;
    prim.options.typeLabel = overlayTypeLabel;
    prim.options.hasTp = overlayHasTp;
    prim.options.hasSl = overlayHasSl;
    prim.options.tpPrice = overlayTpPrice;
    prim.options.slPrice = overlaySlPrice;
    prim.options.entryPrice = overlayEntryPrice;
    prim.options.pnl = overlayPnL;
    prim.setOverlays(
      overlays
        .filter((o) => Number.isFinite(o.price) && o.price > 0)
        .map((o) => ({
          kind: o.kind,
          price: o.price,
          color: o.color,
          draggable: !!o.draggable,
        })),
    );
  }, [
    overlays,
    overlaySide,
    overlayUnitsLabel,
    overlayTypeLabel,
    overlayHasTp,
    overlayHasSl,
    overlayTpPrice,
    overlaySlPrice,
    overlayEntryPrice,
    overlayPnL,
    overlayPrimitiveRef,
  ]);
}
