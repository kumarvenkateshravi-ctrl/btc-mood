import { describe, expect, it } from 'vitest';
import { previewProtection } from './protectionPreview';

const long = { id: 'l', symbol: 'BTCUSDT', side: 'long' as const, units: 2, entryPrice: 100, realizedPnl: 0, feesPaid: 0, openedAt: 1, tp: 120, sl: 90, liquidated: false, leverage: 10, trailingSl: false, trailingBest: null };
const short = { ...long, id: 's', side: 'short' as const, sl: 110, tp: 80 };

describe('previewProtection', () => {
  it('keeps protection preview pure and identifies long break-even', () => {
    const result = previewProtection(long, { sl: 100 });
    expect(result.kind).toBe('break-even');
    expect(result.pnlAtLevel).toBe(0);
    expect(long.sl).toBe(90);
  });
  it('reports a short protective stop consistently', () => {
    expect(previewProtection(short, { sl: 105 }).pnlAtLevel).toBe(-10);
    expect(previewProtection(short, { tp: 75 }).pnlAtLevel).toBe(50);
  });
});
