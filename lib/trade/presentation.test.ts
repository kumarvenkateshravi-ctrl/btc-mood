import { describe, expect, it } from 'vitest';
import type { PaperPosition, PaperTrade } from '../paper';
import { resolveTradePresentation } from './presentation';
import { deriveActivePosition } from './activePosition';

const position = (overrides: Partial<PaperPosition> = {}): PaperPosition => ({
  id: 'position', symbol: 'BTCUSDT', side: 'long', units: 2, entryPrice: 100,
  realizedPnl: 4, feesPaid: 1, openedAt: 10, tp: 120, sl: 90, liquidated: false,
  leverage: 10, trailingSl: true, trailingBest: 110, ...overrides,
});
const trade = (overrides: Partial<PaperTrade> = {}): PaperTrade => ({
  id: 'trade', positionId: 'position', symbol: 'BTCUSDT', side: 'sell', units: 1,
  price: 110, fee: 0.1, realizedPnl: 9.9, ts: 20, ...overrides,
});
const live = (overrides: Record<string, unknown> = {}) => ({
  positions: { BTCUSDT: position(), ETHUSDT: position({ symbol: 'ETHUSDT', side: 'short' }) },
  trades: [trade(), trade({ id: 'eth-trade', symbol: 'ETHUSDT' })], balance: 900, initialBalance: 1_000,
  ...overrides,
});
const replay = (overrides: Record<string, unknown> = {}) => ({
  active: true, symbol: 'BTCUSDT', position: position({ units: 1.5, realizedPnl: 2, trailingBest: 115 }),
  trades: [trade({ id: 'replay-trade' })], startBalance: 500, config: null,
  ...overrides,
});

describe('resolveTradePresentation', () => {
  it('uses the current symbol’s live paper state only', () => {
    const result = resolveTradePresentation({ mode: 'live', symbol: 'BTCUSDT', paper: live(), replay: replay() });
    expect(result).toMatchObject({ mode: 'live', position: { symbol: 'BTCUSDT', units: 2 }, balance: 900 });
    expect(result.trades).toEqual([expect.objectContaining({ id: 'trade' })]);
  });

  it('uses replay state only while replay is active', () => {
    const result = resolveTradePresentation({ mode: 'replay', symbol: 'BTCUSDT', paper: live(), replay: replay() });
    expect(result).toMatchObject({ mode: 'replay', position: { units: 1.5, trailingBest: 115 }, balance: 509.9 });
    expect(result.trades).toEqual([expect.objectContaining({ id: 'replay-trade' })]);
  });

  it('clears trade presentation on a replay symbol mismatch instead of leaking live state', () => {
    const result = resolveTradePresentation({ mode: 'replay', symbol: 'ETHUSDT', paper: live(), replay: replay() });
    expect(result).toMatchObject({ mode: 'replay', position: null, trades: [], balance: 0 });
  });

  it('restores live presentation immediately after replay exit', () => {
    const result = resolveTradePresentation({ mode: 'live', symbol: 'BTCUSDT', paper: live(), replay: replay() });
    expect(result.position).toMatchObject({ units: 2, tp: 120, sl: 90, trailingSl: true });
  });

  it('uses the remaining position after a partial close', () => {
    const result = resolveTradePresentation({
      mode: 'replay', symbol: 'BTCUSDT', paper: live(), replay: replay({ position: position({ units: 0.5, realizedPnl: 7 }) }),
    });
    expect(result.position).toMatchObject({ units: 0.5, realizedPnl: 7, tp: 120, sl: 90, trailingSl: true });
  });

  it('replaces reversal state and clears all presentation when flat', () => {
    const reversed = resolveTradePresentation({
      mode: 'live', symbol: 'BTCUSDT', paper: live({ positions: { BTCUSDT: position({ side: 'short', tp: null, sl: null, trailingSl: false, trailingBest: null }) } }), replay: replay(),
    });
    expect(reversed.position).toMatchObject({ side: 'short', tp: null, sl: null, trailingSl: false, trailingBest: null });

    const flat = resolveTradePresentation({ mode: 'live', symbol: 'BTCUSDT', paper: live({ positions: {} }), replay: replay() });
    expect(flat.position).toBeNull();
  });
});

describe('authoritative presentation fields', () => {
  it('reflects atomic protection and trailing updates without retaining old levels', () => {
    const result = resolveTradePresentation({
      mode: 'live', symbol: 'BTCUSDT', paper: live({
        positions: { BTCUSDT: position({ sl: 105, tp: 130, trailingSl: true, trailingBest: 115 }) },
      }), replay: replay(),
    });
    expect(result.position).toMatchObject({ sl: 105, tp: 130, trailingSl: true, trailingBest: 115 });
  });

  it('derives partial-close widget values from the remaining authoritative quantity', () => {
    const result = resolveTradePresentation({
      mode: 'replay', symbol: 'BTCUSDT', paper: live(), replay: replay({ position: position({ units: 0.5, entryPrice: 100, leverage: 10 }) }),
    });
    const view = deriveActivePosition(result.position!, 110, 20_000);
    expect(view).toMatchObject({ qty: 0.5, pnlUsd: 5, marginUsed: 5, stopLoss: 90, takeProfit: 120, trailing: true });
  });
});