# SMC regression fixtures

Every fixed detection bug adds a fixture here so it can never return
(`lib/smc/engine.test.ts` replays all of them).

To record one:

1. Reproduce the bug with a minimal candle array.
2. After fixing, save `<slug>.json`:

```json
{
  "candles": [{ "time": 0, "open": 100, "high": 101, "low": 99, "close": 100.5, "volume": 1 }],
  "expectedProjection": { }
}
```

where `expectedProjection` is the output of `projectSmcSnapshot(computeSmc(candles))`
with the fix applied (verify it by hand before committing).
