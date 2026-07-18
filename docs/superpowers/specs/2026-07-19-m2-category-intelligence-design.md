# M2 — Category Intelligence Engine

**Date:** 2026-07-19 · **Status:** Approved & frozen (MTFM2.md brief + MTFM2Enhnce1.md review applied)
**Builds on:** M1 indicator intelligence (`lib/mtf/intelligence.ts`, `lib/mtf/indicators/*`)

M1 answers "what does each indicator think?"; M2 answers "what does each market
category think?". Fully deterministic, no AI, **no Market Confidence** (M3 owns it),
**no UI** — nothing consumes `CategoryResult` yet. Once shipped, M2's architecture is
frozen until a future major version.

## Layering rule

M2 consumes **only** M1 output (`IndicatorResult[]` from the registry) — no candles,
no recomputation, no cross-category dependencies (each category is independently
computable from indicators alone; M3 is the aggregation layer).

## Contract (`lib/mtf/categoryTypes.ts`)

```ts
export type CategoryId = 'trend' | 'momentum' | 'volume' | 'volatility' | 'quality' | 'participation';

// Typed state unions (MTFM2Enhnce1 #1) — snake_case, no free strings.
export type TrendState = 'strong_bullish' | 'bullish' | 'ranging' | 'bearish' | 'strong_bearish';
export type MomentumState = 'overheated' | 'fading' | 'accelerating' | 'bullish' | 'bearish' | 'flat';
export type VolumeState = 'quiet' | 'buying_pressure' | 'selling_pressure' | 'balanced';
export type VolatilityState = 'expanding' | 'compressed' | 'normal';
export type QualityState = 'healthy' | 'developing' | 'weak' | 'choppy';
export type ParticipationState =
  | 'weak_participation' | 'strong_buying_interest' | 'buying_interest'
  | 'selling_interest' | 'strong_selling_interest' | 'neutral';
export type CategoryState =
  TrendState | MomentumState | VolumeState | VolatilityState | QualityState | ParticipationState;

/** Marker base — each category owns its concrete diagnostics shape. */
export interface CategoryDiagnostics {}

/** Dedicated category signal (MTFM2Enhnce1 #2) — NOT an alias of IndicatorSignal. */
export interface CategorySignal {
  code: string;                                // e.g. 'TREND_STRONG'
  message: string;
  severity: 'info' | 'warning' | 'strong';
  category: CategoryId;
  /** Indicator ids that produced the evidence (traceability, MTFM2Enhnce1 #3). */
  source: string[];
  timestamp?: number;
}

export interface CategoryResult<S extends CategoryState = CategoryState> {
  id: CategoryId;
  /** Directional 0–100 (50 neutral). ALWAYS 50 for non-directional categories
   *  (volatility, quality) — their intensity lives in `strength`. */
  score: number;
  verdict: Verdict;                            // verdictOf(score)
  /** CATEGORY-local confidence 0–100 (M3 aggregates to market level). */
  confidence: number;
  /** Direction-independent quality/intensity 0–100. */
  strength: number;
  state: S;
  /** Indicator ids this category consumes (MTFM2Enhnce1 #3). */
  contributors: string[];
  diagnostics: CategoryDiagnostics;
  signals: CategorySignal[];
  warnings: CategorySignal[];
}

export interface CategoryEngineResult {
  /** Data-schema version only (git owns code history) — MTFM2Enhnce1 #4. */
  schemaVersion: 1;
  categories: {                                // Record, not array (MTFM2Enhnce1 #5)
    trend: CategoryResult<TrendState>;
    momentum: CategoryResult<MomentumState>;
    volume: CategoryResult<VolumeState>;
    volatility: CategoryResult<VolatilityState>;
    quality: CategoryResult<QualityState>;
    participation: CategoryResult<ParticipationState>;
  };
}
```

**Engine (`lib/mtf/categoryEngine.ts`):** `computeCategoryIntelligence(indicators:
IndicatorResult[]): CategoryEngineResult` — builds an id→result map, calls the six
independent module evaluators, assembles the typed Record. Exports
`CATEGORY_CONTRIBUTORS: Record<CategoryId, string[]>` and `CATEGORY_SCHEMA_VERSION = 1`.
No dynamic registry class: the typed Record contract fixes the roster; a dynamic
registry would erase per-key state types (deliberate deviation from the MTFM2 step-8
sketch, superseded by the Record decision).

## Shared rules

- Dimension grammar as M1: directional dims center at 50 (`conv(x)=|x−50|·2`),
  magnitude dims 0→100. Exactly **five diagnostics** per category.
- Category modules read M1 diagnostics **defensively** (`?? neutral`): with
  empty-candle placeholders (`{}`) every dim degrades to neutral.
- **No-evidence invariant (MTFM2Enhnce1 #6):** if all consumed magnitudes are 0 and
  all directionals are 50 → neutral state, **no signals, no warnings, confidence = 50
  (explicit override), strength = 0**, score 50. Deterministic in every category.
- Votes: a directional value maps to +1 (>55) / −1 (<45) / 0; vote agreement of n
  values = `|Σ votes| / n · 100`.
- Weights exported `<CAT>_CONFIDENCE_WEIGHTS` / `<CAT>_STRENGTH_WEIGHTS`, sum 1.0,
  JSDoc'd "conservative default; tuned later against BTC data; API stable".
- Signals carry `category` + `source` (the specific indicator ids behind that signal).
- Diagnostics stay **numeric dims** (M1-consistent). MTFM2Enhnce1 #11 (per-dim
  value/state/message objects) was not in the reviewer's final six-item list and is
  deliberately deferred to a future major version.

## Categories (dims reference M1 diagnostics by `indicatorId.dim`)

### Trend — contributors `['ema','supertrend','adx']`
| Dim | Type | Formula |
|---|---|---|
| `alignment` | dir | `ema.alignment` |
| `direction` | dir | mean of 3 votes-as-values: EMA score bucket, `supertrend.side`, `adx.direction` |
| `persistence` | mag | `supertrend.persistence` |
| `agreement` | mag | vote agreement of the same 3 (`|Σ|/3·100`) |
| `quality` | mag | mean(`ema.separation`, `adx.trendStrength`) |

**score ≡ `direction`.** Confidence: direction .30 / alignment .25 / agreement .20 / persistence .15 / quality .10 (conv on dirs). Strength: quality .35 / persistence .30 / agreement .20 / alignment .15 (conv).
States: `strong_bullish` (score≥70 ∧ strength≥60) · `bullish` (score≥60) · mirrored bearish · `ranging`.
Signals: `TREND_STRONG` "Strong Trend Agreement" (strong state, strong, source all 3) · `TREND_BUILDING` "Trend Building" (55≤score<70 ∧ persistence≥70, info) · `TREND_REVERSING` "Fresh Flip Against Alignment" (`supertrend.flipFreshness`≥70 ∧ ST side opposes EMA alignment side, info, source ['supertrend','ema']) · `TREND_BREAKDOWN` "Trend Structure Breakdown" (40<score<60 ∧ quality≤25 ∧ persistence≤60, strong).
Warnings: `TREND_WEAKENING` (quality≤30 ∧ |score−50|≥10) · `TREND_DISAGREEMENT` (agreement≤33) · `TREND_CHOPPY` (persistence≤60).

### Momentum — contributors `['rsi','macd','adx']`
| Dim | Type | Formula |
|---|---|---|
| `speed` | dir | `rsi.position` |
| `acceleration` | dir | mean(`macd.histMomentum`, `rsi.momentum`) |
| `continuation` | dir | mean(`macd.crossState`, `adx.adxMomentum`) |
| `exhaustion` | mag | RSI beyond bands: pos≥70 → `(pos−70)/30·100`; pos≤30 → `(30−pos)/30·100`; else 0 |
| `consistency` | mag | vote agreement of speed/acceleration/continuation |

score = 0.4·speed + 0.3·acceleration + 0.3·continuation (rounded). Confidence: speed .30 / acceleration .25 / continuation .25 / consistency .20. Strength: acceleration .35 / consistency .35 / speed .30 (conv on dirs).
States (precedence): `overheated` (exhaustion≥70) · `fading` (|score−50|≥10 ∧ acceleration opposes score side: score>50∧accel≤40 or score<50∧accel≥60) · `accelerating` (score≥60∧accel≥60 or score≤40∧accel≤40) · `bullish` (score≥60) · `bearish` (≤40) · `flat`.
Signals: `MOM_ACCELERATING` (accelerating state, info) · `MOM_FADING` (fading state, info) · `MOM_OVERHEATED` (exhaustion≥70, strong, source ['rsi']) · `MOM_RECOVERING` (score<45 ∧ accel≥60, info).
Warnings: `MOM_DIVERGENCE` (speed & acceleration opposite sides ∧ |speed−acceleration|≥40) · `MOM_STALLED` (40<score<60 ∧ consistency≤33).

### Volume — contributors `['volume','obv']`
| Dim | Type | Formula |
|---|---|---|
| `pressure` | dir | `volume.pressure` |
| `confirmation` | dir | `obv.trend` |
| `participation` | mag | mean(`volume.surge`, conv(`volume.trend`), `obv.consistency`) |
| `surge` | mag | `volume.surge` |
| `consistency` | mag | `obv.consistency` |

score = 0.5·pressure + 0.5·confirmation. Confidence: pressure .30 / confirmation .30 / participation .20 / consistency .20. Strength: participation .40 / consistency .30 / surge .30.
States (precedence): `quiet` (participation≤25, with evidence) · `buying_pressure` (score≥60) · `selling_pressure` (≤40) · `balanced`.
Signals: `BUYING_PRESSURE` (score≥65, strong) · `SELLING_PRESSURE` (≤35, strong) · `VOLUME_SURGE` (surge≥70, strong, source ['volume']) · `LOW_PARTICIPATION` (participation≤25, info).
Warnings: `VOLUME_UNCONFIRMED` (pressure & confirmation opposite sides) · `VOLUME_CHOPPY` (consistency≤30).

### Volatility — contributors `['supertrend','macd']` (ATR: future input; constants stay stable)
**Non-directional: score always 50.**
| Dim | Type | Formula |
|---|---|---|
| `expansion` | mag | mean(`supertrend.distance`, `macd.separation`) |
| `distance` | mag | `supertrend.distance` |
| `impulse` | mag | `macd.separation` |
| `squeeze` | mag | `100 − expansion` |
| `stability` | mag | `clamp(100 − |supertrend.distance − macd.separation|)` |

Confidence: expansion .40 / stability .30 / impulse .15 / distance .15. Strength (= intensity): expansion .50 / impulse .25 / distance .25.
States: `expanding` (expansion≥60) · `compressed` (squeeze≥70) · `normal`.
Signals: `VOLATILITY_EXPANSION` (expansion≥70, strong) · `VOLATILITY_SQUEEZE` (squeeze≥70, info) · `VOLATILITY_IMPULSE` (impulse≥70, info, source ['macd']).
Warnings: `HIGH_VOLATILITY` (expansion≥85) · `VOLATILITY_DISAGREEMENT` (stability≤30).
No-evidence note: squeeze derives from expansion, so the no-evidence check uses the
**consumed inputs** (`supertrend.distance`, `macd.separation` both 0), not `squeeze`.

### Quality — contributors `['ema','adx','supertrend','macd']`
**Non-directional: score always 50.**
| Dim | Type | Formula |
|---|---|---|
| `separation` | mag | `ema.separation` |
| `strength` | mag | `adx.trendStrength` |
| `persistence` | mag | `supertrend.persistence` |
| `impulse` | mag | `macd.separation` |
| `agreement` | mag | `clamp(100 − (max − min))` of the four above |

Confidence: agreement .30 / strength .25 / separation .20 / persistence .15 / impulse .10. Strength: strength .30 / separation .25 / persistence .25 / impulse .20.
States (precedence): no-evidence → `developing` · `choppy` (persistence≤50, with evidence) · `healthy` (strength_result≥70) · `developing` (50–70) · `weak` (<50). (Bands read the computed category `strength`, not the `strength` dim.)
Signals: `QUALITY_HEALTHY` (healthy state, strong) · `QUALITY_AGREEMENT` "Evidence In Agreement" (agreement≥70, info).
Warnings: `QUALITY_WEAK` (weak state) · `QUALITY_CHOPPY` (choppy state) · `QUALITY_MIXED_EVIDENCE` (agreement≤30).

### Participation — contributors `['volume','obv','ema']` (indicators only — no category deps, MTFM2Enhnce1 #5)
| Dim | Type | Formula |
|---|---|---|
| `interest` | dir | mean(`volume.pressure`, `obv.trend`) |
| `flowAlignment` | dir | `obv.trend` |
| `activity` | mag | mean(`volume.surge`, conv(`volume.pressure`)) |
| `trendSupport` | mag | OBV flow vs **EMA verdict side**: both non-neutral same side 100 · either neutral 50 · opposite 0 |
| `commitment` | mag | mean(`obv.consistency`, conv(`volume.trend`)) |

**score ≡ `interest`.** Confidence: interest .30 / flowAlignment .20 / trendSupport .20 / activity .15 / commitment .15. Strength: activity .35 / commitment .35 / trendSupport .30.
States (precedence): no-evidence → `neutral` · `weak_participation` (activity≤25, with evidence) · `strong_buying_interest` (score≥65 ∧ activity≥50) · `buying_interest` (score≥58) · mirrored selling · `neutral`.
Signals: `PART_STRONG` "Strong Committed Participation" (activity≥70 ∧ trendSupport=100, strong) · `PART_BUYING` (score≥60, info) · `PART_SELLING` (≤40, info).
Warnings: `PART_WEAK` (activity≤25) · `PART_UNSUPPORTED_TREND` (trendSupport=0).

## Files & testing

- `lib/mtf/categoryTypes.ts`, `lib/mtf/categoryEngine.ts`,
  `lib/mtf/categories/{shared,trend,momentum,volume,volatility,quality,participation}.ts`
  (categories/shared.ts: defensive diag readers, vote helpers, no-evidence/neutral-result
  builder; numeric helpers reused from `../indicators/shared`).
- Tests colocated `*.test.ts` (project convention, not the brief's `tests/category/`):
  per category — builder exactness, state thresholds/precedence, signal/warning triggers,
  no-evidence invariant (confidence 50 / strength 0 / empty signal arrays), determinism —
  on synthetic `IndicatorResult` fixtures; engine — typed Record assembly, schemaVersion,
  contributors, degradation on placeholder diagnostics, determinism.
- **Acceptance:** full suite (944+) green, `tsc` no new errors, only `lib/mtf/**` + docs
  touched; dashboard, Stack Score, Custom MTF, scanner, alerts, replay, trade setup
  byte-identical (nothing consumes M2 yet).
