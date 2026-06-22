// Price-alert model + pure firing logic. Distinct from the signal alerts in
// `alerts.ts` (which fire on EMA/RSI verdict flips): these fire when the live
// price crosses a user-set level, and render as horizontal lines on the chart.

export type PriceAlertSide = 'above' | 'below';

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  /** 'above' fires when price crosses up through `price`; 'below' crosses down. */
  side: PriceAlertSide;
  enabled: boolean;
  createdAt: number;
  lastFiredAt: number | null;
}

export const PRICE_ALERTS_KEY = 'btc-mood:price-alerts:v1';

export function newPriceAlertId(): string {
  return `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Infer the side from where the level sits relative to the current price. */
export function sideForLevel(price: number, reference: number): PriceAlertSide {
  return price >= reference ? 'above' : 'below';
}

export function isPriceAlert(v: unknown): v is PriceAlert {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.id === 'string' &&
    typeof a.symbol === 'string' &&
    typeof a.price === 'number' &&
    (a.side === 'above' || a.side === 'below') &&
    typeof a.enabled === 'boolean' &&
    typeof a.createdAt === 'number' &&
    (a.lastFiredAt === null || typeof a.lastFiredAt === 'number')
  );
}

/**
 * Which alerts just fired, given the previous and latest price for a symbol.
 * An 'above' alert fires when the price crosses up through its level
 * (prev < level ≤ last); a 'below' alert fires on a downward cross.
 */
export function priceAlertsToFire(
  alerts: PriceAlert[],
  symbol: string,
  prevPrice: number,
  lastPrice: number,
): PriceAlert[] {
  if (!Number.isFinite(prevPrice) || !Number.isFinite(lastPrice)) return [];
  return alerts.filter((a) => {
    if (!a.enabled || a.symbol !== symbol) return false;
    if (a.side === 'above') return prevPrice < a.price && lastPrice >= a.price;
    return prevPrice > a.price && lastPrice <= a.price;
  });
}
