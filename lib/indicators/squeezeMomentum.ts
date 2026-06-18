import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import * as pm from '../pineMath';

export interface SqueezeMomentumConfig extends CustomIndicatorConfig {
  bbLength?: number;
  bbMult?: number;
  kcLength?: number;
  kcMult?: number;
  useTrueRange?: boolean;
}

/**
 * Squeeze Momentum [LazyBear] + Live Commentary.
 *
 * PineScript translation of:
 *   //@version=6
 *   indicator(title="Squeeze Momentum [LazyBear] + Live Commentary", ...)
 *
 * Returns:
 *   - Momentum histogram (colored by bull/bear + acceleration)
 *   - Squeeze state dots (zero-line crosses colored by sqz state)
 *   - buy/sell signals on squeeze release + momentum direction
 *
 * The "live commentary" is intentionally NOT emitted by the compute
 * function — those are UI strings rendered by the chart layer (panel,
 * tooltip). We only produce the data the panel needs (squeeze state
 * per bar + momentum sign + acceleration), plus the BUY/SELL signals.
 */
export function computeSqueezeMomentum(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  // Accept CustomIndicatorConfig (the broad type the framework passes
  // in) and pluck only the fields this indicator understands. Extra
  // fields like `settings` are ignored.
  const cfg = config as SqueezeMomentumConfig | undefined;
  const bbLength = cfg?.bbLength ?? 20;
  const bbMult = cfg?.bbMult ?? 2.0;
  const kcLength = cfg?.kcLength ?? 20;
  const kcMult = cfg?.kcMult ?? 1.5;
  const useTrueRange = cfg?.useTrueRange ?? true;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  // ─── Bollinger Bands ────────────────────────────────────────────────────
  const basis = pm.sma(closes, bbLength);
  const bbDev = pm.multiply(pm.stdev(closes, bbLength), bbMult);
  const upperBB = pm.add(basis, bbDev);
  const lowerBB = pm.subtract(basis, bbDev);

  // ─── Keltner Channel ────────────────────────────────────────────────────
  const kcMa = pm.sma(closes, kcLength);
  const rangeVal = useTrueRange
    ? pm.tr(candles)
    : candles.map((c, i) => c.high - c.low);
  const rangeMa = pm.sma(rangeVal, kcLength);
  const upperKC = pm.add(kcMa, pm.multiply(rangeMa, kcMult));
  const lowerKC = pm.subtract(kcMa, pm.multiply(rangeMa, kcMult));

  // ─── Squeeze state ──────────────────────────────────────────────────────
  // sqzOn:  lowerBB > lowerKC AND upperBB < upperKC  (squeeze building)
  // sqzOff: lowerBB < lowerKC AND upperBB > upperKC  (squeeze released)
  // noSqz:  neither
  // PineScript evaluates "and" with non-boolean operands by treating
  // any non-zero/non-null value as true; we explicitly check both
  // sides are non-null before comparing.
  const sqzOn: boolean[] = new Array(candles.length).fill(false);
  const sqzOff: boolean[] = new Array(candles.length).fill(false);
  for (let i = 0; i < candles.length; i++) {
    const lbb = lowerBB[i];
    const ubb = upperBB[i];
    const lkc = lowerKC[i];
    const ukc = upperKC[i];
    if (lbb !== null && ubb !== null && lkc !== null && ukc !== null) {
      sqzOn[i] = lbb > lkc && ubb < ukc;
      sqzOff[i] = lbb < lkc && ubb > ukc;
    }
  }
  // A bar has no valid squeeze state unless BB and KC are both defined.
  const sqzValid: boolean[] = candles.map(
    (_, i) =>
      lowerBB[i] !== null &&
      upperBB[i] !== null &&
      lowerKC[i] !== null &&
      upperKC[i] !== null,
  );
  const noSqz: boolean[] = candles.map((_, i) => sqzValid[i] && !sqzOn[i] && !sqzOff[i]);

  // ─── Momentum histogram ────────────────────────────────────────────────
  // midline = math.avg(math.avg(highest(high,kcLen), lowest(low,kcLen)), sma(close,kcLen))
  const hiK = pm.highest(highs, kcLength);
  const loK = pm.lowest(lows, kcLength);
  const avgHL = pm.add(hiK, pm.multiply(loK, 0.5));
  const midline = pm.add(
    pm.multiply(avgHL, 1 / 3),
    pm.multiply(closes.map((c) => c), 0),
  );
  // PineScript: math.avg(math.avg(a, b), c) = (a + b) / 2 then (that + c) / 2
  // = (a + b + 2c) / 4. Use the direct form to avoid confusion.
  const midlineDirect: (number | null)[] = closes.map((_, i) => {
    const a = hiK[i];
    const b = loK[i];
    const c = closes[i];
    if (a === null || b === null || c === null) return null;
    return (a + b) / 4 + c / 2;
  });

  // val = linreg(close - midline, kcLength, 0)
  const delta: (number | null)[] = closes.map((c, i) => {
    const m = midlineDirect[i];
    if (c === null || m === null) return null;
    return c - m;
  });
  const val = pm.linreg(delta, kcLength, 0);

  // bullish      = val > 0
  // accelerating = bullish ? (val > nz(val[1])) : (val < nz(val[1]))
  const bullish: boolean[] = val.map((v) => v !== null && v > 0);
  const accelerating: boolean[] = val.map((v, i) => {
    if (v === null) return false;
    const prev = i > 0 ? val[i - 1] : null;
    if (bullish[i]) return prev !== null && v > prev;
    return prev !== null && v < prev;
  });

  // barColor mapping (TradingView palette translated to hex):
  //   bullish + accelerating  → color.lime   → #00E676
  //   bullish + not accel     → color.green  → #26A69A
  //   bearish + accelerating  → color.red    → #FF5252
  //   bearish + not accel     → color.maroon → #8E24AA
  const barColorHex: string[] = val.map((_, i) => {
    if (bullish[i]) return accelerating[i] ? '#00E676' : '#26A69A';
    return accelerating[i] ? '#FF5252' : '#8E24AA';
  });

  // dotColor mapping:
  //   noSqz  → color.blue  → #2196F3
  //   sqzOn  → color.black → #000000
  //   sqzOff → color.gray  → #9E9E9E
  // Bars before BB/KC warm-up have no valid squeeze state → null dot.
  const dotColorHex: (string | null)[] = candles.map((_, i) => {
    if (!sqzValid[i]) return null;
    if (noSqz[i]) return '#2196F3';
    if (sqzOn[i]) return '#000000';
    return '#9E9E9E';
  });

  // ─── Entry signal (Carter's squeeze-release rule) ───────────────────────
  // squeezeRelease = sqzOn[1] AND sqzOff
  // buySignal  = squeezeRelease AND bullish
  // sellSignal = squeezeRelease AND NOT bullish
  const signals = new Array<'buy' | 'sell' | 'neutral'>(candles.length).fill('neutral');
  for (let i = 1; i < candles.length; i++) {
    const release = sqzOn[i - 1] && sqzOff[i];
    if (!release) continue;
    if (bullish[i]) signals[i] = 'buy';
    else signals[i] = 'sell';
  }

  // ─── Plots ──────────────────────────────────────────────────────────────
  // Format momentum values with per-bar color so the chart layer can
  // color each histogram bar independently.
  const momentumColored = val.map((v, i) =>
    v === null ? null : { value: v, color: barColorHex[i] },
  );

  const dotsColored = new Array<{ value: number; color: string } | null>(
    candles.length,
  ).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const c = dotColorHex[i];
    if (c === null) continue;
    dotsColored[i] = { value: 0, color: c };
  }

  const plots: IndicatorPlot[] = [
    {
      id: 'momentum',
      title: 'Momentum',
      color: barColorHex[barColorHex.length - 1] || '#26A69A',
      type: 'histogram',
      lineWidth: 4,
      data: momentumColored as any,
      pane: 'separate',
    },
    {
      id: 'squeezeDots',
      title: 'Squeeze',
      color: '#9E9E9E',
      type: 'line',
      lineWidth: 2,
      data: dotsColored as any,
      pane: 'separate',
    },
  ];

  return { plots, signals };
}
