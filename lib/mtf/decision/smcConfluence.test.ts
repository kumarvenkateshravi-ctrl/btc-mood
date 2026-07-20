import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import type { SmcObject, SmcSnapshot } from '../../smc/types';
import { buildSetup } from './levels';
import { applySmcConfluence } from './smcConfluence';

const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));
const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107];

// Canonical long core: zone [105, 105.5], stop 103, targets [111 rr 2.56, 109.75 rr 2], atr 2, lastClose 107.
const core = () => {
  const out = buildSetup('long', bars(LONG));
  if (out.kind !== 'setup') throw new Error('fixture broke');
  return out.setup;
};

const obj = (o: Partial<SmcObject> & Pick<SmcObject, 'kind' | 'direction' | 'top' | 'bottom' | 'state'>): SmcObject => ({
  id: 'x', scope: 'swing', createdAtBar: 0, createdAtTime: 0, updatedAtBar: 0,
  touches: 0, strength: 50, quality: 50, confidence: 50, ...o,
});

const grouped = (...objs: SmcObject[]): SmcSnapshot['objects'] => ({
  orderBlocks: objs.filter((o) => o.kind === 'orderBlock'),
  fvgs: objs.filter((o) => o.kind === 'fvg'),
  liquidityPools: objs.filter((o) => o.kind === 'liquidityPool'),
  structureLevels: [],
  zones: [],
});

describe('M9 SMC confluence refiner — bounded, additive, audited', () => {
  it('entry snap: overlapping bullish order block re-anchors the zone', () => {
    const { setup, notes } = applySmcConfluence(core(), 'long', 107, grouped(
      obj({ kind: 'orderBlock', direction: 'bullish', top: 105.3, bottom: 104.6, state: 'active' }),
    ));
    expect(setup.entry.zone).toEqual([104.6, 105.3]);
    expect(setup.entry.basis.source).toBe('smc_orderblock');
    expect(setup.entry.type).toBe('pullback');
    expect(setup.stop.price).toBe(103);
    expect(setup.stop.distancePct).toBe(1.86);
    expect(setup.targets[0]).toMatchObject({ price: 111, rr: 3.1 });
    expect(setup.targets[1]).toMatchObject({ price: 108.85, rr: 2 });
    expect(notes).toEqual([{
      code: 'ENTRY_SNAPPED_OB', field: 'entry', before: 105.25, after: 104.95,
      message: expect.stringContaining('order block'),
    }]);
  });

  it('snap tolerance: band 1.1 beyond the zone (> 0.5·ATR) is ignored', () => {
    const before = core();
    const { setup, notes } = applySmcConfluence(before, 'long', 107, grouped(
      obj({ kind: 'orderBlock', direction: 'bullish', top: 103.9, bottom: 103.2, state: 'active' }),
    ));
    expect(setup).toEqual(before);
    expect(notes).toEqual([]);
  });

  it('stop extension: pool just beyond the stop moves it past the pool + warns', () => {
    const { setup, notes, warnings } = applySmcConfluence(core(), 'long', 107, grouped(
      obj({ kind: 'liquidityPool', direction: 'bearish', top: 102.5, bottom: 102.5, state: 'active' }),
    ));
    expect(setup.stop.price).toBe(102.3);
    expect(setup.stop.source).toBe('smc_liquidity');
    expect(setup.stop.distancePct).toBe(2.8);
    expect(setup.targets[0]).toMatchObject({ price: 111, rr: 1.95 });
    expect(setup.targets[1]).toMatchObject({ price: 111.15, rr: 2 });
    expect(notes).toEqual([{
      code: 'STOP_EXTENDED_LIQUIDITY', field: 'stop', before: 103, after: 102.3,
      message: expect.stringContaining('liquidity'),
    }]);
    expect(warnings).toEqual([{
      code: 'STOP_HUNT_RISK', severity: 'warning', message: expect.stringContaining('liquidity'),
    }]);
  });

  it('stop extension bound: pool beyond 0.75·ATR is ignored', () => {
    const before = core();
    const { setup } = applySmcConfluence(before, 'long', 107, grouped(
      obj({ kind: 'liquidityPool', direction: 'bearish', top: 101, bottom: 101, state: 'active' }),
    ));
    expect(setup).toEqual(before);
  });

  it('target upgrade: opposing pool between zone and target becomes target 1', () => {
    const { setup, notes } = applySmcConfluence(core(), 'long', 107, grouped(
      obj({ kind: 'liquidityPool', direction: 'bullish', top: 109, bottom: 109, state: 'tested' }),
    ));
    expect(setup.targets[0]).toMatchObject({ price: 109, source: 'smc_liquidity', rr: 1.67 });
    expect(setup.targets[1]).toMatchObject({ price: 109.75, rr: 2 });
    expect(setup.rr).toBe(1.67);
    expect(notes).toEqual([{
      code: 'TARGET_LIQUIDITY', field: 'target', before: 111, after: 109,
      message: expect.stringContaining('liquidity'),
    }]);
  });

  it('target upgrade rejected when it drops RR below minRR', () => {
    const before = core();
    const { setup, notes } = applySmcConfluence(before, 'long', 107, grouped(
      obj({ kind: 'liquidityPool', direction: 'bullish', top: 107.5, bottom: 107.5, state: 'active' }),
    ));
    expect(setup).toEqual(before);
    expect(notes).toEqual([]);
  });

  it('identity: no objects, or only ineligible states, change nothing', () => {
    const before = core();
    expect(applySmcConfluence(before, 'long', 107, grouped()).setup).toEqual(before);
    const { setup, notes, warnings } = applySmcConfluence(before, 'long', 107, grouped(
      obj({ kind: 'orderBlock', direction: 'bullish', top: 105.3, bottom: 104.6, state: 'mitigated' }),
    ));
    expect(setup).toEqual(before);
    expect(notes).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
