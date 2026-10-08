# Stage 7 mobile trading terminal redesign

Validation date: 4 October 2026 (Asia/Calcutta).

## Mobile Redesign Result

Implemented the mobile terminal with a larger chart, compact market header, direct timeframes, one flat-state BUY/SELL dock, and an adaptive active-position dock. Position management, order entry, drawings, and secondary content use on-demand sheets. Desktop composition remains available above the mobile breakpoint.

The implementation is complete. All seven required viewport sizes were inspected in the browser. Final visual acceptance remains pending for the specifically requested stale/reconnecting state; synchronizing and unavailable-price presentation were inspected instead. Physical-phone keyboard, notch, and multitouch behavior also require device verification.

## Audit Findings

- Permanent secondary panels, duplicate chart quote buttons, and verbose OHLC information reduced usable mobile chart space.
- Existing chart sessions, trading controllers, presentation facades, indicators, drawings, and replay already provide the necessary domain ownership.
- The panel library places its sizing attributes on wrappers, so mobile layout must adapt those wrappers as well as their children.
- Replay testing exposed a selector cache bug: changing the selector while retaining the same store snapshot could return the previous symbol/mode selection. The cache now includes selector identity.
- Instrument-switch testing exposed a presentation leak: a previous BTC tick could appear while Gold was loading. Both headers now suppress prices and changes when integrity is loading or unavailable.

## Files Changed

This task's edits within the already-modified working tree:

| Area | Files |
| --- | --- |
| Mobile composition | `app/app/page.tsx`, `app/globals.css`, new `app/mobile-terminal.css` |
| Shared sheet | new `components/ui/MobileSheet.tsx` |
| Header and chart layout | `components/ChartToolbar.tsx`, `components/ChartPanel.tsx` |
| Trading and history | `components/trade/MobileTradeExperience.tsx`, `components/BottomDock.tsx` |
| Drawing and replay presentation | `components/DrawingToolbar.tsx`, `components/DrawingLayer.tsx`, `components/ReplayBar.tsx` |
| Chart chrome | `components/chart/ChartLegend.tsx`, `ChartOHLCStrip.tsx`, `ChartFloatingControls.tsx` |
| Selector correctness | `lib/paperStore.ts`, `lib/replaySession.ts` |
| Focused tests | new `components/MobileToolbar.mobile.test.tsx`, `components/trade/MobileTradeExperience.mobile.test.tsx`, `components/trade/PresentationFacade.selector.test.tsx` |
| Test correction | `lib/paperStore.protection.test.ts` uses the actual slipped entry price when constructing an invalid stop |

Other pre-existing working-tree changes are outside this report.

## Mobile Architecture

Responsive CSS and presentational composition activate below 1024px. Viewport size does not own trading state. ChartSession, ChartTradingController, presentationFacade, MarketDataIntegrity, indicator controller, drawing adapter, paperStore, and replaySession retain their responsibilities.

Mobile entry and management call existing commands. Risk sizing and P&L use existing helpers/facade values. Replay entry routes through the existing replay callback. The shared native dialog provides modal focus behavior without adding another domain store.

## Before vs After

| Before | After |
| --- | --- |
| Quotes and large OHLC blocks covered candles | Quotes in bottom dock; compact horizontally scrollable OHLC |
| History and tabs permanently occupied chart height | History, Stats, Backtest, Alerts inside More |
| Desktop-style controls on narrow screens | Direct timeframe row, indicator control, drawing button, overflow sheet |
| Flat entry controls competed with position management | Flat BUY/SELL transforms into compact active LONG/SHORT management |
| Replay selection could remain stale | Selector identity is respected when switching mode or symbol |

## Header

Instrument selector, prominent formatted price, UTC-day change, integrity badge, and PAPER/REPLAY mode are visible. Replay shows “Snapshot price” rather than comparing snapshot price with the current live day's open. Loading/unavailable instruments show a dash instead of another instrument's retained tick.

## Market Summary

Existing price/change and integrity values are reused. No new 24-hour statistics pipeline or illustrative mockup values were introduced. Gold remains available for selection with truthful unavailable-price/trading-paused presentation when its data is absent.

## Timeframe / Chart Controls

5m, 15m, 1h, and 4h are direct controls; 30m and 1d are in the timeframe sheet. Indicators and drawings remain immediately accessible. Chart type, date, replay, layout, focus, fullscreen, and settings use existing callbacks through secondary controls.

## Chart Real Estate

Measured flat-state chart-body heights in CSS pixels:

| Viewport | Chart body | Approximate viewport share |
| --- | ---: | ---: |
| 360 × 800 | 479 | 60% |
| 390 × 844 | 523 | 62% |
| 412 × 915 | 594 | 65% |
| 844 × 390 | 248 | 63% |
| 768 × 1024 | 702 | 69% |

Native sheets overlay the workspace. Opening them does not recreate the chart. Replay and position states use different heights according to their visible controls.

## OHLC / Price Scale

OHLC is a compact strip with progressive horizontal disclosure on narrow screens. The right price scale remains visible. Mobile chart quote cards are hidden, leaving a single persistent entry dock. Existing crosshair and execution overlays remain owned by the chart.

## Analytical Overlay Presentation

Indicator calculations, configured POC colors, session boundaries, and analytical primitives are preserved. The mobile indicator legend starts collapsed and can expand on demand. SVP, MA/FVG, and RSI were visually inspected together; large historical analytical ranges can still expand the price scale according to existing behavior.

## Drawing Experience

The drawing button opens a tool sheet. Choosing a tool closes it and shows a contextual “Drawing … · Done” control. Existing supported tools, magnet, lock, hide, undo/redo, selected deletion, and clear confirmation remain available. Chart/drawing shortcuts ignore open native dialogs. Tool selection and persistence ownership were tested; actual finger drawing remains a physical-device check.

## Flat Trading Dock

Bid/ask, a single BUY/SELL pair, and a compact risk-sized explanation occupy the bottom zone. No permanent SL/TP/trailing action row appears while flat. Chart, Trade, Positions, and More provide navigation.

## BUY / SELL Entry

Buttons open the corresponding mode-safe workflow. Live entry is blocked with an explanation when integrity is not trusted. Replay setup/loading also blocks entry, preventing an ambiguous live order during replay selection.

## Order Sheet

The live-paper sheet supports the existing Market/Limit/Stop workflow, risk percentage, SL/TP, balance, entry, size, margin, risk amount, potential loss/profit, and R:R. Inputs use 16px text, scrollable dialog content, and a sticky submit area. BUY and SELL sheets were inspected. No live-paper trade was submitted during browser validation.

## Active Position

The dock transforms to LONG/SHORT with compact P&L, protection context, and Manage Position. The full detail belongs in the sheet. Existing positions remain visible when the mark becomes untrusted; mark-based values/actions respect integrity gating.

## Position Management

BE, SL, TP, 25%/50%/75% partial close, trailing, and full close route through existing commands. Partial/full close require confirmation. Active LONG, active SHORT, and the management sheet were inspected using isolated replay execution.

## Trade History / Secondary Content

More opens the existing BottomDock content in a mobile sheet, with dashboard, custom-indicator, and journal links. The permanent desktop bottom panel is hidden through responsive presentation on mobile. History disclosure was visually inspected and covered by focused tests.

## Replay Experience

Compact previous/play/next/speed/exit controls preserve existing replay ownership. Browser validation loaded a snapshot, opened and closed a simulated LONG, opened and closed a simulated SHORT, rotated with the SHORT active, stepped backward/forward, and exited replay. Live-paper accounting remained separate. Replay entry became usable after correcting selector caching.

## Live / Replay / Integrity Presentation

LIVE/PAPER, replay setup, and REPLAY/SIMULATED are distinguished. Untrusted entry displays “Trading paused” with a reason. Synchronizing and missing-price states were visually inspected, including BTC → Gold → BTC recovery. Stale/partial/unavailable gating has automated coverage. A controlled stale/reconnecting browser screenshot remains pending.

## Mobile Portrait

360 × 800: PASS. 390 × 844: PASS. 412 × 915: PASS for inspected normal, sheet, and replay/position states. No document horizontal overflow; scale and entry controls remain accessible. See the visual-state limitation above.

## Mobile Landscape

844 × 390: PASS. Header compresses into a short layout, and the flat dock shares its row with navigation. The chart occupies approximately 63% of the flat viewport. Replay SHORT state survived rotation and remained manageable.

## Tablet

768 × 1024: PASS. The chart expands without exposing dense desktop side panels. Existing controls remain available through sheets, with no horizontal document overflow.

## Desktop Regression

1366 × 768 and 1920 × 1080: PASS for browser layout inspection. The desktop toolbar, drawing rail, secondary content, and signal panel remain present. No horizontal document overflow was measured.

## Touch / Gesture Result

Primary buttons, sheet close actions, timeframes, and management controls have approximately 44px or larger practical targets. CSS uses dynamic viewport units and safe-area insets. Existing chart gesture ownership is retained. Browser resizing and sheet interactions passed; physical pinch zoom, virtual keyboard, and real notch/browser-chrome behavior were not emulated and remain device checks.

## Accessibility Result

PASS for implemented and inspected controls: labelled buttons, pressed states, visible focus styles, native modal dialogs, focus restoration, direction text, and destructive confirmations. No new motion-dependent interaction was introduced. This is not a complete screen-reader or WCAG conformance audit.

## Performance Result

PASS for existing automated regression budgets. The full suite includes relevant indicator baseline/incremental, SVP, transforms, tail-write, visible-range, and soak checks. No new price feed subscriptions, per-object DOM analytical overlays, pointer/crosshair React state, or breakpoint-driven domain remounts were introduced. No physical-phone CPU/frame-time benchmark was performed.

## Trading Safety Result

PASS in regression tests. Entry, protection, BE, partial close, trailing, full close, risk sizing, pending orders, idempotency, accounting, and symbol isolation continue through existing owners. The protection test correction accounts for actual entry slippage and does not change execution logic.

## Replay Safety Result

PASS in automated checks and simulated browser trades. Selector caches now invalidate on selector changes as well as snapshot changes. Regression tests specifically cover already-configured replay selection and live symbol switching without a store mutation.

## Tests

| Run | Passed | Failed | Test files |
| --- | ---: | ---: | ---: |
| Full regression (`--maxWorkers=2`) | 2,290 | 0 | 326 |
| After selector correction | 95 | 0 | 16 |
| Final mobile/header/selector checks, including price-leak fix | 42 | 0 | 5 |

These runs overlap and must not be added together as a unique-test count. The full regression preceded the selector correction; focused regression checks cover the later corrections.

- Changed-file ESLint: 0 errors, 42 warnings, including existing hook/unused-code warnings.
- Final TypeScript check: blocked by the same two existing `IndicatorPlot.lineStyle` errors in `lib/indicators/elephantZone.ts:194` and `lib/indicators/elephantZone.test.ts:34`.
- Production build is not certified while those baseline type errors remain.
- Browser console inspection returned no errors in the final validation tab.

Raw results: `stage7-mobile-final-results.json`, `stage7-mobile-selector-regressions.json`, and `artifacts/stage7-mobile/ui-final-results.json`.

## Visual Verification

Browser screenshots are in `artifacts/stage7-mobile/`:

| State | Evidence |
| --- | --- |
| BTC flat | `flat-360.jpg`, `flat-390.jpg`, `flat-412.jpg` |
| Landscape / tablet | `landscape.jpg`, `tablet.jpg` |
| Desktop | `desktop-1366.jpg`, `desktop-1920.jpg` |
| Heavy analytics | `heavy-analytics.jpg` |
| Entry sheets | `buy-sheet.jpg`, `sell-sheet.jpg` |
| Active positions | `active-long.jpg`, `active-short.jpg` |
| Management | `manage-position.jpg` |
| Drawings | `drawing-mode.jpg` |
| Replay | `replay.jpg` |
| History | `history-sheet.jpg` |
| Missing price / synchronizing | `unavailable.jpg` (captured while synchronizing; not a stale-feed test) |

## Stage 1–7 Regression Results

The full suite passed trading, market-data health/recovery, replay, indicator, drawing, and performance tests. Focused tests after the selector and header corrections passed. No known new failing test remains. Repository-wide type checking remains blocked by the unrelated baseline errors described above.

## Remaining Issues

1. Capture and inspect a controlled stale/reconnecting state in the browser to finish the explicitly requested visual-state checklist.
2. Verify keyboard, safe areas, pinch zoom, and finger drawing on a physical phone.
3. Resolve the existing elephantZone type errors before certifying a production build; those files were not changed by this mobile redesign.

## Final Verdict

| Gate | Result |
| --- | --- |
| Implementation | PASS |
| Trading safety | PASS |
| Replay safety | PASS |
| Market-data integrity | PASS — automated gating and synchronizing display verified |
| Mobile portrait | PASS — inspected states; stale/reconnecting visual state pending |
| Mobile landscape | PASS |
| Tablet | PASS |
| Desktop regression | PASS — visual/regression scope; baseline type errors remain |
| Performance | PASS — existing automated budgets |
| Accessibility | PASS — scoped controls and dialog checks |

**MOBILE PROFESSIONAL TRADING EXPERIENCE — FUNCTIONALLY COMPLETE; VISUAL ACCEPTANCE PENDING**

No Stage 8 stability work or Stage 9 Gold provider integration was started.
