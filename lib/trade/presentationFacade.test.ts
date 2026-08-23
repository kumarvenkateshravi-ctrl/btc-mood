import { describe, expect, it } from 'vitest';
import { deriveTradePresentationFacade, equalPaperPresentationSlice, equalReplayPresentationSlice, selectPaperPresentationSlice, selectReplayPresentationSlice } from './presentationFacade';
import type { PaperPosition, PaperTrade } from '../paper';
import type { PaperStorePresentationState } from './presentationFacade';
import type { ReplaySessionState } from '../replaySession';

const position = (side: 'long' | 'short' = 'long'): PaperPosition => ({
  id: 'p1', symbol: 'BTCUSDT', side, units: 1, entryPrice: 100, realizedPnl: 0, feesPaid: 0,
  sl: 90, tp: 120, liquidated: false, leverage: 1, trailingSl: false, trailingBest: null,
  openedAt: 1,
});

const trade = (symbol: string, id: string): PaperTrade => ({
  id, positionId: 'p1', symbol, side: 'buy', units: 1, price: 110, fee: 0,
  realizedPnl: 10, ts: 2, direction: 'long', entryPrice: 100, exitPrice: 110,
});

const paper = (overrides: Partial<PaperStorePresentationState> = {}): PaperStorePresentationState => ({
  positions: { BTCUSDT: position() },
  trades: [trade('BTCUSDT', 't1'), trade('ETHUSDT', 't2')],
  balance: 1_010,
  initialBalance: 1_000,
  ...overrides,
});

const replay = (overrides: Partial<ReplaySessionState> = {}): ReplaySessionState => ({
  active: true, symbol: 'BTCUSDT', position: position(), trades: [trade('BTCUSDT', 'r1')],
  startBalance: 1_000, config: null, pendingSl: null, pendingTp: null,
  openBehavior: null, behaviors: [], ...overrides,
});

describe('active chart presentation facade', () => {
  it('uses only the current symbol and active execution mode', () => {
    const live = deriveTradePresentationFacade({ mode: 'live', symbol: 'BTCUSDT', markPrice: 111, markTrusted: true, paper: paper(), replay: replay() });
    expect(live.position?.symbol).toBe('BTCUSDT');
    expect(live.trades).toHaveLength(1);
    expect(live.markPrice).toBe(111);

    const replayView = deriveTradePresentationFacade({ mode: 'replay', symbol: 'BTCUSDT', markPrice: 111, markTrusted: true, paper: paper({ balance: 9 }), replay: replay() });
    expect(replayView.position?.symbol).toBe('BTCUSDT');
    expect(replayView.balance).toBe(1_010);
  });

  it('never falls back to live state for a wrong-symbol or inactive replay', () => {
    const result = deriveTradePresentationFacade({ mode: 'replay', symbol: 'ETHUSDT', markPrice: 200, markTrusted: false, paper: paper(), replay: replay() });
    expect(result.position).toBeNull();
    expect(result.trades).toEqual([]);
    expect(result.balance).toBe(0);
    expect(result.markPrice).toBeNull();
  });

  it('keeps selected slices stable when unrelated store fields change', () => {
    const basePaper = { ...paper(), lastError: null };
    const firstPaper = selectPaperPresentationSlice(basePaper, 'BTCUSDT');
    const secondPaper = selectPaperPresentationSlice({ ...basePaper, lastError: 'unrelated' }, 'BTCUSDT');
    expect(secondPaper.position).toBe(firstPaper.position);
    expect(equalPaperPresentationSlice(firstPaper, secondPaper)).toBe(true);

    const baseReplay = replay();
    const firstReplay = selectReplayPresentationSlice(baseReplay, 'BTCUSDT');
    const secondReplay = selectReplayPresentationSlice({ ...baseReplay, pendingSl: 90 }, 'BTCUSDT');
    expect(secondReplay.position).toBe(firstReplay.position);
    expect(equalReplayPresentationSlice(firstReplay, secondReplay)).toBe(true);
  });

  it('updates remaining size, reversal and flat state from the authoritative position', () => {
    const reduced = deriveTradePresentationFacade({ mode: 'live', symbol: 'BTCUSDT', markPrice: 105, markTrusted: true, paper: paper({ positions: { BTCUSDT: { ...position(), units: 0.25 } } }), replay: replay() });
    expect(reduced.position?.units).toBe(0.25);

    const reversed = deriveTradePresentationFacade({ mode: 'live', symbol: 'BTCUSDT', markPrice: 105, markTrusted: true, paper: paper({ positions: { BTCUSDT: position('short') } }), replay: replay() });
    expect(reversed.position?.side).toBe('short');

    const flat = deriveTradePresentationFacade({ mode: 'live', symbol: 'BTCUSDT', markPrice: 105, markTrusted: true, paper: paper({ positions: { BTCUSDT: null } }), replay: replay() });
    expect(flat.position).toBeNull();
  });
});
