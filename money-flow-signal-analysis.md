# BUY/SELL reconstruction: evidence and current implementation

The combined Pine file is `money-flow-dots-with-signals.pine`. It adds an adjustable swing hypothesis to the existing dot indicator. The reference's exact signal formula has not been recovered.

## What the screenshots show

- Images 2 and 5 are duplicates: there are five distinct chart views.
- Images 1, 2/5 and 6 show 30-minute candles; image 3 shows 5-minute candles and image 4 shows 15-minute candles.
- BUY labels appear around local lows, with green bands near the swing lows. SELL labels appear around local highs, with red bands near the swing highs.
- Multiple BUYs or SELLs can occur consecutively. A rule that forces BUY/SELL alternation would omit visible labels.
- Label positions do not consistently coincide with same-colored money-flow dots. The dots alone do not explain the labels.
- The 5-minute rally contains several SELL labels while price is well above the displayed MRP line. An all-levels trend gate cannot explain those particular labels.
- Pairs of lows/highs are compatible with W/M candidates. The screenshots do not establish that every label requires a completed W/M pattern or a neckline break.

## Timing hypothesis checked against candles

I visually read nine label times from image 1. These are approximate screenshot readings, not an export from the reference indicator. Times are Asia/Kolkata (UTC+05:30), in 2026.

| Visible label | Swing candle supported by Binance OHLC | Confirmation candle |
|---|---|---|
| SELL, September 30 05:00 | High on September 30 04:30 | September 30 05:00 |
| BUY, September 30 09:00 | Low on September 30 08:30 | September 30 09:00 |
| BUY, September 30 13:00 | Low on September 30 12:30 | September 30 13:00 |
| BUY, September 30 14:30 | Low on September 30 14:00 | September 30 14:30 |
| SELL, September 30 19:00 | High on September 30 18:30 | September 30 19:00 |
| SELL, September 30 22:00 | High on September 30 21:30 | September 30 22:00 |
| BUY, October 1 06:00 | Low on October 1 05:30 | October 1 06:00 |
| BUY, October 1 08:30 | Low on October 1 08:00 | October 1 08:30 |
| SELL, October 1 12:00 | High on October 1 11:30 | October 1 12:00 |

Each of these nine events is compatible with a high/low pivot using two left candles and one completed right candle. A label at 09:00 identifies the candle that opens at 09:00; on a 30-minute chart the signal becomes available when that candle closes at 09:30.

This is evidence for the timing, not proof of the full formula:

| Fixed pivot rule | Included visible labels | Additional candidates in the comparison window |
|---|---:|---:|
| 2 left, 1 right | 9 / 9 | 14 |
| 3 left, 1 right | 8 / 9 | 13 |
| 5 left, 1 right | 7 / 9 | 9 |

Comparison window: September 30 04:00 through October 1 12:30, inclusive. Increasing the left length reduces some extra candidates but also loses visible reference labels. No RSI, volume, or EMA threshold was fitted to force these nine outcomes.

A static screenshot also cannot establish when a historical label first appeared. The reference might plot delayed pivots on earlier bars. TradingView explains this ambiguity in its [repainting documentation](https://www.tradingview.com/pine-script-docs/concepts/repainting/#plotting-in-the-past).

## Previous version (superseded)

- Default: all confirmed swings, two left candles and one right candle.
- BUY follows a confirmed low; SELL follows a confirmed high. An ambiguous pivot that is simultaneously a high and low produces neither signal.
- Signals appear on the confirmation candle, with alerts at its close. Labels and bands are not drawn on earlier candles.
- Optional W/M second-swing mode requires two nearby same-side pivots separated by an opposite pivot, within adjustable time and ATR distance limits. This is an explicit modeling choice; it confirms the second swing without waiting for the neckline to break.
- Optional matching-dot filtering uses only dots already known on or before the signal candle. It is off by default.
- POC and MRP are not required. Signals do not depend on the dot engine's active-wave state.
- Green/red bands mark swing reference prices. Their thickness and duration are display choices, not a reconstructed original stop-loss formula.
- The original dot calculations are preserved. A grey dot describes money-flow exhaustion; it is not a guarantee of an exit for every BUY/SELL label or an actual-position tracker.

## Previous comparison and limits

`python money-flow-signal-check.py` verifies the table and checks that appending future candles cannot change already confirmed pivot events in the Python hypothesis. It also compares executable lines in the combined script's dot section with the original dot file.

Input candles are saved in `money-flow-signal-candles.json`: Binance BTCUSDT perpetual, 30-minute interval, retrieved from the public `/fapi/v1/klines` endpoint for September 28 through October 2, 2026. The data and comparison script are retained so the reported result can be reproduced.

This is a local logic check, not a TradingView compilation or a test of profitability. Only the image-1 window has quantitative label comparison; the other distinct screenshots were reviewed visually. The 14 extra candidates show that the original indicator's selection filter remains unresolved. More reference labels or a bar-replay recording are needed to identify that filter and its true confirmation delay.

## October 2 update: filtered reversal signals (current defaults)

The current file is titled **Money Flow Dots + Filtered Reversal Signals**. The old all-pivot output caused the label clusters in the user's latest 30m and 4H screenshots. The new rules are an explicit price-action model, not a recovered proprietary formula or a proven optimal trading system.

1. A two-left, one-right confirmed pivot creates a candidate. A pivot that is simultaneously a high and low does not create a candidate.
2. Before a low, the preceding six candles must contain a high at least 1.5 ATR above that low. Before a high, the inverse applies. ATR is frozen at the pivot candle (14-period Wilder ATR by default).
3. BUY requires a closing price above the pivot candle's high and at least 0.75 ATR above the swing low. SELL requires a close below the pivot candle's low and at least 0.75 ATR below the swing high. Both can confirm on the first right candle or later.
4. A setup is invalidated if price breaches its swing extreme and expires more than six bars after pivot confirmation. One pending candidate per side is retained; only an equal or more extreme same-side pivot replaces it.
5. Any two signals must be at least six candles apart: three hours on 30m, 24 hours on 4H. This spacing is an explicit frequency control and can suppress valid reversals.
6. A repeated BUY needs a new low at least 1 ATR below the preceding BUY confirmation close, unless a SELL has intervened. SELL uses the mirrored rule. This allows repeated signals after a fresh pullback but suppresses repeated labels along one move.
7. A completed breakout is consumed even when spacing or an optional dot filter blocks it. It cannot generate a stale signal later merely because the cooldown expires. Conflicting simultaneous triggers produce neither signal. An emitted signal clears both pending candidates.
8. In optional W/M mode, the trigger is the intervening opposite pivot (neckline). The same qualification, spacing and expiry rules still apply; this mode is stricter and can miss slower patterns.

The money-flow dot calculations are unchanged. Matching-dot filtering remains optional and disabled by default. There are no POC, MRP, RSI or trend-direction requirements. No trade orders are placed. BUY/SELL labels sit next to the actual confirmation candle; reference bands remain at the originating swing price. No signal is backdated to the pivot candle.

### Frequency check

Public Binance BTCUSDT perpetual candles were loaded from September 10 for warmup. Only candles closed by October 2, 2026, 13:00 UTC (18:30 IST) were included. The following comparison uses the same two-left/one-right raw baseline, no mandatory dots, and default filter settings. These are Python model counts, not TradingView-compiled results.

| Chart | Evaluated candle opening times (IST) | Raw BUY / SELL | Filtered BUY / SELL |
|---|---|---:|---:|
| 30m | Sep 30 20:00–Oct 2 18:00 | 14 / 15 | 3 / 3 |
| 4H | Sep 18 01:30–Oct 2 13:30 | 13 / 19 | 3 / 3 |

`money-flow-filter-check.py` reproduces these counts using `money-flow-filter-30m.json` and `money-flow-filter-4h.json`. Event candle opening times are in `money-flow-filter-results.json`; a label becomes known at that candle's close, not at its opening time. Prefix checks cover 1,082 closed 30m candles and 135 closed 4H candles. Additional checks cover signal spacing, closing breakouts, setup lifetime/invalidation and mirrored BUY/SELL behavior. `money-flow-signal-check.py` also confirms that the dot block remains executable-identical to the original file.

Fewer signals do not establish higher win rate, favorable risk/reward or better exits. No profitability test was performed. The new module deliberately delays signals for price confirmation and will miss some moves. TradingView compilation and chart replay remain unverified. For timing background, see [TradingView's repainting documentation](https://www.tradingview.com/pine-script-docs/concepts/repainting/).

### Installation

Replace the old script with the complete `money-flow-dots-with-signals.pine` file, save, and add it to the chart. Reset the script's inputs to defaults when comparing the counts above. Remove the previous instance to avoid duplicate labels. Recreate BUY/SELL alerts for the new `BUY reversal confirmed` and `SELL reversal confirmed` conditions, using once per bar close.
