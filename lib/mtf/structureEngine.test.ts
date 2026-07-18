import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/types';
import type { SmcEvent, SmcObject, SmcSnapshot } from '@/lib/smc/types';
import { DEFAULT_SMC_CONFIG } from '@/lib/smc/types';
import {
  createMarketStructureSnapshot, DEFAULT_STRUCTURE_ENGINE_CONFIG, QUALITY_THRESHOLDS,
} from './structureEngine';

// ---- fixtures ----
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 6, 18); // 2026-07-18T00:00:00Z

function candles(n: number, start = T0 - 100 * HOUR): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * HOUR, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10,
  }));
}
function obj(p: Partial<SmcObject> & Pick<SmcObject, 'kind' | 'direction'>): SmcObject {
  return {
    id: `${p.kind}_${p.direction}_${p.createdAtBar ?? 0}`, scope: undefined, top: 110, bottom: 100,
    createdAtBar: 0, createdAtTime: T0 - 100 * HOUR, updatedAtBar: 0, state: 'active',
    touches: 0, strength: 50, quality: 50, confidence: 50, ...p,
  };
}
function ev(p: Partial<SmcEvent> & Pick<SmcEvent, 'type'>): SmcEvent {
  return { id: `${p.type}_${p.barIndex ?? 0}`, barIndex: 0, time: T0 - 100 * HOUR, direction: 'bullish', price: 100, ...p };
}
function snap(p?: {
  swingTrend?: 1 | -1 | 0; zone?: 'premium' | 'equilibrium' | 'discount';
  events?: SmcEvent[]; orderBlocks?: SmcObject[]; fvgs?: SmcObject[]; liquidityPools?: SmcObject[];
  confluence?: number; institutional?: number;
}): SmcSnapshot {
  return {
    metadata: { version: '1.0', config: DEFAULT_SMC_CONFIG },
    state: {
      swingTrend: p?.swingTrend ?? 1, internalTrend: 1, zone: p?.zone ?? 'discount',
      trailing: { top: 200, bottom: 90, barIndex: 0, barTime: T0, lastTopTime: T0, lastBottomTime: T0 },
      setup: 'none', setupDirection: null,
    },
    objects: {
      orderBlocks: p?.orderBlocks ?? [], fvgs: p?.fvgs ?? [],
      liquidityPools: p?.liquidityPools ?? [], structureLevels: [], zones: [],
    },
    events: p?.events ?? [],
    scores: {
      structure: 50, liquidity: 50, orderBlocks: 50, fvg: 50, premiumDiscount: 50,
      confluence: p?.confluence ?? 80, institutional: p?.institutional ?? 75,
    },
    diagnostics: { barsProcessed: 100, computeMs: 1, version: '1.0', warnings: [] },
  };
}
const input = (s: SmcSnapshot, c = candles(100), extra?: object) =>
  ({ smc: s, candles: c, symbol: 'BTCUSDT', timeframe: '1h' as const, ...extra });

// ---- tests ----
describe('createMarketStructureSnapshot', () => {
  it('fills metadata incl. engine identity and config', () => {
    const c = candles(100);
    const ms = createMarketStructureSnapshot(input(snap(), c));
    expect(ms.metadata.engine).toBe('marketStructure');
    expect(ms.metadata.snapshotVersion).toBe('1.0');
    expect(ms.metadata.symbol).toBe('BTCUSDT');
    expect(ms.metadata.timeframe).toBe('1h');
    expect(ms.metadata.lastClosedBarTime).toBe(c[99].time);
    expect(ms.metadata.config).toEqual(DEFAULT_STRUCTURE_ENGINE_CONFIG);
  });

  it('empty candles ⇒ every section insufficient_history', () => {
    const ms = createMarketStructureSnapshot(input(snap(), []));
    for (const s of [ms.structure, ms.liquidity, ms.fvg, ms.orderBlocks, ms.structureBreaks, ms.premiumDiscount, ms.timeline, ms.phase, ms.quality]) {
      expect(s).toEqual({ state: 'insufficient_history', data: null });
    }
    expect(ms.narratives).toEqual([]);
  });

  it('neutral swing trend ⇒ structure & quality warming_up', () => {
    const ms = createMarketStructureSnapshot(input(snap({ swingTrend: 0 })));
    expect(ms.structure.state).toBe('warming_up');
    expect(ms.quality.state).toBe('warming_up');
    expect(ms.liquidity.state).toBe('ready');
  });

  it('structure age: last swing CHoCH wins; null when no trend-flipping event', () => {
    const events = [
      ev({ type: 'BOS', scope: 'swing', barIndex: 10 }),
      ev({ type: 'CHOCH', scope: 'swing', barIndex: 60 }),
      ev({ type: 'CHOCH', scope: 'internal', barIndex: 90 }), // ignored (internal)
    ];
    const ms = createMarketStructureSnapshot(input(snap({ events })));
    expect(ms.structure.data?.ageBars).toBe(99 - 60);
    const none = createMarketStructureSnapshot(input(snap({ events: [] })));
    expect(none.structure.data?.ageBars).toBeNull();
  });

  it('swing sequence labels HH/HL and skips unlabeled first swings', () => {
    const events = [
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bearish', price: 110, barIndex: 10 }), // first high — unlabeled
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bullish', price: 100, barIndex: 20 }), // first low — unlabeled
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bearish', price: 120, barIndex: 30 }), // HH
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bullish', price: 105, barIndex: 40 }), // HL
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bearish', price: 130, barIndex: 50 }), // HH
    ];
    const ms = createMarketStructureSnapshot(input(snap({ events })));
    expect(ms.structure.data?.sequence).toEqual(['HH', 'HL', 'HH']);
  });

  it('liquidity: pool direction bearish = buy-side; created/swept/active split', () => {
    const pools = [
      obj({ kind: 'liquidityPool', direction: 'bearish', state: 'active' }),
      obj({ kind: 'liquidityPool', direction: 'bearish', state: 'mitigated', createdAtBar: 1 }),
      obj({ kind: 'liquidityPool', direction: 'bullish', state: 'mitigated', createdAtBar: 2 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ liquidityPools: pools })));
    expect(ms.liquidity.data?.buySide).toMatchObject({ created: 2, swept: 1, active: 1 });
    expect(ms.liquidity.data?.sellSide).toMatchObject({ created: 1, swept: 1, active: 0 });
  });

  it('createdToday uses the UTC day of the last closed bar', () => {
    const c = candles(100);
    const lastTime = c[99].time;
    const d = new Date(lastTime);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const pools = [
      obj({ kind: 'liquidityPool', direction: 'bullish', createdAtTime: day + HOUR }),
      obj({ kind: 'liquidityPool', direction: 'bullish', createdAtTime: day - HOUR, createdAtBar: 1 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ liquidityPools: pools }), c));
    expect(ms.liquidity.data?.sellSide.createdToday).toBe(1);
  });

  it('FVG: open/filled split, net bias, freshest, stacked overlap rule', () => {
    const fvgs = [
      obj({ kind: 'fvg', direction: 'bullish', state: 'active', top: 110, bottom: 100, createdAtBar: 90 }),
      obj({ kind: 'fvg', direction: 'bullish', state: 'active', top: 105, bottom: 95, createdAtBar: 80 }),  // overlaps above
      obj({ kind: 'fvg', direction: 'bullish', state: 'active', top: 90, bottom: 85, createdAtBar: 70 }),   // disjoint
      obj({ kind: 'fvg', direction: 'bullish', state: 'mitigated', createdAtBar: 10 }),
      obj({ kind: 'fvg', direction: 'bearish', state: 'active', top: 130, bottom: 125, createdAtBar: 60 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ fvgs })));
    expect(ms.fvg.data?.bullish).toMatchObject({ created: 4, open: 3, filled: 1, stacked: 2 });
    expect(ms.fvg.data?.bearish).toMatchObject({ open: 1, stacked: 0 });
    expect(ms.fvg.data?.netBias).toBe(2);
    expect(ms.fvg.data?.freshestBarsAgo).toBe(99 - 90);
  });

  it('order blocks: lifecycle split and nearest with distance %', () => {
    // last close = 100.5 + 99 = 199.5
    const obs = [
      obj({ kind: 'orderBlock', direction: 'bullish', state: 'active', top: 180, bottom: 170 }),
      obj({ kind: 'orderBlock', direction: 'bullish', state: 'tested', top: 150, bottom: 140, createdAtBar: 1 }),
      obj({ kind: 'orderBlock', direction: 'bullish', state: 'invalidated', top: 120, bottom: 110, createdAtBar: 2 }),
      obj({ kind: 'orderBlock', direction: 'bearish', state: 'mitigated', top: 220, bottom: 210, createdAtBar: 3 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ orderBlocks: obs })));
    expect(ms.orderBlocks.data?.bullish).toMatchObject({ created: 3, fresh: 1, broken: 1, mitigated: 0 });
    expect(ms.orderBlocks.data?.nearestBullish?.price).toBe(180);
    expect(ms.orderBlocks.data?.nearestBullish?.distancePct).toBeCloseTo(((199.5 - 180) / 199.5) * 100, 2);
    expect(ms.orderBlocks.data?.nearestBearish).toBeNull(); // only OB is mitigated
  });

  it('windowed break counts respect structureWindowBars and config override', () => {
    const events = [
      ev({ type: 'BOS', direction: 'bullish', barIndex: 50 }),  // outside 20-bar window
      ev({ type: 'BOS', direction: 'bullish', barIndex: 95 }),
      ev({ type: 'CHOCH', direction: 'bearish', barIndex: 98 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ events })));
    expect(ms.structureBreaks.data?.window).toEqual({ bullishBos: 1, bearishBos: 0, bullishChoch: 0, bearishChoch: 1 });
    expect(ms.structureBreaks.data?.lifetime.bullishBos).toBe(2);
    const wide = createMarketStructureSnapshot(input(snap({ events })), { structureWindowBars: 60 });
    expect(wide.structureBreaks.data?.window.bullishBos).toBe(2);
  });

  it('per-TF strip windows each timeframe by its own bar count', () => {
    const perTf = [{
      timeframe: '4h' as const, barsProcessed: 50,
      events: [ev({ type: 'BOS', direction: 'bearish', barIndex: 45 }), ev({ type: 'BOS', direction: 'bearish', barIndex: 10 })],
    }];
    const ms = createMarketStructureSnapshot(input(snap(), candles(100), { perTf }));
    expect(ms.structureBreaks.data?.perTf).toEqual([
      { timeframe: '4h', bullishBos: 0, bearishBos: 1, bullishChoch: 0, bearishChoch: 0 },
    ]);
  });

  it('timeline: significant only, collapsed, capped, oldest → newest, refs kept', () => {
    const events = [
      ev({ type: 'FVG_FILLED', barIndex: 1 }),                                    // excluded
      ev({ type: 'LIQUIDITY_SWEEP', direction: 'bullish', barIndex: 2, time: T0 - 98 * HOUR }),
      ev({ type: 'FVG_CREATED', direction: 'bullish', barIndex: 3 }),
      ev({ type: 'FVG_CREATED', direction: 'bullish', barIndex: 4 }),             // collapses with the one above
      ev({ type: 'CHOCH', direction: 'bullish', barIndex: 5 }),
      ev({ type: 'BOS', direction: 'bullish', barIndex: 6 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ events })));
    const items = ms.timeline.data!.items;
    expect(items.map((i) => i.label)).toEqual([
      'Sell-side Liquidity Sweep', 'Bullish FVG Created', 'Bullish CHoCH', 'Bullish BOS',
    ]);
    expect(items[0]).toMatchObject({ eventType: 'LIQUIDITY_SWEEP', barIndex: 2, timestamp: T0 - 98 * HOUR });
    expect(items[0].eventId).toBeTruthy();
    const capped = createMarketStructureSnapshot(input(snap({ events })), { timelineLength: 2 });
    expect(capped.timeline.data!.items).toHaveLength(2);
  });

  it('no significant events ⇒ timeline warming_up; phase from screener label', () => {
    const ms = createMarketStructureSnapshot(input(snap({ events: [ev({ type: 'FVG_FILLED' })] })));
    expect(ms.timeline).toEqual({ state: 'warming_up', data: null });
    expect(ms.phase.state).toBe('warming_up');
    const withPhase = createMarketStructureSnapshot(input(snap(), candles(100), { phaseLabel: 'Waiting for Bullish Order Block Retest' }));
    expect(withPhase.phase).toEqual({ state: 'ready', data: { label: 'Waiting for Bullish Order Block Retest' } });
  });

  it('quality thresholds at boundaries; summary present', () => {
    const q = (confluence: number) =>
      createMarketStructureSnapshot(input(snap({ confluence }))).quality.data!.classification;
    expect(q(90)).toBe('Excellent');
    expect(q(89)).toBe('Strong');
    expect(q(75)).toBe('Strong');
    expect(q(74)).toBe('Moderate');
    expect(q(55)).toBe('Moderate');
    expect(q(54)).toBe('Weak');
    expect(QUALITY_THRESHOLDS).toEqual({ excellent: 90, strong: 75, moderate: 55 });
    const ms = createMarketStructureSnapshot(input(snap()));
    expect(ms.quality.data!.summary.length).toBeGreaterThan(0);
    expect(ms.quality.data!.confidence).toBe(80);
  });

  it('narratives are descriptive — banned predictive vocabulary never appears', () => {
    const banned = /\b(likely|expected|will|probable|should|forecast|anticipat\w*|predict\w*)\b/i;
    const cases = [
      snap(),
      snap({ swingTrend: -1, zone: 'premium', liquidityPools: [obj({ kind: 'liquidityPool', direction: 'bearish', state: 'mitigated' })] }),
      snap({
        zone: 'equilibrium',
        orderBlocks: [obj({ kind: 'orderBlock', direction: 'bullish' })],
        fvgs: [obj({ kind: 'fvg', direction: 'bearish' })],
        liquidityPools: [obj({ kind: 'liquidityPool', direction: 'bullish', state: 'mitigated' })],
      }),
    ];
    for (const s of cases) {
      const ms = createMarketStructureSnapshot(input(s));
      for (const line of [...ms.narratives, ms.quality.data?.summary ?? '']) {
        expect(line).not.toMatch(banned);
      }
      expect(ms.narratives.length).toBeGreaterThan(0);
    }
  });

  it('default-drift guard: implicit config === explicit defaults (modulo timing)', () => {
    const s = snap({ events: [ev({ type: 'BOS', barIndex: 95 })] });
    const strip = (m: ReturnType<typeof createMarketStructureSnapshot>) => ({
      ...m, metadata: { ...m.metadata, createdAt: 0, computationTimeMs: 0 },
    });
    const a = createMarketStructureSnapshot(input(s));
    const b = createMarketStructureSnapshot(input(s), { structureWindowBars: 20, timelineLength: 7 });
    expect(strip(a)).toEqual(strip(b));
  });

  it('determinism: same inputs ⇒ identical snapshot (modulo timing)', () => {
    const s = snap({ events: [ev({ type: 'CHOCH', scope: 'swing', barIndex: 40 })] });
    const strip = (m: ReturnType<typeof createMarketStructureSnapshot>) => ({
      ...m, metadata: { ...m.metadata, createdAt: 0, computationTimeMs: 0 },
    });
    expect(strip(createMarketStructureSnapshot(input(s)))).toEqual(strip(createMarketStructureSnapshot(input(s))));
  });
});
