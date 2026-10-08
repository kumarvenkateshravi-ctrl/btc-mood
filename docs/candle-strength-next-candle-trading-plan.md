# Candle Strength: Next Candle Break Trading Plan

## Indicator analysis

The indicator assigns each directional candle a composite score from 0 to 100. The default weights are:

| Component | Default weight | Meaning |
| --- | ---: | --- |
| Directional close location | 30% | A green candle scores higher when it closes near its high; a red candle scores higher when it closes near its low. |
| Body dominance | 30% | A large body relative to the full candle range scores higher. |
| Range versus prior ATR | 25% | A candle that is large relative to recent volatility scores higher. |
| Volume versus prior average | 15% | A candle with elevated volume scores higher. |

The ATR and volume baselines use the prior bar (`[1]`), which avoids letting the evaluated candle inflate its own baseline. The strength score measures directional conviction. It does not estimate the probability that the next candle will reverse.

## Setup and entry rules

### Long

1. The setup candle must be red: `close < open`.
2. Its composite strength must be strictly greater than 70%.
3. Only the immediately following candle is eligible.
4. Enter long when that candle trades above the setup candle's high.
5. The indicator prints **Long** below the breakout candle.

### Short

1. The setup candle must be green: `close > open`.
2. Its composite strength must be strictly greater than 70%.
3. Only the immediately following candle is eligible.
4. Enter short when that candle trades below the setup candle's low.
5. The indicator prints **Short** below the breakdown candle.

Doji candles do not qualify. A break means a strict inequality: equal highs or lows do not trigger.

## Execution and risk rules

- Treat the setup candle's high as the long trigger and its low as the short trigger.
- For a long, place the initial stop below the setup candle's low. For a short, place it above the setup candle's high.
- If the next candle gaps beyond the trigger, calculate risk from the actual available entry price. Skip the trade when the wider risk exceeds the account limit.
- Risk no more than 0.5% to 1% of account equity per trade. Position size is `account risk / distance from entry to stop`.
- Take partial profit at 1R and consider moving the remaining stop to entry only after 1R is reached.
- Use 2R as the default final target, or exit earlier at a clearly defined opposing structure level.
- Skip a setup when the required stop is too wide, expected reward to the next opposing structure is below 1.5R, or the breakout candle has already traveled most of the planned target distance.

## Signal timing

The setup references the fully formed previous candle. On the live next candle, `high > high[1]` or `low < low[1]` can trigger intrabar. A current candle's high cannot decrease and its low cannot increase, so a detected break does not disappear later in that candle. Configure TradingView alerts for **Once Per Bar** if the entry should be acted on at the break.

## Validation checklist

Before using the plan with real money, backtest it separately by symbol and timeframe. Record the number of trades, win rate, average win and loss in R, expectancy, maximum drawdown, and results after fees and slippage. Compare the default 70% threshold with nearby values without choosing a threshold solely because it performed best on one historical sample.
