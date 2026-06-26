import { describe, it, expect } from 'vitest';
import {
  buildPortfolio, healthScore, healthLabel, recommendationFor, scenarios, riskReport,
  highlyCorrelated, CORRELATION, CORR_ASSETS,
} from './positionsEngine';

describe('healthScore', () => {
  it('uniform components return that value and stay bounded', () => {
    expect(healthScore({ trend: 80, alignment: 80, momentum: 80, volume: 80, stackScore: 80, risk: 80 })).toBe(80);
    expect(healthScore({ trend: 200, alignment: 200, momentum: 200, volume: 200, stackScore: 200, risk: 200 })).toBe(100);
    expect(healthScore({ trend: -50, alignment: -50, momentum: -50, volume: -50, stackScore: -50, risk: -50 })).toBe(0);
  });
  it('maps labels and recommendations by band', () => {
    expect(healthLabel(92)).toBe('Elite');
    expect(healthLabel(84)).toBe('Strong');
    expect(healthLabel(72)).toBe('Stable');
    expect(recommendationFor(92)).toBe('Hold');
    expect(recommendationFor(76)).toBe('Watch');
    expect(recommendationFor(50)).toBe('Reduce');
    expect(recommendationFor(20)).toBe('Exit');
  });
});

describe('buildPortfolio', () => {
  const pf = buildPortfolio();
  it('has six open positions with consistent derived figures', () => {
    expect(pf.positions).toHaveLength(6);
    expect(pf.summary.openCount).toBe(6);
    for (const p of pf.positions) {
      expect(Number.isFinite(p.unrealizedPnl)).toBe(true);
      expect(p.positionValue).toBeCloseTo(p.marginUsed * p.leverage, 2);
      expect(p.recommendation).toBe(recommendationFor(p.health));
    }
  });
  it('aggregates open P&L from the rows and splits exposure to ~100%', () => {
    const sum = +pf.positions.reduce((a, p) => a + p.unrealizedPnl, 0).toFixed(2);
    expect(pf.summary.openPnl).toBe(sum);
    expect(pf.summary.longExposurePct + pf.summary.shortExposurePct).toBeCloseTo(100, 0);
    expect(pf.summary.marginUsed + pf.summary.freeMargin).toBeCloseTo(pf.summary.portfolioValue, 1);
  });
});

describe('scenarios & risk', () => {
  const pf = buildPortfolio();
  it('produces four signed scenarios', () => {
    const s = scenarios(pf);
    expect(s).toHaveLength(4);
    expect(s[1].value).toBeLessThan(0); // all stops hit is a loss
    expect(s[3].value).toBeGreaterThan(s[2].value); // rising beats falling
  });
  it('reports bounded risk metrics', () => {
    const r = riskReport(pf);
    expect(r.marginLevelPct).toBeGreaterThan(100);
    expect(['Low', 'Medium', 'High', 'Critical']).toContain(r.level);
  });
});

describe('correlation', () => {
  it('is symmetric with a unit diagonal and flags clusters', () => {
    for (let i = 0; i < CORR_ASSETS.length; i++) {
      expect(CORRELATION[i][i]).toBe(1);
      for (let j = 0; j < CORR_ASSETS.length; j++) expect(CORRELATION[i][j]).toBe(CORRELATION[j][i]);
    }
    expect(highlyCorrelated()).toEqual(expect.arrayContaining(['BTC', 'ETH']));
  });
});
