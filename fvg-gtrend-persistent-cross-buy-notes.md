# FVG + original G-Trend implementation

## Original G-Trend

`fvg-gtrend-persistent-cross-signals.pine` contains a direct Pine v6 port of Alex Grover's original Pine v4 G-Channel Trend Detection calculation.

The port preserves:

- `a` and `b` initialization at zero and the original recursive formulas.
- Cross detection against `close`, even when a different G-Trend source is selected.
- `barssince(crossdn) <= barssince(crossup)` as the bullish state.
- Lime/red Average and Close plots with the fill between them.
- Buy/Sell labels on bullish-state changes with `offset = -1`.

Only version compatibility syntax changed: `study` became `indicator`; `max`, `min`, `avg`, and `barssince` use their Pine v6 namespaces; transparency uses `color.new`.

## FVG contact signals

The separate FVG contact system remains in the same indicator. It marks a confirmed green bullish FVG middle candle when Session VWAP or the original G-Trend Average lies within that candle's high-low range. It mirrors this for a confirmed red bearish FVG middle candle.

Contact is strict to the line value on the exact middle candle: `low[1] <= line[1] <= high[1]`. Equality counts as a boundary touch. The third candle confirms the FVG, and the marker is placed on the middle candle with `offset = -1`. A bearish or bullish FVG without VWAP/G-Trend contact cannot create an FVG label.

FVG marker text identifies the source as `VWAP BUY/SELL`, `G-FVG BUY/SELL`, or `BOTH BUY/SELL`. Same-side markers use the configurable cooldown, which defaults to six bars.

## Verification

- `python gtrend-color-change-check.py` verifies that original G-Trend signals alternate, occur only on state/color transitions, and remain stable as later candles are appended.
- `python fvg-line-touch-check.py` verifies BUY/SELL symmetry, exact-candle line contact, inclusive high-low boundaries, six-bar same-side spacing, placement on the middle candle, and stable confirmed history.

These are local behavioral checks. TradingView compilation and chart replay remain to be performed in the Pine Editor.
