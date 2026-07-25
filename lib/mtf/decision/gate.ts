// M9 — board gate. First-match no-trade check anchored ENTIRELY on the Board's
// direction (Arch v2): the Board is the sole direction authority, M9 defers to
// it and never second-guesses bullish/bearish/neutral itself. Structural/pricing
// rungs (insufficient_data / insufficient_structure / rr_too_low) are composed
// by the orchestrator after pricing. M5-M8 quality/risk/lifecycle no longer gate
// action at all — they only cap riskTier (see riskTier.ts).

import { BOARD_CONFIG } from '../board/config';
import type { BoardDecision } from '../board/boardTypes';
import type { GateResult } from './decisionTypes';

export function boardGate(board: BoardDecision): GateResult {
  if (board.direction === 'no_trade') {
    const reason = board.bias === 'neutral'
      ? 'board bias is neutral — no directional edge'
      : `board conviction ${board.conviction}% is below the ${BOARD_CONFIG.minConviction}% minimum`;
    return { passed: false, blockedBy: 'board_no_trade', reason };
  }
  return {
    passed: true, blockedBy: null,
    reason: `board direction ${board.direction} at ${board.conviction}% conviction`,
  };
}
