# AI Renko Supertrend Reconstruction

## What could be recovered from the screenshots

The screenshots expose the indicator's configuration contract but not its original source or formulas:

| Input | Default | Implementation |
| --- | ---: | --- |
| ATR Length | 14 | ATR period, DMI period, and ADX smoothing |
| Base Factor | 3 | Distance from the Renko reference to each Supertrend band, in bricks |
| Auto Brick Size | On | Uses ATR as the current brick size |
| Manual Brick Size | 10 | Absolute price size when automatic sizing is off |
| Choppy Filter (ADX) | Off | Suppresses reversal markers when ADX is below the threshold |
| ADX Threshold | 15 | Minimum ADX for a Buy or Sell marker when filtering is enabled |

The Style screenshot shows bullish and bearish Supertrend lines, a transparent price-reference plot used as a cloud anchor, Buy and Sell markers, and bullish and bearish clouds. The reconstruction supplies each of these as editable Pine outputs.

## Calculation

1. Determine the active brick size from ATR or the manual input.
2. Maintain a synthetic reference price that moves in whole bricks when a chart candle closes.
3. Build trailing upper and lower bands around that reference using `Base Factor × brick size`.
4. Flip bullish when the reference closes above the prior trailing upper band.
5. Flip bearish when the reference closes below the prior trailing lower band.
6. If the ADX filter is enabled, print a reversal marker only when ADX is at or above the threshold.

All state changes and signals use confirmed chart bars. This prevents an unfinished candle from creating a temporary brick or signal.

## Interpretation

- A green line and cloud represent a bullish Renko Supertrend regime.
- A red line and cloud represent a bearish Renko Supertrend regime.
- **BUY** marks a confirmed bearish-to-bullish change.
- **SELL** marks a confirmed bullish-to-bearish change.
- Automatic brick sizing adapts to volatility. Manual sizing gives consistent absolute bricks across the loaded history.

## Practical limitation

This is an independent, transparent reconstruction. The screenshots do not disclose what the original publisher means by “AI,” how its automatic brick size is calculated, or whether its signals update intrabar. Exact numerical agreement with the original indicator therefore cannot be guaranteed without its source code or a bar-by-bar output sample.
