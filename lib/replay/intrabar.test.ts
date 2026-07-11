import { describe, it, expect } from 'vitest';
import { intrabarSubBars } from './intrabar';
import { reconcile, type PaperPosition } from '@/lib/paper';
import type { Candle } from '@/lib/types';

const bar = (o: number, h: number, l: number, c: number, t = 1000): Candle =>
  ({ time: t, open: o, high: h, low: l, close: c, volume: 8 });

/** Walk a bar's intrabar path against a position, replaySession-style. */
function walk(pos: PaperPosition, b: Candle): number[] {
  let position: PaperPosition | null = pos;
  const pnls: number[] = [];
  for (const sub of intrabarSubBars(b)) {
    if (!position || position.side === 'flat') break;
    const r = reconcile(position, sub, [], sub.time);
    position = r.position && r.position.side !== 'flat' ? r.position : null;
    for (const t of r.trades) pnls.push(t.realizedPnl);
  }
  return pnls;
}

const longPos = (over: Partial<PaperPosition> = {}): PaperPosition =>
  ({ id: 'p', symbol: 'TEST', side: 'long', units: 1, entryPrice: 100, leverage: 10, tp: null, sl: null, openedAt: 1, ...over }) as PaperPosition;
const shortPos = (over: Partial<PaperPosition> = {}): PaperPosition =>
  ({ ...longPos(), side: 'short', ...over }) as PaperPosition;

describe('intrabarSubBars', () => {
  it('up bar walks O→L→H→C; down bar walks O→H→L→C', () => {
    expect(intrabarSubBars(bar(100, 106, 97, 105)).map((s) => s.close)).toEqual([100, 97, 106, 105]);
    expect(intrabarSubBars(bar(100, 106, 97, 98)).map((s) => s.close)).toEqual([100, 106, 97, 98]);
  });

  it('preserves aggregate volume', () => {
    const subs = intrabarSubBars(bar(100, 106, 97, 105));
    expect(subs.reduce((s, x) => s + x.volume, 0)).toBeCloseTo(8);
  });
});

describe('intrabar execution order (long with TP 105 and SL 98 both inside the bar)', () => {
  it('up bar stops out first (dip before rally)', () => {
    const pnls = walk(longPos({ tp: 105, sl: 98 }), bar(100, 106, 97, 105));
    expect(pnls.length).toBe(1);
    expect(pnls[0]).toBeLessThan(0); // filled at SL 98, never saw the TP
  });

  it('down bar takes profit first (pop before drop)', () => {
    const pnls = walk(longPos({ tp: 105, sl: 98 }), bar(100, 106, 97, 98.5));
    expect(pnls.length).toBe(1);
    expect(pnls[0]).toBeGreaterThan(0); // filled at TP 105 before the sell-off
  });
});

describe('short-side wick fixes in reconcile', () => {
  it('short SL is hit by the HIGH wick', () => {
    const r = reconcile(shortPos({ sl: 105 }), bar(100, 106, 99, 100.5), [], 1000);
    expect(r.trades.length).toBe(1);
    expect(r.trades[0].realizedPnl).toBeLessThan(0);
  });

  it('short TP is hit by the LOW wick', () => {
    const r = reconcile(shortPos({ tp: 95 }), bar(100, 101, 94, 99.5), [], 1000);
    expect(r.trades.length).toBe(1);
    expect(r.trades[0].realizedPnl).toBeGreaterThan(0);
  });
});
