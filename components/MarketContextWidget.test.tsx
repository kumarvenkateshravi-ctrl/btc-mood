import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MarketContextWidget, { strengthStars, riskLabel } from './MarketContextWidget';
import type { MarketContext } from '@/lib/context/types';

const ctx: MarketContext = {
  perTf: {}, overallBias: 'bullish',
  contextScore: 78, trendScore: 80, momentumScore: 65, volumeScore: 70,
  htfAgreement: 72, conflictScore: 22, confidence: 68,
  confirmations: [], warnings: [], asOfTime: 0,
};

describe('MarketContextWidget', () => {
  it('renders bias, score, stars and risk', () => {
    const html = renderToStaticMarkup(<MarketContextWidget ctx={ctx} />);
    expect(html).toContain('Bullish');
    expect(html).toContain('78');
    expect(html).toContain('Risk');
    expect(html).toContain('Low'); // conflict 22 < 30 and confidence 68 ≥ 60
  });
  it('helpers: stars scale with directional strength; risk ladders', () => {
    expect(strengthStars(50)).toBe('☆☆☆☆☆');
    expect(strengthStars(100)).toBe('★★★★★');
    expect(strengthStars(80)).toBe('★★★☆☆');
    expect(riskLabel({ ...ctx, conflictScore: 55 })).toBe('High');
    expect(riskLabel({ ...ctx, conflictScore: 35 })).toBe('Medium');
    expect(riskLabel({ ...ctx, conflictScore: 10, confidence: 80 })).toBe('Low');
  });
});
