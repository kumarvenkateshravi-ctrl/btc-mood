// Trade Readiness (Strategy Studio M1) — the Intelligence home's one-glance
// answer to "Should I trade today?". A weighted blend of the SMC screener's
// institutional score, its confluence, the Stack Score (aligned with the
// bias direction) and hard-gate completion. Pure; UI renders it as a % plus
// a ★ bias recommendation with the counter-trend line.

export interface TradeReadinessInput {
  /** SMC screener weighted score, 0–100. */
  institutional: number;
  /** SMC screener confluence, 0–100. */
  confluence: number;
  /** Stack Score (market context), 0–100 where >50 leans bullish. */
  stackScore: number;
  direction: 'long' | 'short' | null;
  gatesPassed: number;
  gatesTotal: number;
}

export interface TradeReadiness {
  /** 0–100. */
  readiness: number;
  bias: 'long' | 'short' | null;
  /** 1–5 for the recommended side. */
  stars: 1 | 2 | 3 | 4 | 5;
  /** 1–5 for the counter-trend side (never above the recommended side). */
  counterStars: 1 | 2 | 3 | 4 | 5;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeTradeReadiness(input: TradeReadinessInput): TradeReadiness {
  const { institutional, confluence, stackScore, direction, gatesPassed, gatesTotal } = input;

  // Stack Score measures bullishness; align it with the recommended side so
  // "92 readiness SHORT" can exist in a capitulating market.
  const alignedStack = direction === 'long' ? stackScore : direction === 'short' ? 100 - stackScore : 50;
  const gateScore = gatesTotal > 0 ? (gatesPassed / gatesTotal) * 100 : 0;

  const readiness = clamp(
    0.45 * institutional + 0.25 * alignedStack + 0.15 * confluence + 0.15 * gateScore,
  );

  const stars = (readiness >= 85 ? 5 : readiness >= 70 ? 4 : readiness >= 55 ? 3 : readiness >= 40 ? 2 : 1) as TradeReadiness['stars'];
  // Counter-trend conviction shrinks as the primary bias strengthens, and can
  // never exceed the recommended side.
  const counterStars = Math.min(6 - stars, stars) as TradeReadiness['counterStars'];

  return { readiness, bias: direction, stars, counterStars };
}
