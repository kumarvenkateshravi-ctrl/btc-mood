# M1.x — Intelligence Models for RSI, MACD, ADX, Supertrend, OBV, Volume

**Date:** 2026-07-18 · **Status:** Approved & frozen (user-reviewed in-session)
**Builds on:** M1 spec (`2026-07-18-m1-indicator-intelligence-contract-ema-engine-design.md`), EMA engine (`lib/mtf/indicators/ema.ts`)

Migrate the six remaining indicators into `lib/mtf/indicators/` with full indicator-local
intelligence, designed upfront and frozen here. **Zero observable scoring change.**

## Shared rules (all six, same as EMA)

- **Parity:** each module keeps its M0 score/display logic **verbatim** (including quirks:
  MACD equality → 0, Supertrend equality → 0, OBV `typeof === 'number'` prev check).
  `score`/`display`/`verdict`/composite byte-identical; parity test per module +
  `computeTfCells` registry parity stays.
- **Dimension grammar:** directional dims center at 50 (conviction `conv(x)=|x−50|·2`);
  magnitude dims 0→100 (0 = no evidence).
- **Neutral:** insufficient data → directional 50, magnitude 0, freshness-like 50.
- **Confidence/Strength:** built from the diagnostics object only; weights exported
  `<ID>_CONFIDENCE_WEIGHTS` / `<ID>_STRENGTH_WEIGHTS`, each sums 1.0; rounded, clamped.
- **Hygiene:** `EPS = 1e-9` snap on ratios/slopes (relative tol for OBV's large magnitudes).
- **States via signal codes** — no new contract fields.
- **Settings:** RSI/MACD/ADX/Supertrend keep `(candles, settings?)` with the same
  `compute*(candles, settings && { id, settings })` invocation; OBV/Volume candles-only;
  `subFor` stays in `definitions.ts`.
- **Perf:** one `compute*()` per evaluation + single linear scans of plot arrays.
- **Structure:** `lib/mtf/indicators/shared.ts` (clamp/conv/EPS/plot-value helpers);
  `ema.ts` refactored to import them (behavior unchanged); `definitions.ts` ends as a
  pure thin registry (metadata + one-line delegation ×7).

## RSI (momentum) — frozen: `clamp(rsi,0,100)`, null→50, display `rsi.toFixed(1)`/'—'

| Dim | Type | Formula |
|---|---|---|
| `position` | dir | RSI value (≡ frozen score) |
| `zone` | dir | ≥70→100 · ≥60→70 · ≥40→50 · ≥30→30 · <30→0 |
| `momentum` | dir | `50 + ΔRSI(RSI_MOM_LOOKBACK=5 finite steps) · RSI_MOM_GAIN=2`, clamped; <RSI_MOM_LOOKBACK+1 finite values→50 |

Confidence: position .50 / momentum .30 / zone .20 (all conv). Strength: conv(position) .60 / conv(momentum) .40.
Signals: `RSI_OVERBOUGHT` "RSI Overbought" (zone=100, strong) · `RSI_OVERSOLD` "RSI Oversold" (zone=0, strong) · `RSI_BULLISH_MOMENTUM` "RSI Rising With Bullish Bias" (position≥60 ∧ momentum≥60, info) · `RSI_BEARISH_MOMENTUM` "RSI Falling With Bearish Bias" (position≤40 ∧ momentum≤40, info).
Warnings: `RSI_FLAT` "RSI Flat Near Midline" (40<position<60 ∧ |momentum−50|<10) · `RSI_FADING` "RSI Momentum Fading" (position≥60 ∧ momentum≤40, or position≤40 ∧ momentum≥60).

## MACD (momentum) — frozen: `macd > signal ? 100 : 0` (equality→0), null→50, label display

| Dim | Type | Formula |
|---|---|---|
| `crossState` | dir | m>s→100 · m<s→0 · =→50 |
| `histMomentum` | dir | per-diff score over last `MACD_HIST_LOOKBACK=5` histogram diffs (hist=m−s per bar, finite pairs): rising 1 · flat(≤EPS) 0.5 · falling 0 → mean·100; no diffs→50 |
| `zeroLine` | dir | m>0∧s>0→100 · m<0∧s<0→0 · m>0→65 · m<0→35 · else 50 |
| `separation` | mag | `|m−s| / max(|m|,|s|,EPS)` /`MACD_SEP_SAT=1`·100, clamped, EPS-snap |

Confidence: crossState .40 / histMomentum .25 / zeroLine .20 (conv) / separation .15. Strength: conv(crossState) .40 / separation .30 / conv(histMomentum) .30.
Signals: `MACD_BULLISH` "MACD Bullish Above Zero" (cross=100 ∧ zeroLine≥65, strong) · `MACD_BEARISH` "MACD Bearish Below Zero" (cross=0 ∧ zeroLine≤35, strong) · `MACD_HIST_RISING` "MACD Histogram Rising" (≥70, info) · `MACD_HIST_FALLING` "MACD Histogram Falling" (≤30, info) · `MACD_WIDE_SEPARATION` "Wide MACD Separation" (≥70, info).
Warnings: `MACD_COMPRESSION` "MACD Lines Converging" (separation≤20) · `MACD_ZERO_STRADDLE` "MACD Straddling Zero Line" (zeroLine ∈ {35,65}).

## ADX (strength) — frozen: `50 + (+DI≥−DI ? 1 : −1)·clamp(adx,0,50)`, null→50, display `adx.toFixed(1)`/'—'

| Dim | Type | Formula |
|---|---|---|
| `trendStrength` | mag | `clamp(adx,0,50)·2`; null→0 |
| `direction` | dir | +DI>−DI→100 · <→0 · =→50 |
| `diSpread` | mag | `|+DI−−DI|/(+DI+−DI+EPS)` /`ADX_SPREAD_SAT=0.5`·100, clamped, EPS-snap; nulls→0 |
| `adxMomentum` | dir | `50 + Δadx(ADX_MOM_LOOKBACK=5 finite steps)·ADX_MOM_GAIN=4`, clamped, EPS-snap; insufficient→50 |

Confidence: trendStrength .35 / conv(direction) .25 / diSpread .25 / conv(adxMomentum) .15. Strength: trendStrength .50 / diSpread .30 / conv(adxMomentum) .20.
Signals: `ADX_STRONG_TREND` "Strong Trend (ADX ≥ 25)" (adx≥25, strong) · `ADX_VERY_STRONG` "Very Strong Trend (ADX ≥ 40)" (adx≥40, strong) · `ADX_BUILDING` "Trend Strength Building" (adxMomentum≥70, info) · `ADX_DI_DOMINANT` "DI Lines Strongly Separated" (diSpread≥70, info).
Warnings: `ADX_WEAK` "Weak or Absent Trend" (adx<20, incl. null→skip) · `ADX_FADING` "Trend Strength Fading" (adxMomentum≤30) · `ADX_DI_TANGLE` "DI Lines Entangled" (diSpread≤15 ∧ DIs present).

## Supertrend (trend) — frozen: `close > line ? 100 : 0` (equality→0), null line→50, label display

| Dim | Type | Formula |
|---|---|---|
| `side` | dir | close>line→100 · <→0 · =→50 |
| `distance` | mag | `|close−line|/close·100` /`ST_DIST_SAT=3`·100, clamped, EPS-snap; null/close≤0→0 |
| `flipFreshness` | mag | bars since last sign flip of (close−line): none→50 · `clamp(100−bars·ST_FRESH_DECAY=4, ST_FRESH_FLOOR=20, 100)` |
| `persistence` | mag | share of last `ST_PERSIST_LOOKBACK=20` finite-line bars on current side ·100; no side→50 |

Confidence: conv(side) .35 / distance .25 / persistence .25 / flipFreshness .15. Strength: distance .40 / persistence .40 / conv(side) .20.
Signals: `ST_BULLISH` "Price Above Supertrend" (side=100, strong) · `ST_BEARISH` "Price Below Supertrend" (side=0, strong) · `ST_FRESH_FLIP` "Fresh Supertrend Flip" (freshness≥70, info) · `ST_WIDE_BUFFER` "Wide Buffer To Supertrend" (distance≥70, info) · `ST_PERSISTENT` "Sustained Supertrend Side" (persistence≥85, info).
Warnings: `ST_NEAR_FLIP` "Price Near Supertrend Line" (distance≤15 ∧ line present) · `ST_CHOPPY` "Frequent Supertrend Flips" (persistence≤60).

## OBV (volume) — frozen: last vs `obv[max(0,len−15)]` (`typeof === 'number'` check): >→100 · <→0 · =/null→50, label display

| Dim | Type | Formula |
|---|---|---|
| `trend` | dir | ≡ frozen comparison (100/0/50) |
| `consistency` | mag | last ≤15 diffs of finite OBV values, per-diff rising 1 / flat 0.5 / falling 0 → `|mean−0.5|·200`; <2 diffs→0 |
| `acceleration` | dir | vals[last]−vals[last−7] vs vals[last−7]−vals[last−15] (needs ≥16 finite): faster→100 · slower→0 · ≈(rel-EPS)→50; else 50 |

Confidence: conv(trend) .50 / consistency .30 / conv(acceleration) .20. Strength: consistency .60 / conv(trend) .40.
Signals: `OBV_RISING` "OBV Rising" (trend=100, strong) · `OBV_FALLING` "OBV Falling" (trend=0, strong) · `OBV_ONE_SIDED_FLOW` "Consistent Volume Flow" (consistency≥70, info) · `OBV_ACCELERATING` "Volume Flow Accelerating" (acceleration=100, info).
Warnings: `OBV_CHOPPY_FLOW` "Choppy Volume Flow" (consistency≤30) · `OBV_DECELERATING` "Volume Flow Slowing" (acceleration=0 ∧ trend≠50).

## Volume (volume) — frozen: `volPct=(last/SMA20−1)·100` (SMA null/0→0), `clamp(50+volPct/2)`, display `±N%`

| Dim | Type | Formula |
|---|---|---|
| `pressure` | dir | ≡ frozen score |
| `surge` | mag | volPct>0 → `clamp(volPct/VOL_SURGE_SAT=150·100)`, EPS-snap; else 0 |
| `trend` | dir | `50 + (SMA5/SMA20−1)·100·VOL_TREND_GAIN=1`, clamped, EPS-snap; SMAs missing/0→50 |

Confidence: conv(pressure) .40 / surge .30 / conv(trend) .30. Strength: surge .50 / conv(trend) .30 / conv(pressure) .20.
Signals: `VOL_SPIKE` "Volume Spike" (surge≥70, strong) · `VOL_ABOVE_AVERAGE` "Volume Above Average" (volPct≥25, info) · `VOL_RISING_PARTICIPATION` "Rising Participation" (trend≥65, info).
Warnings: `VOL_DRY_UP` "Volume Dry-Up" (volPct≤−50) · `VOL_BELOW_AVERAGE` "Volume Below Average" (−50<volPct≤−25) · `VOL_FADING_PARTICIPATION` "Fading Participation" (trend≤35).

## Testing & acceptance

- Six test files: frozen-score parity per module, dim ranges/values on fixtures,
  signal/warning triggers, edge (empty/short/null), determinism.
- `registry.test.ts`: placeholder semantics move to a bare stub indicator; all seven
  roster results assert populated diagnostics; `computeTfCells` parity unchanged.
- Full suite green, `tsc` no new errors, only `lib/mtf/**` + these docs touched.
