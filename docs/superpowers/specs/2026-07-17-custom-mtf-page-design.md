# Custom Multi-Timeframe Page — Design

Date: 2026-07-17 · Status: approved

## Goal

A new **Custom Multi-Timeframe** page where clicking an indicator row in the
MTF card opens the same indicator settings card used on the chart. Changing
parameters re-scores the matrix through the MTF engine and the settings are
persisted. The main Multi-Timeframe page and every other alignment consumer
(Stack Score, alerts, trade setup, dashboard) are **not changed**.

## Decisions (from brainstorming)

1. **Independent settings.** Custom MTF parameters are fully independent of
   chart indicator settings. Neither affects the other.
2. **Separate page, standalone copy.** `app/custom-multi-timeframe/page.tsx`
   is a copy of `app/multi-timeframe/page.tsx` with the feature added. The
   main page file is untouched (duplication accepted; consolidate later once
   the custom page stabilizes).
3. **Configurable rows: Supertrend, RSI, MACD, ADX only.** These have input
   schemas in `lib/customIndicatorsLibrary.ts`. EMA Alignment stays as-is
   (explicit user decision); Volume and OBV have `inputs: []` (their
   tunables are engine-internal), so they stay non-clickable too.
4. **All inputs flow through.** The engine reads computed plots, so every
   input the settings card edits (lengths, multipliers, source, MA types)
   affects the scores — not just lengths.

## Engine changes (additive; no behavior change when settings are absent)

- `IndicatorDefinition.evaluate(candles, settings?)` — definitions forward
  `{ id, settings }` as the existing `CustomIndicatorConfig` accepted by
  `computeSuperTrend` / `computeRsi` / `computeMacd` / `computeAdx`.
  EMA / Volume / OBV definitions ignore `settings`.
- `IndicatorRegistry.evaluate(candles, { weights?, settings? })` where
  `settings: Record<indicatorId, IndicatorSettings>`.
- `computeTfCells(candles, settings?)` and
  `computeAlignmentMatrix(candlesByTf, tfs, settings?)` thread the map
  through. Omitted settings ⇒ byte-identical output (existing suite +
  parity tests prove it).
- Definitions gain an optional `subFor(settings)` so row sub-labels reflect
  live params: Supertrend `"12,4"`, RSI `"21"`, MACD `"8,21,5"`, ADX `"14"`.

## Page

- Route `app/custom-multi-timeframe/page.tsx`, title "Custom Multi-Timeframe",
  `StackSidebar` entry directly under Multi-Timeframe.
- The four configurable rows get hover styling and a gear affordance; click
  opens `components/trade/IndicatorSettingsModal.tsx` with that indicator's
  `CustomIndicatorDef` and the stored settings.
- The modal gains an optional `tabs?: Tab[]` prop (default: all three) —
  the page passes `['Inputs']` since Style/Visibility are chart-rendering
  concerns. Non-breaking for chart callers.
- Modal live-saves → page state → `useMemo` matrix recompute → persist.
  The modal's built-in "Reset settings" restores defaults.

## Persistence

`localStorage['custom_mtf_settings']` = `Record<indicatorId, IndicatorSettings>`.
Loaded once on mount (SSR-safe guard), written on every save. Corrupt or
missing JSON falls back to `{}` (engine defaults).

## Testing

Unit tests (vitest, no Playwright):

- Registry: custom settings change scores (e.g. RSI length 5 vs 14 on a
  suitable series; Supertrend factor); omitted settings keep exact parity
  with defaults; unknown indicator ids in the settings map are ignored.
- Alignment: `computeAlignmentMatrix` with a settings map produces different
  sub-scores and updated row sub-labels; without it, output identical.

## Out of scope

- Any change to the main MTF page or other alignment consumers.
- Configurable Volume SMA length / OBV lookback (engine-internal for now).
- Weight configuration UI, per-timeframe settings, server-side persistence.
