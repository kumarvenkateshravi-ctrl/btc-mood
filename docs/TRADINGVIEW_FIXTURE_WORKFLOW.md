# TradingView Fixture Workflow

Use this when upgrading an indicator from a snapshot baseline to a true
TradingView-matched golden fixture.

## RSI CSV Contract

Export chart data from TradingView with the same symbol, timeframe, and visible
range used by our fixture. The CSV must contain these candle columns:

```csv
time,open,high,low,close,volume
```

For RSI, include the plotted columns from TradingView's export:

```csv
RSI,RSI-based MA
```

The importer maps those TradingView column names to our plot ids:

| TradingView column | App plot id |
|--------------------|-------------|
| `RSI` | `rsi` |
| `RSI-based MA` | `rsiMa` |

Leave warm-up values blank or as `na`. The fixture builder treats blanks as
"do not check this bar" and `na` as an expected `null` value.

## How We Use It

1. Save the exported CSV in the workspace.
2. Build a `source: "tradingview"` fixture with
   `buildTradingViewFixtureFromCsv`.
3. Replace or add the committed fixture in `lib/testing/fixtures`.
4. Run the indicator golden test without `UPDATE_GOLDEN`.

If the test passes, the indicator is not just stable against our own snapshot;
it is numerically matched to TradingView for the captured candles and params.
