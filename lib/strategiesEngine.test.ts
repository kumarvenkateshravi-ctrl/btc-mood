import { describe, it, expect } from 'vitest';
import {
  STRATEGIES, STRATEGY_BY_ID, strategyHealth, healthLabel, comparisonRows,
  rankStrategies, OPPORTUNITIES, CATEGORIES,
} from './strategiesEngine';

describe('strategyHealth', () => {
  it('uniform inputs return that value, bounded', () => {
    expect(strategyHealth({ trend: 90, alignment: 90, momentum: 90, volume: 90, volatility: 90, regime: 90, stackScore: 90 })).toBe(90);
    expect(strategyHealth({ trend: 999, alignment: 999, momentum: 999, volume: 999, volatility: 999, regime: 999, stackScore: 999 })).toBe(100);
  });
  it('labels by band', () => {
    expect(healthLabel(94)).toBe('Excellent');
    expect(healthLabel(79)).toBe('Strong');
    expect(healthLabel(61)).toBe('Good');
    expect(healthLabel(42)).toBe('Fair');
    expect(healthLabel(20)).toBe('Weak');
  });
});

describe('strategy library', () => {
  it('has the five designed strategies with sane metrics', () => {
    expect(STRATEGIES.length).toBe(5);
    expect(STRATEGY_BY_ID['trend-continuation'].topPick).toBe(true);
    for (const s of STRATEGIES) {
      expect(s.winRate).toBeGreaterThan(0);
      expect(s.winRate).toBeLessThanOrEqual(100);
      expect(s.dna.trendStrength).toBeLessThanOrEqual(10);
      expect(s.suitability).toHaveLength(6);
      expect(s.bestTimeframes).toHaveLength(4);
      expect(s.categories.every((c) => CATEGORIES.includes(c))).toBe(true);
    }
  });
  it('ranks the trend strategy highest and feeds comparison', () => {
    expect(rankStrategies()[0].id).toBe('trend-continuation');
    const rows = comparisonRows();
    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe('Trend Continuation');
    expect(rows[0].winRate).toBe(74);
  });
  it('exposes a ranked live opportunity feed', () => {
    expect(OPPORTUNITIES.length).toBeGreaterThan(0);
    expect(OPPORTUNITIES[0].health).toBeGreaterThanOrEqual(OPPORTUNITIES[OPPORTUNITIES.length - 1].health);
  });
});
