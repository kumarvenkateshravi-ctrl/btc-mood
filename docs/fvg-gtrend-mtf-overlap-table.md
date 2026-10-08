# FVG + G-Trend zone entry signals

## Signal rule

The chart and the 5, 15, and 30 minute table rows apply the same rule on their own candles:

1. A bullish FVG forms when `low > high[2]` and `close[1] > high[2]`. Its price band is `high[2]..low`. A bearish FVG forms when `high < low[2]` and `close[1] < low[2]`. Its band is `high..low[2]`.
2. On a completed candle, the **G-Trend Average itself** must lie within an active FVG's price band, inclusive of both boundaries. For an older gap, the average must have been outside that same band on the previous candle. A newly formed gap may qualify immediately if the average is already inside it.
3. A bullish FVG generates BUY only in the bullish G-Trend regime; a bearish FVG generates SELL only in the bearish regime. The formation candle's wick range and price retests do not trigger a signal.
4. Each FVG can trigger once. A newer unmitigated FVG is a separate opportunity. When several eligible gaps exist on one candle, the newest gets priority. **Signal Cooldown (Bars)** defaults to zero; increasing it can suppress an otherwise valid first entry.

The trigger uses the completed candle, so the chart BUY/SELL marker appears on the following candle. The table's **SIGNAL TIME** is the trigger candle's closing time in **Table Time Zone** (default Asia/Kolkata). **ENTRY** is that trigger candle's close.

## Signal lifetime and counts

After a zone triggers, its BUY or SELL state stays active while that FVG remains active, even if the G-Trend Average later leaves the band. The same FVG cannot signal again. When its wick reaches the far edge, the FVG is fully mitigated: `low <= bottom` for bullish and `high >= top` for bearish. A gap can also expire after **Maximum FVG Age (Bars)** or leave storage at **Maximum Active FVGs**. The table shows **MITIGATED** for one completed timeframe candle when a triggered gap is fully mitigated and no other triggered gap remains active, then **WAIT**. If multiple triggered gaps remain, the latest active trigger determines the displayed direction, entry, and time.

**BULL ACTIVE** and **BEAR ACTIVE** count all active FVGs on each timeframe, whether or not they triggered a signal. A still-active gap formed on an earlier day remains included. On a chart matching a table row's timeframe, its count reads the same FVG array as the chart boxes; other rows reproduce that lifecycle on their own candles.

**LIVE PTS** is current chart price minus the displayed BUY entry, or the displayed SELL entry minus current chart price. With no exit rule, these are changing price points rather than realized profit. After no triggered FVG remains, the most recent entry and live points remain visible as a reference.

## Chart setup

Use a **5 minute or lower standard candlestick chart** to see all three rows. A row below the chart timeframe displays **USE 5m CHART** because ordinary lower-timeframe requests can miss intrabars. The table uses each requested timeframe's last completed candle. There is one BUY and one SELL alert condition for each table timeframe, plus chart-timeframe BUY and SELL alerts.
