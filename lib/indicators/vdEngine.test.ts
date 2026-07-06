import { describe, it, expect } from 'vitest';
import {
  splitCompletedPeriods, adaptiveBins, adaptiveThreshold, extractPeriodZones,
  walkZoneLifecycle, zoneHealth, classifyZone, zoneConfidence,
  buildVdZones, generateVdSignals, VD_DEFAULTS,
  type VdZone,
} from './vdEngine';
import type { Candle } from '../types';

const bar = (time: number, low: number, high: number, close: number, volume: number, open = close): Candle =>
  ({ time, open, high, low, close, volume } as Candle);

describe('splitCompletedPeriods', () => {
  it('splits UTC days and drops the live trailing period', () => {
    const c = [
      bar(0, 1, 2, 1.5, 10), bar(43200, 1, 2, 1.5, 10),          // day 0
      bar(86400, 1, 2, 1.5, 10), bar(129600, 1, 2, 1.5, 10),     // day 1
      bar(172800, 1, 2, 1.5, 10),                                  // day 2 (live — dropped)
    ];
    const slices = splitCompletedPeriods(c, 'D');
    expect(slices).toHaveLength(2);
    expect(slices[0]).toMatchObject({ start: 0, end: 1 });
    expect(slices[1]).toMatchObject({ start: 2, end: 3 });
  });
});

describe('adaptive parameters', () => {
  it('bins scale with range/ATR and clamp to 30..120', () => {
    expect(adaptiveBins(8, 1)).toBe(48);
    expect(adaptiveBins(8, 0.2)).toBe(120);
    expect(adaptiveBins(1, 1)).toBe(30);
    expect(adaptiveBins(8, null)).toBe(50);
    expect(adaptiveBins(0, 1)).toBe(50);
  });
  it('threshold scales with relative range and clamps to 7..15', () => {
    expect(adaptiveThreshold(8, 8, 10)).toBe(10);
    expect(adaptiveThreshold(16, 8, 10)).toBe(15);
    expect(adaptiveThreshold(4, 8, 10)).toBe(7);
    expect(adaptiveThreshold(8, null, 10)).toBe(10);
  });
});

describe('extractPeriodZones (hand-computed histogram)', () => {
  // 4 bars over range 100..108, bins=4 (r=2), threshold 25% of vol 160 = 40.
  const candles = [
    bar(0, 106, 108, 107, 40),   // bin3: vol 40, buy 20
    bar(1, 104, 108, 105, 40),   // bins 2,3: vol 20 each; buy 5 each
    bar(2, 100, 104, 101, 60),   // bins 0,1: vol 30 each; buy 7.5 each
    bar(3, 100, 102, 102, 20),   // bin0: vol 20, buy 20
  ];
  const slice = { start: 0, end: 3, key: 0 };
  const pz = extractPeriodZones(candles, slice, 4, 25);

  it('extracts the supply zone from the top of the histogram', () => {
    expect(pz.supply).not.toBeNull();
    expect(pz.supply!.upper).toBeCloseTo(108, 9);
    expect(pz.supply!.lower).toBeCloseTo(106, 9);
    expect(pz.supply!.volume).toBeCloseTo(60, 6);
    expect(pz.supply!.weightedAverage).toBeCloseTo(107, 6);
    expect(pz.supply!.buyVolume).toBeCloseTo(25, 6);
    expect(pz.supply!.volShare).toBeCloseTo(0.375, 6);
  });
  it('extracts the demand zone from the bottom', () => {
    expect(pz.demand).not.toBeNull();
    expect(pz.demand!.upper).toBeCloseTo(102, 9);
    expect(pz.demand!.lower).toBeCloseTo(100, 9);
    expect(pz.demand!.volume).toBeCloseTo(50, 6);
    expect(pz.demand!.weightedAverage).toBeCloseTo(101, 6);
    expect(pz.demand!.buyVolume).toBeCloseTo(27.5, 6);
    expect(pz.demand!.volShare).toBeCloseTo(0.3125, 6);
  });
  it('degenerate flat period yields no zones', () => {
    const flat = [bar(0, 100, 100, 100, 10)];
    const out = extractPeriodZones(flat, { start: 0, end: 0, key: 0 }, 4, 25);
    expect(out.supply).toBeNull();
    expect(out.demand).toBeNull();
  });
});

describe('walkZoneLifecycle', () => {
  const zone = { upper: 102, lower: 100, kind: 'demand' as const };
  const atr1 = (n: number) => new Array<number | null>(n).fill(1);

  it('counts touch episodes and scores the reaction', () => {
    const c = [
      bar(0, 103, 104, 103.5, 10),
      bar(1, 101, 103, 102.5, 10),  // touch (episode 1), close outside
      bar(2, 103, 106, 105, 10),    // left zone → reaction mfe = 106-102 = 4 → clamp(4/2)=1
      bar(3, 103, 104, 103.5, 10),
    ];
    const r = walkZoneLifecycle(c, zone, 0, 3, atr1(4), 3);
    expect(r.touches).toBe(1);
    expect(r.status).toBe('retest1');
    expect(r.reactionScore).toBeCloseTo(1, 6);
    expect(r.brokenAtIndex).toBeNull();
  });
  it('acceptance: 3 consecutive closes inside → consumed', () => {
    const c = [
      bar(0, 100.5, 102.5, 101, 10),
      bar(1, 100.5, 102.5, 101.5, 10),
      bar(2, 100.5, 102.5, 101, 10),
    ];
    const r = walkZoneLifecycle(c, zone, 0, 2, atr1(3), 3);
    expect(r.status).toBe('consumed');
    expect(r.acceptanceBars).toBe(3);
  });
  it('body fully beyond the distal edge → broken', () => {
    const c = [bar(0, 98.5, 100.2, 99, 10, 99.5)]; // body 99.5→99 fully below 100
    const r = walkZoneLifecycle(c, zone, 0, 0, atr1(1), 3);
    expect(r.status).toBe('broken');
    expect(r.brokenAtIndex).toBe(0);
  });
  it('wick pierce + reclaim close → sweep', () => {
    const c = [bar(0, 99, 102.5, 101, 10, 101.5)]; // low 99 < 100, close back above
    const r = walkZoneLifecycle(c, zone, 0, 0, atr1(1), 3);
    expect(r.swept).toBe(true);
    expect(r.status).not.toBe('broken');
  });
});

describe('scoring helpers', () => {
  it('health ladder', () => {
    expect(zoneHealth('fresh', 0)).toBe(100);
    expect(zoneHealth('retest2', 2)).toBe(60);
    expect(zoneHealth('weak', 5)).toBe(20);
    expect(zoneHealth('consumed', 1)).toBe(10);
    expect(zoneHealth('broken', 0)).toBe(0);
  });
  it('classification priority', () => {
    expect(classifyZone(0.20, 10, 0.3, false)).toBe('institutional'); // ≥1.5×thr & |imb|≥0.2
    expect(classifyZone(0.20, 10, 0.1, true)).toBe('exhaustion');
    expect(classifyZone(0.13, 10, 0, false)).toBe('major');           // ≥1.2×thr
    expect(classifyZone(0.10, 10, 0, false)).toBe('minor');
  });
  it('confidence blend bounds', () => {
    expect(zoneConfidence({ volQuality: 1, health: 100, reaction: 1, trendAlign: 1, clustered: 1, proximity: 1 })).toBe(100);
    expect(zoneConfidence({ volQuality: 0, health: 0, reaction: 0, trendAlign: 0, clustered: 0, proximity: 0 })).toBe(0);
  });
});

describe('generateVdSignals (closed-bar)', () => {
  const zone: VdZone = {
    id: 'D:demand:0', kind: 'demand', tf: 'D',
    upper: 102, lower: 100, midpoint: 101, weightedAverage: 101,
    volume: 50, buyVolume: 30, sellVolume: 20, delta: 10, imbalance: 0.2,
    threshold: 10, volShare: 0.3, periodRange: 10,
    formedAtIndex: 5, formedTime: 0, endIndex: null,
    status: 'fresh', health: 100, touches: 0, acceptanceBars: 0,
    reactionScore: 0, swept: false, classification: 'major',
    clustered: false, confidence: 70, brokenAtIndex: null,
  };
  const cfg = { ...VD_DEFAULTS, tfs: ['D' as const], trendFilter: false };

  const mkCandles = (rejectionAt: number, total: number, rejVol = 300): Candle[] => {
    const cs: Candle[] = [];
    for (let i = 0; i < total; i++) {
      if (i === rejectionAt) cs.push(bar(i * 60, 101, 103.5, 103, rejVol)); // touch + close above upper
      else cs.push(bar(i * 60, 103, 104, 103.5, 100));
    }
    return cs;
  };

  it('emits a buy with SL below the zone and TP3 = measured move', () => {
    const sigs = generateVdSignals(mkCandles(20, 23), [zone], cfg);
    expect(sigs).toHaveLength(1);
    const s = sigs[0];
    expect(s.side).toBe('buy');
    expect(s.index).toBe(20);
    expect(s.entry).toBeCloseTo(103, 9);
    expect(s.stopLoss).toBeLessThan(100);
    expect(s.tp3).toBeCloseTo(113, 9); // entry + periodRange
    expect(s.riskReward).toBeGreaterThanOrEqual(cfg.minRR);
  });
  it('never signals on the forming (last) bar', () => {
    const sigs = generateVdSignals(mkCandles(22, 23), [zone], cfg);
    expect(sigs).toHaveLength(0);
  });
  it('volume gate blocks low-volume rejections', () => {
    const sigs = generateVdSignals(mkCandles(20, 23, 110), [zone], cfg);
    expect(sigs).toHaveLength(0);
  });
});

describe('walkVdTrades (trade lifecycle)', () => {
  const buySig: import('./vdEngine').VdSignal = {
    side: 'buy', zoneId: 'D:demand:0', tf: 'D', index: 2,
    entry: 103, stopLoss: 100, tp1: 108, tp2: 110, tp3: 113,
    riskReward: 1.7, swept: false, confidence: 70,
  };
  const b = (i: number, low: number, high: number): Candle =>
    ({ time: i * 60, open: low + 0.1, high, low, close: (low + high) / 2, volume: 100 } as Candle);

  it('progresses TP1 → TP2 → TP3 with exact MFE/realized R', async () => {
    const { walkVdTrades } = await import('./vdEngine');
    const candles = [b(0, 100, 104), b(1, 101, 104), b(2, 101, 104),
      b(3, 102, 109), b(4, 104, 111), b(5, 105, 114)];
    const [t] = walkVdTrades(candles, [buySig]);
    expect(t.status).toBe('tp3');
    expect(t.resolvedIndex).toBe(5);
    expect(t.exitPrice).toBe(113);
    expect(t.realizedR).toBeCloseTo(10 / 3, 6);
    expect(t.mfeR).toBeGreaterThanOrEqual(10 / 3);
    expect(t.barsHeld).toBe(3);
  });
  it('stop-first on a bar spanning both stop and target', async () => {
    const { walkVdTrades } = await import('./vdEngine');
    const candles = [b(0, 100, 104), b(1, 101, 104), b(2, 101, 104), b(3, 99.5, 109)];
    const [t] = walkVdTrades(candles, [buySig]);
    expect(t.status).toBe('stopped');
    expect(t.exitPrice).toBe(100);
    expect(t.realizedR).toBeCloseTo(-1, 6);
  });
  it('stays active while unresolved', async () => {
    const { walkVdTrades } = await import('./vdEngine');
    const candles = [b(0, 100, 104), b(1, 101, 104), b(2, 101, 104), b(3, 102, 106)];
    const [t] = walkVdTrades(candles, [buySig]);
    expect(t.status).toBe('active');
    expect(t.resolvedIndex).toBeNull();
    expect(t.realizedR).toBeNull();
  });

  it('break-even after TP1: a pullback stops at entry for 0R, not −1R', async () => {
    const { walkVdTrades } = await import('./vdEngine');
    const candles = [b(0, 100, 104), b(1, 101, 104), b(2, 101, 104),
      b(3, 104, 109),   // tp1 hit (109 ≥ 108), low 104 stays above sl → BE to 103
      b(4, 102.5, 106)]; // low ≤ 103 → stopped at break-even
    const [t] = walkVdTrades(candles, [buySig], { beAfterTp1: true, trailAtr: 0, contextExit: false });
    expect(t.status).toBe('stopped');
    expect(t.exitPrice).toBeCloseTo(103, 9);
    expect(t.realizedR).toBeCloseTo(0, 6);
  });

  it('trailing after TP2 locks in profit above break-even', async () => {
    const { walkVdTrades } = await import('./vdEngine');
    // Constant TR=2 bars (flat 100-102) so Wilder ATR14 is exactly 2.
    const flat: Candle[] = [];
    for (let i = 0; i < 16; i++) flat.push({ time: i * 60, open: 101, high: 102, low: 100, close: 101, volume: 100 } as Candle);
    const sig = { ...buySig, index: 15, tp3: 200 };
    const candles = [
      ...flat,
      { time: 16 * 60, open: 104, high: 111, low: 104, close: 110, volume: 100 } as Candle, // tp1+tp2; trail → 110−2 = 108
      { time: 17 * 60, open: 110, high: 112.5, low: 108.5, close: 112, volume: 100 } as Candle, // low > 108; trail → 110
      { time: 18 * 60, open: 112, high: 112.5, low: 108.5, close: 110, volume: 100 } as Candle, // dips into the trail → stopped
    ];
    const [t] = walkVdTrades(candles, [sig], { beAfterTp1: true, trailAtr: 1, contextExit: false });
    expect(t.status).toBe('stopped');
    // Trail = close-watermark − 1×ATR (ATR ≈ 2.6 after the breakout bar's TR),
    // well above break-even: profit locked, not just protected.
    expect(t.exitPrice!).toBeGreaterThan(107);
    expect(t.realizedR!).toBeGreaterThan(1);
  });

  it('context flip (EMA9/21 cross against the trade) exits before the stop', async () => {
    const { walkVdTrades } = await import('./vdEngine');
    const candles: Candle[] = [];
    let p = 100;
    for (let i = 0; i < 30; i++) { p += 1; candles.push({ time: i * 60, open: p - 1, high: p + 0.5, low: p - 1.5, close: p, volume: 100 } as Candle); } // rally to 130
    for (let i = 30; i < 48; i++) { p -= 1.5; candles.push({ time: i * 60, open: p + 1.5, high: p + 2, low: p - 0.5, close: p, volume: 100 } as Candle); } // reversal
    const sig = { ...buySig, index: 29, entry: 129, stopLoss: 90, tp1: 300, tp2: 310, tp3: 320 };
    const [t] = walkVdTrades(candles, [sig], { beAfterTp1: false, trailAtr: 0, contextExit: true });
    expect(t.status).toBe('exit');
    expect(t.exitPrice).not.toBeNull();
    expect(t.exitPrice!).toBeGreaterThan(sig.stopLoss); // saved from the full −1R stop
  });
});

describe('buildVdZones (end-to-end structural)', () => {
  it('produces valid zones over multi-day data', () => {
    const cs: Candle[] = [];
    let p = 100;
    for (let i = 0; i < 24 * 6; i++) {
      p = Math.max(1, p + Math.sin(i / 7) * 2 + 0.1);
      cs.push(bar(1_600_000_000 + i * 3600, p - 1, p + 1, p, 500 + (i % 24) * 30, p - 0.2));
    }
    const zones = buildVdZones(cs, { ...VD_DEFAULTS, tfs: ['D'] });
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(z.upper).toBeGreaterThan(z.lower);
      expect(z.weightedAverage).toBeGreaterThanOrEqual(z.lower);
      expect(z.weightedAverage).toBeLessThanOrEqual(z.upper);
      expect(z.confidence).toBeGreaterThanOrEqual(0);
      expect(z.confidence).toBeLessThanOrEqual(100);
      expect(z.formedAtIndex).toBeGreaterThan(0);
      expect(['fresh', 'retest1', 'retest2', 'weak', 'consumed', 'broken']).toContain(z.status);
    }
  });
});
