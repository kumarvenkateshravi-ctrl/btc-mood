# Simple EMA Band reconstruction

The standalone TradingView script is [`fts-jadu-reconstruction.pine`](../fts-jadu-reconstruction.pine).

## Inputs

- **Open/close:** any TradingView price source; the default is `Close`.
- **Shorter EMA:** `9` by default.
- **Longer EMA:** `21` by default.
- **Enable 200 Ema:** shows or hides the 200 EMA.
- **Enable Weekly VWAP:** shows or hides the week-anchored VWAP and enables or disables its signals.
- **Weekly VWAP Source:** controls the VWAP price source; the default is `HLC3`.
- **Touch Tolerance (Ticks):** expands the ribbon edge slightly so a visual touch can be detected without requiring mathematically identical EMA values. The default is one minimum tick.

## Display logic

- The short EMA is turquoise above the long EMA and red below it.
- The long EMA is green when the short EMA is above it and magenta when the short EMA is below it.
- The 200 EMA is teal when the short EMA is above it and red when the short EMA is below it.
- The Weekly VWAP is plotted in gold and resets at the beginning of each exchange week.
- The area between the short and long EMAs is filled green in a bullish alignment and red in a bearish alignment.
- Each direction has a stronger fill when a candle boundary is inside the EMA band and a lighter fill otherwise. This produces the four fill colors visible in the supplied Style screenshot.

The original EMA section keeps its three visible plots, two hidden fill anchors, and four-color fill. Weekly VWAP adds one named visible plot.

## Buy and sell signals

The entire price area between the short and long EMAs is treated as the ribbon.

- An **EMA 200 BUY** is generated when EMA 200 first reaches a green ribbon (`EMA 9 > EMA 21`).
- An **EMA 200 SELL** is generated when EMA 200 first reaches a red ribbon (`EMA 9 < EMA 21`).
- A **Weekly VWAP BUY** is generated when the Weekly VWAP first reaches a green ribbon.
- A **Weekly VWAP SELL** is generated when the Weekly VWAP first reaches a red ribbon.
- EMA 200 and Weekly VWAP are tracked independently. Either line may approach from above or below, and whichever ribbon boundary it reaches first is used.
- Crossing through the ribbon is not required. A touch within the configured tolerance is sufficient.
- Continued contact produces no additional labels. Each reference line rearms independently after it separates from the ribbon and approaches it again.
- The first bar of each week is excluded from Weekly VWAP contact detection because the anchor reset creates a discontinuous line jump.
- Signals are confirmed at candle close and have matching TradingView alert conditions.
