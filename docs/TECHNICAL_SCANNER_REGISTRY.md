# Technical Scanner — Source Registry Documentation

Every source in `lib/scanner/registry.ts` MUST have a section here following this
template. The builder UI, validator, and evaluator are registry-driven: adding a
source = one registry entry + one section below. Nothing else changes.

## Template

```
### <Source Name> (`<id>`)
Group        standard | structure | intelligence
Inputs       <param id: type, default, range> (or "none — fixed defaults")
Outputs      <output id — meaning, units/range>
Operators    <allowed operator ids>
Evaluation   <one sentence: how the series is produced; cite the reused engine>
Example      <a condition a trader would write>
Supported TF 5m 15m 30m 1h 4h 1d
Notes        <warm-up bars, liveOnly caveats, etc.>
```

Engineering rules that bind every entry: closed-bar deterministic series; reuse the
existing engine (never re-implement math — Rule 2); null during warm-up (null never
triggers a condition).

---

### Price (`price`)
Group standard · Inputs none · Outputs `close`, `high`, `low` · Operators all ·
Evaluation raw candle fields · Example `Price close > VWAP` · TF all.

### EMA (`ema`) / SMA (`sma`)
Group standard · Inputs `length` (1–500; EMA default 20, SMA 50) · Outputs `value` ·
Operators all · Evaluation `pineMath.ema/sma` over closes · Example
`EMA(20) crossAbove EMA(50)` · TF all · Notes null for first `length−1` bars.

### RSI (`rsi`)
Group standard · Inputs none (14) · Outputs `rsi` (0–100) · Operators all ·
Evaluation `computeRsi` plot `rsi` · Example `RSI > 60` · TF all.

### MACD (`macd`)
Group standard · Inputs none (12/26/9) · Outputs `macd`, `signal`, `hist` ·
Operators all · Evaluation `computeMacd` plots · Example `MACD hist crossAbove 0` · TF all.

### VWAP (`vwap`)
Group standard · Inputs none · Outputs `vwap` · Operators all · Evaluation
`computeVwap` plot · Example `Price close crossAbove VWAP` · TF all.

### Supertrend (`supertrend`)
Group standard · Inputs none · Outputs `supertrend` (line price) · Operators all ·
Evaluation `computeSuperTrend` plot · Example `Price close > Supertrend` · TF all.

### ATR (`atr`)
Group standard · Inputs `length` (default 14) · Outputs `value` · Operators all ·
Evaluation Wilder ATR (`vdAtr`) · Example `ATR increasing` · TF all.

### ADX (`adx`)
Group standard · Inputs none (14) · Outputs `adx`, `plusDI`, `minusDI` · Operators all ·
Evaluation `computeAdx` plots · Example `ADX > 25 AND plusDI crossAbove minusDI` · TF all.

### Bollinger (`bollinger`)
Group standard · Inputs none (20, 2σ) · Outputs `upper`, `basis`, `lower` ·
Operators all · Evaluation `computeBollingerBands` plots · Example
`Price close crossBelow Bollinger lower` · TF all.

### Stochastic (`stochastic`)
Group standard · Inputs none (14) · Outputs `k`, `d` (0–100) · Operators all ·
Evaluation `computeStochastic` plots · Example `%K crossAbove %D` · TF all.

### Volume (`volume`) / Volume SMA (`volumeSma`)
Group standard · Inputs volumeSma: `length` (20) · Outputs `volume` / `value` ·
Operators all · Evaluation raw volume / `pineMath.sma` · Example
`Volume > VolumeSMA(20)` (spike ≈ `gt` with a multiplied constant) · TF all.

### OBV (`obv`)
Group standard · Inputs none · Outputs `obv` · Operators all · Evaluation
`computeObv` plot · Example `OBV increasing` · TF all.

### Market Structure (`structure`)
Group structure · Inputs none · Outputs `score` (0/25/50/75/100 — HH/HL vs LH/LL over
40 bars) · Operators all · Evaluation rolling 20v20-bar high/low comparison
(`structureScoreSeries`, same rule as the Context Engine's trend structure) ·
Example `Structure score >= 75` · TF all · Notes null for first 39 bars.

### VD Zone (`vdZone`)
Group structure · Inputs none (VD engine defaults D+4H) · Outputs `distanceAtr`
(ATRs to nearest healthy zone), `inside` (0/1), `confidence` (0–100) · Operators all ·
Evaluation `computeVdZoneObjects` zones, nearest active healthy zone per bar ·
Example `VD Zone inside = 1 AND VD Zone confidence > 60` · TF all.

### Trend / Momentum / Volume / Context Score (`trendScore`, `momentumScore`, `volumeScore`, `contextScore`)
Group intelligence · Inputs none · Outputs `score` (0–100, 50 = neutral) ·
Operators all · Evaluation vectorized per-bar blends using the Market Context
Engine's exact formulas and `DEFAULT_CONTEXT_CONFIG.weights`
(`lib/scanner/intelligenceSeries.ts`) · Example `Trend Score > 80 AND Momentum
Score > 75` · TF all · Notes warm-up follows the slowest constituent (~40 bars).

### Stack Score (`stackScore`) / MTF Alignment (`alignment`)
Group intelligence · Inputs none · Outputs `score` (0–100) · Operators comparisons +
between (no crosses — no history) · Evaluation **liveOnly**: cross-TF aggregates from
`lib/stackScore.ts` / `lib/alignment.ts`, published to the scanner at the live edge;
null on all historical bars · Example `Stack Score > 85` · TF all ·
Notes ⚠ no backtest coverage in v1 (validator warns); per-bar history arrives with
the context-snapshot phase.
