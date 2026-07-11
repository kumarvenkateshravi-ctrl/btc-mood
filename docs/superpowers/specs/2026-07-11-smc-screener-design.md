# SMC-Screener — Design & Build Plan

**Date:** 2026-07-11 · **Status:** Approved (user + advisor refinements in `updatenew.md`)
**Sources:** `~/Downloads/newTask.md` (12-step institutional workflow), `~/Downloads/updatenew.md` (gate-based refinements). Consumes the SMC Intelligence Engine (spec 2026-07-11-smc-intelligence-engine-design.md) — **engine untouched**.

## 1. What it is

A **gate-based decision engine** + checklist UI ("SMC Screener" view in `/technical-scanner`) that evaluates the full institutional workflow and tells the trader: the narrative (headline), the status, the score, what's missing, and the trade plan. Never a bare BUY/SELL.

## 2. Engine — `lib/smc/screener.ts` (headless, pure)

```ts
evaluateSmcScreener(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
  config?: Partial<ScreenerConfig>,
): ScreenerReport
```

### Pipeline (advisor's shape)

```
HARD GATES (sequential; any fail ⇒ NO_TRADE + blockingReason)
  Gate 1 Trend        — MTF EMAs: 1d EMA200, 4h EMA200, 1h EMA50>200, 15m EMA20>50
                        (direction = weighted majority, daily ×2; tie ⇒ null ⇒ NO_TRADE)
  Gate 2 Structure    — CHoCH in direction, then BOS after it (evalTf SMC snapshot);
                        swingTrend agreement as informational item
  Gate 3 Liquidity    — opposite-side sweep confirmed within lookback;
                        target-side pool ahead (warn-only, feeds trade plan)
  Gate 4 Order Block  — best aligned live OB: state active|tested, strength ≥ 80, age ≤ 50
CONTEXT LAYER (soft — affect score/quality only)
  Momentum   — RSI>55 (long) / <45 (short); MACD line>signal; ADX>25
  Volatility — ATR(14) rising vs its SMA(10); BB(20,2) width expanding; volume spike >1.5×SMA20
  FVG        — aligned unfilled gap; bonus item: overlaps the chosen OB
  Zone       — long ⇒ discount, short ⇒ premium
  Volume     — vol > SMA20; pressure candle in direction; delta = na (future)
TRADE PLAN (only when all hard gates pass)
  entry = OB price-facing edge; stop = beyond OB ± 0.1×ATR;
  target = nearest opposing active pool beyond entry, else trailing extreme;
  rr; items: stop ≤ 2%, RR ≥ 3; quality ★1–5 = f(score, RR)
DECISION (status is INDEPENDENT of score)
  NO_TRADE  — direction null or any hard gate failed
  WATCH     — gates pass, price far from entry
  BUILDING  — price within 2×ATR of entry
  READY     — price inside the OB band (retest)
  CONFIRMED — READY + directional event (BOS/CHoCH/sweep) on the latest bar
```

### Report contract

```ts
interface ScreenerItem { id: string; label: string; status: 'pass'|'fail'|'warn'|'na'; detail?: string }
interface ScreenerGroup { id: string; name: string; weight: number; items: ScreenerItem[]; score: number; pass: boolean }
interface TradePlan { entry: number; stop: number; target: number; rr: number; targetLabel: string; quality: 1|2|3|4|5 }
interface ScreenerReport {
  direction: 'long'|'short'|null;
  status: 'NO_TRADE'|'WATCH'|'BUILDING'|'READY'|'CONFIRMED';
  score: number;                    // weighted 0–100, always computed (separate from status)
  narrative: string[];              // headline sentences (institutional story)
  hardGates: ScreenerGroup[];       // Trend, Structure, Liquidity, OrderBlock
  contextChecks: ScreenerGroup[];   // Momentum, Volatility, FVG, Zone, Volume
  blockingReason: string | null;    // first failed hard gate, phrased as advice
  missing: string[];                // conditions preventing advancement (actions, not errors)
  progress: number;                 // 0–100: passed items / evaluable items
  tradePlan: TradePlan | null;
}
```

- All groups are always evaluated (score + missing-list need the full picture); *status* short-circuits on the first hard-gate failure.
- Insufficient history for a check ⇒ item `na` (excluded from progress), never a hard fail.
- `ScreenerConfig`: `weights` (doc table: trend 20, structure 20, liquidity 15, momentum 10, volatility 10, orderBlock 10, fvg 5, zone 5, volume 5), `minObStrength 80`, `maxObAgeBars 50`, `minRR 3`, `maxStopPct 2`, `rsiBull 55`, `adxMin 25`, `volSpikeMult 1.5`, `approachAtrMult 2`, `lookbackBars 100`.
- Local pure helpers (ema/rsi/macd/adx/atr/sma/bbWidth) — Wilder variants, unit-tested; no dependency on indicator-framework plot shapes.

## 3. UI — `components/scanner/SmcScreenerPanel.tsx`

New "SMC Screener" view in `TechnicalScannerWorkstation` (header nav entry). Layout, top→bottom:
1. **Narrative headline** — the story sentences, then status pill (🔴 NO TRADE / ⚪ WATCH / 🟡 BUILDING / 🟢 READY / ✅ CONFIRMED) beside the independent score.
2. **Hard gates** — 4 groups with ✅/❌ and per-item detail; failed gate shows the blockingReason callout.
3. **Context layer** — 5 groups with ✅/⚠/☐.
4. **Missing conditions** — progress bar (`progress`) + action list.
5. **Trade plan card** — Entry / Stop / Target / RR / Quality stars (hidden while NO_TRADE).
Recompute cached on closed-bar signature of the evalTf series (indicator-tick-perf rule).

## 4. Tests — `lib/smc/screener.test.ts`

Synthetic `candlesByTf` scenarios (hand-checkable):
1. Full-confluence long ⇒ status ∈ {READY, CONFIRMED, BUILDING}, direction long, plan with RR>0, narrative non-empty.
2. No sweep ⇒ NO_TRADE, blockingReason mentions liquidity sweep, missing[] contains it, score still computed.
3. Bearish daily vs bullish LTF ⇒ direction short or NO_TRADE for longs (never long).
4. Gates pass but price far from OB ⇒ WATCH with high score (status/score independence).
5. Helper math: ema/rsi/adx/atr spot values on known series.

## 5. Build order

1. `lib/smc/screener.ts` + tests (engine, biggest piece)
2. Workstation nav + `SmcScreenerPanel.tsx`
3. Live verification on `/technical-scanner`, graphify, memory update
