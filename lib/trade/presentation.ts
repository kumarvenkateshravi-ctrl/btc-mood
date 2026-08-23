import type { PaperPosition, PaperTrade } from '../paper';

export type ExecutionPresentationMode = 'live' | 'replay';

/** Structural snapshots keep presentation coupled to execution stores without
 * importing their React hooks or creating a second state owner. */
export interface PaperPresentationSnapshot {
  positions: Record<string, PaperPosition | null | undefined>;
  trades: PaperTrade[];
  balance: number;
  initialBalance: number;
}

export interface ReplayPresentationSnapshot {
  active: boolean;
  symbol: string;
  position: PaperPosition | null;
  trades: PaperTrade[];
  startBalance: number;
}

export interface TradePresentation {
  mode: ExecutionPresentationMode;
  symbol: string;
  position: PaperPosition | null;
  trades: PaperTrade[];
  balance: number;
  initialBalance: number;
}

/**
 * The sole mode-and-symbol boundary for trading presentation. A replay view
 * deliberately returns an empty account if its session is not active for the
 * requested symbol. That prevents any live position, overlays, or history from
 * surviving a mode/symbol transition.
 */
export function resolveTradePresentation(input: {
  mode: ExecutionPresentationMode;
  symbol: string;
  paper: PaperPresentationSnapshot;
  replay: ReplayPresentationSnapshot;
}): TradePresentation {
  const { mode, symbol, paper, replay } = input;
  if (mode === 'replay') {
    if (!replay.active || replay.symbol !== symbol) {
      return { mode, symbol, position: null, trades: [], balance: 0, initialBalance: 0 };
    }
    const trades = replay.trades.filter((trade) => trade.symbol === symbol);
    return {
      mode,
      symbol,
      position: replay.position?.side === 'flat' ? null : replay.position,
      trades,
      balance: replay.startBalance + trades.reduce((total, trade) => total + trade.realizedPnl, 0),
      initialBalance: replay.startBalance,
    };
  }

  return {
    mode,
    symbol,
    position: paper.positions[symbol]?.side === 'flat' ? null : paper.positions[symbol] ?? null,
    trades: paper.trades.filter((trade) => trade.symbol === symbol),
    balance: paper.balance,
    initialBalance: paper.initialBalance,
  };
}
