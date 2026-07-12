import { describe, it, expect } from 'vitest';
import { TRADER_STYLES, getStyleProfile } from './styleProfiles';
import { TIMEFRAMES } from '@/lib/types';

describe('trader style profiles', () => {
  it('covers all six styles with unique ids', () => {
    expect(TRADER_STYLES.map((s) => s.id)).toEqual(['scalper', 'intraday', 'swing', 'position', 'smc', 'custom']);
  });

  it('every ladder uses supported timeframes and sane exits', () => {
    for (const s of TRADER_STYLES) {
      expect(TIMEFRAMES).toContain(s.ladder.primary);
      expect(TIMEFRAMES).toContain(s.ladder.confirmation);
      expect(TIMEFRAMES).toContain(s.ladder.higherTrend);
      expect(s.exits.slAtr).toBeGreaterThan(0);
      expect(s.exits.tp1R).toBeLessThanOrEqual(s.exits.tp2R);
      expect(s.exits.tp2R).toBeLessThanOrEqual(s.exits.tp3R);
      expect(s.blurb.length).toBeGreaterThan(10);
    }
  });

  it('faster styles use faster primaries and tighter stops than slower styles', () => {
    const order = (tf: string) => TIMEFRAMES.indexOf(tf as (typeof TIMEFRAMES)[number]);
    const scalper = getStyleProfile('scalper');
    const swing = getStyleProfile('swing');
    const position = getStyleProfile('position');
    expect(order(scalper.ladder.primary)).toBeLessThan(order(swing.ladder.primary));
    expect(order(swing.ladder.primary)).toBeLessThanOrEqual(order(position.ladder.primary));
    expect(scalper.exits.slAtr).toBeLessThan(position.exits.slAtr);
  });

  it('getStyleProfile falls back to custom', () => {
    expect(getStyleProfile('nope' as never).id).toBe('custom');
  });
});
