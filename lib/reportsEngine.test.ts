import { describe, it, expect } from 'vitest';
import {
  KPIS, STRATEGY_ROWS, PORTFOLIO, STACK_SCORE_ROWS, EMOTIONS, GOALS, CALENDAR,
  gradeForScore, totalStrategyProfit, bestStrategy, allocationSum, EXEC_SUMMARY,
} from './reportsEngine';

describe('reports helpers', () => {
  it('grades by score band', () => {
    expect(gradeForScore(94)).toBe('A+');
    expect(gradeForScore(86)).toBe('A');
    expect(gradeForScore(70)).toBe('C');
    expect(gradeForScore(20)).toBe('F');
  });
  it('aggregates strategy profit and names the best one', () => {
    expect(totalStrategyProfit()).toBeGreaterThan(0);
    expect(bestStrategy().name).toBe('Trend Continuation');
    expect(bestStrategy().name).toBe(EXEC_SUMMARY.bestStrategy);
  });
  it('portfolio allocation is ~100% and rows carry colors', () => {
    expect(allocationSum()).toBeGreaterThan(98);
    expect(allocationSum()).toBeLessThan(102);
    expect(PORTFOLIO.rows.every((r) => r.color.startsWith('#'))).toBe(true);
  });
});

describe('report data shape', () => {
  it('has eight KPI cards with deltas', () => {
    expect(KPIS).toHaveLength(8);
    for (const k of KPIS) { expect(k.label.length).toBeGreaterThan(0); expect(['spark', 'ring', 'shield']).toContain(k.kind); }
  });
  it('stack-score bands degrade win rate as score drops', () => {
    for (let i = 1; i < STACK_SCORE_ROWS.length; i++) expect(STACK_SCORE_ROWS[i].winRate).toBeLessThan(STACK_SCORE_ROWS[i - 1].winRate);
  });
  it('emotions and goals are bounded; calendar is 5x7', () => {
    for (const e of EMOTIONS) { expect(e.winRate).toBeGreaterThanOrEqual(0); expect(e.winRate).toBeLessThanOrEqual(100); }
    expect(GOALS).toHaveLength(5);
    expect(CALENDAR).toHaveLength(5);
    expect(CALENDAR.every((w) => w.length === 7)).toBe(true);
  });
});
