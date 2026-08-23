# Stage 2 Task 1 — Performance Baseline

This baseline is development/test-only. It does not change chart rendering,
market-data flow, replay state, or production logging.

## Harness

- Deterministic fixtures: 2,048 bars (`small`), 20,000 bars (`medium`), and
  50,000 bars (`deep`). Bars are a seeded OHLCV walk and are reused across runs.
- Stacks: `light` (SMA + RSI) and `heavy` (SMA + RSI + MACD + Regression/G-Channel).
- Five measured samples after one warm-up per row.
- Percentiles use sorted samples; p95/p99 use the maximum when the sample count
  cannot distinguish a higher percentile.
- Scenarios cover live forming tick, closed-bar update, history prepend, replay
  step, indicator toggle/computation, timeframe switch, visible-range pan,
  indicator setData formatting, SVP/POC, Heikin-Ashi, Renko, paper no-op
  reconciliation, and day-separator pan work.

## Representative measurements (ms)

| Scale / stack | Indicator compute | Indicator setData | Forming tick | SVP/POC | HA | Renko | Day separators | Paper no-op |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2k / light (p50) | 0.393 | 0.906 | 0.789 | 0.995 | 0.463 | 0.220 | 0.011 | 0.009 |
| 20k / light (p50) | 5.244 | 9.178 | 4.749 | 8.012 | 0.469 | 0.429 | 0.098 | 0.003 |
| 50k / light (p50) | 18.620 | 24.523 | 17.687 | 20.479 | 4.015 | 1.250 | 0.261 | 0.003 |
| 2k / heavy (p50) | 7.992 | 9.168 | 8.356 | 0.847 | 0.050 | 0.089 | 0.012 | 0.004 |
| 20k / heavy (p50) | 86.830 | 112.653 | 85.317 | 7.888 | 0.471 | 0.422 | 0.099 | 0.003 |
| 50k / heavy (p50) | 265.282 | 367.130 | 295.396 | 20.674 | 1.863 | 1.154 | 0.246 | 0.003 |

The five-sample p95/p99 values for the highest-cost paths were:

- 50k heavy indicator computation: **312.766 ms**
- 50k heavy indicator setData formatting: **444.679 ms**
- 50k heavy forming live tick: **322.478 ms**
- 50k heavy timeframe switch: **294.903 ms**
- 50k heavy SVP/POC: **22.508 ms**

## Interpretation

The baseline identifies full-stack indicator computation and indicator data
formatting as the dominant costs at deep history. Forming-tick and timeframe
switch paths inherit that cost. SVP/POC is materially smaller than the heavy
indicator stack but still scales with history. Heikin-Ashi/Renko, day-separator
scanning, and paper no-op reconciliation are comparatively low on this fixture.

These are measurements only. No optimization is included in Stage 2 Task 1;
the fixture and scenario names are stable for later before/after comparisons.
