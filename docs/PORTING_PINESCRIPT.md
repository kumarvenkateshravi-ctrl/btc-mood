# Porting PineScript Indicators to TypeScript

We build our indicator library by hand-porting TradingView PineScript into native
TypeScript that conforms to `lib/indicatorFramework.ts` (see
`lib/indicators/squeezeMomentum.ts` for the reference port). This is the right
approach for a curated, fast, auditable first-party library — but a port that
*looks* right on a chart can still disagree with TradingView by enough to flip a
signal. That silent divergence is the worst failure mode for a trading tool.

**Rule: every ported indicator ships with a golden-master test.** No exceptions.

---

## 1. The golden-master harness

Located in `lib/testing/goldenMaster.ts`. A *fixture* pins a fixed set of candles
+ parameters to the expected output (plot values and signals), and the test
re-computes and compares within a tolerance.

Two fixture provenances (`source` field):

| `source` | Where expected values come from | What it proves |
|----------|---------------------------------|----------------|
| `tradingview` | Captured from TradingView for the same candles | **Correctness** — the port matches the source |
| `snapshot` | Generated from our own implementation | **Regression only** — output hasn't drifted since baseline |

A snapshot is a placeholder. It catches "someone changed the code and the numbers
moved," but it can NOT tell you the original port was right. Upgrade to a
`tradingview` fixture as soon as you can capture data (Section 4).

### Copy this test for every indicator

See `lib/indicators/squeezeMomentum.golden.test.ts`. The skeleton:

```ts
import { computeMyIndicator } from './myIndicator';
import { makeDeterministicCandles } from '../testing/syntheticCandles';
import {
  compareIndicator, loadFixture, saveFixture,
  buildSnapshotFixture, fixtureExists, formatGoldenReport,
} from '../testing/goldenMaster';

const NAME = 'myIndicator';
const PARAMS = { /* … */ };

it('matches the committed fixture', () => {
  if (process.env.UPDATE_GOLDEN === '1' || !fixtureExists(NAME)) {
    const candles = makeDeterministicCandles(150, 7);
    saveFixture(NAME, buildSnapshotFixture({
      indicator: NAME, params: PARAMS, candles,
      result: computeMyIndicator(candles, PARAMS),
    }));
  }
  const fx = loadFixture(NAME);
  const report = compareIndicator(computeMyIndicator(fx.candles, fx.params), fx);
  expect(report.ok, formatGoldenReport(report)).toBe(true);
  expect(report.checked).toBeGreaterThan(0);
});
```

### Record / refresh a baseline

```bash
UPDATE_GOLDEN=1 npx vitest run myIndicator.golden
```

Only do this for `snapshot` baselines, or when you have *deliberately* changed an
indicator and verified the new numbers against TradingView. Never blindly refresh
a failing golden test — that defeats the entire point.

Fixtures live in `lib/testing/fixtures/<name>.golden.json` and are committed.

---

## 2. The pitfalls checklist (port-review gate)

These are the PineScript semantics an LLM (or a human) most often gets subtly
wrong. Check every one before opening the port for review.

- [ ] **Moving-average family.** `ta.rsi`, `ta.atr`, `ta.adx` use **Wilder's RMA**
      (`pineMath.rma`), *not* SMA or EMA. Mixing these up is the #1 silent bug.
      Use `pm.rma` for anything Wilder-based, `pm.ema` only where Pine says `ta.ema`.
- [ ] **`ta.stdev` is population (biased)** — divides by `N`, not `N-1`. Our
      `pm.stdev` already does this; don't "fix" it to sample stdev.
- [ ] **`na` handling & warm-up.** Pine emits `na` until an indicator has enough
      bars. Our convention is leading `null`. Make sure your warm-up boundary
      matches Pine's exactly (off-by-one here shifts every value). `pad()` and the
      `pm.*` helpers preserve `null` — don't accidentally coerce `null` to `0`.
- [ ] **History operator `[n]`.** `close[1]` is the *previous bar's* close. Use
      `pm.ref(arr, n)` or explicit `arr[i-1]`, and guard `i-n >= 0`.
- [ ] **`var` persistence.** A `var` declared variable keeps its value across bars
      and only initializes once. Model it as state carried in your bar loop, not a
      value recomputed each bar.
- [ ] **`nz(x)` / `nz(x, y)`** replaces `na` with `0` (or `y`). Don't let a `null`
      silently propagate where Pine would have substituted a default.
- [ ] **`math.avg(a, b)` is `(a+b)/2`.** Nested `math.avg(math.avg(a,b),c)` =
      `(a+b)/2` then `(…+c)/2` = `(a+b+2c)/4`. Write the closed form to avoid
      confusion (see squeezeMomentum's `midlineDirect`).
- [ ] **`ta.linreg(src, len, offset)`** projects the regression `offset` bars past
      the window — use `pm.linreg`, don't hand-roll.
- [ ] **`request.security()` (multi-timeframe).** Beware lookahead/repaint. By
      default Pine returns the *developing* HTF value with `barmerge.lookahead_off`.
      If you port an MTF indicator, document and test the repaint behavior explicitly.
- [ ] **Cumulative / session-reset functions** (`ta.vwap`, `ta.cum`) reset on a
      session or anchor. Make the anchor explicit.
- [ ] **Color / `plotshape` / `bgcolor` are cosmetic.** The golden harness ignores
      color and compares only numeric values + signals. Encode signals via the
      `signals` array, not via color.
- [ ] **Precision & tolerance.** Default tolerance is `abs 1e-6, rel 1e-4`. If a
      port needs a looser tolerance to pass against TradingView, that is a smell —
      investigate before widening it. Widen only with a written justification in the
      fixture's `note`.
- [ ] **Series length.** Every plot array maps 1:1 with the input candles.

---

## 3. Indicator authoring conventions

- One file per indicator in `lib/indicators/`, exporting a
  `IndicatorComputeFn`-compatible function.
- Pluck only the params you understand from the config; ignore the rest (the
  framework passes a broad `CustomIndicatorConfig`).
- Put the original PineScript source (and `//@version`) in a header comment so the
  port is auditable against its origin.
- Use `lib/pineMath.ts` for all TA math. If a Pine built-in is missing, add it to
  `pineMath.ts` *with its own unit test*, don't inline it.

---

## 4. Capturing a TradingView (`tradingview`) fixture

This turns a snapshot baseline into a true correctness check.

1. **Match the candles.** The fixture's `candles` must be the exact bars
   TradingView computed on. Easiest path: export real Binance candles for a fixed
   symbol/timeframe/time-range, commit them as the fixture's `candles`, and load
   the *same* range in TradingView. (Synthetic candles can't be reproduced inside
   TradingView, so `tradingview` fixtures must use real OHLC.)
2. **Match the params.** Set the indicator's inputs in TradingView to exactly the
   fixture `params`.
3. **Read the expected values.** Hover bars and read TradingView's **Data Window**
   (the values panel), or add `plot()`/`plotchar()` lines and use *Export chart
   data…* to get a CSV. You only need a representative subset — e.g. the last
   30–50 bars plus any bar where a signal fires.
4. **Fill `expected`.** Set `source: 'tradingview'`, `capturedAt`, a `note` with
   the TradingView Pine version, and put the values under
   `expected.plots[plotId][barIndex]` (sparse is fine) and `expected.signals`.
5. Run `npx vitest run <name>.golden` — it should pass without `UPDATE_GOLDEN`.

If it fails, the harness prints exactly which bar/plot diverged and by how much
(`formatGoldenReport`) — that's your port bug, found before a user trades on it.

---

## 5. When a separate agent does the port

If an automated agent ports indicators, the port isn't done until:
1. it conforms to the `lib/indicatorFramework.ts` interface,
2. it ships a `*.golden.test.ts` using the harness, and
3. the pitfalls checklist (Section 2) has been verified.

Consistency and verification are the whole point — without (2) and (3) you
accumulate subtly-inconsistent indicators with no proof any of them match.
