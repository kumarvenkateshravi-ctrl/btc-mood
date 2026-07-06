import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MarketContextWidget, { strengthStars, riskLabel } from './MarketContextWidget';
import { __resetContextForTest, publishVdDecisions } from '@/lib/context/contextStore';
import type { MarketContext } from '@/lib/context/types';
import type { VdSignal } from '@/lib/indicators/vdEngine';

const ctx: MarketContext = {
  perTf: {}, overallBias: 'bullish',
  contextScore: 78, trendScore: 80, momentumScore: 65, volumeScore: 70,
  htfAgreement: 72, conflictScore: 22, confidence: 68,
  confirmations: [], warnings: [], asOfTime: 0,
};

beforeEach(() => __resetContextForTest());

describe('MarketContextWidget', () => {
  it('renders bias, score, stars and risk', () => {
    const html = renderToStaticMarkup(<MarketContextWidget ctx={ctx} />);
    expect(html).toContain('Bullish');
    expect(html).toContain('78');
    expect(html).toContain('Risk');
    expect(html).toContain('Low'); // conflict 22 < 30 and confidence 68 ≥ 60
  });
  it('surfaces the latest WHY-NOT rejection when gated', () => {
    publishVdDecisions({
      decisions: [], gated: true,
      rejections: [{
        signal: { side: 'buy' } as VdSignal,
        decisionScore: 58,
        failedGates: ['decision score 58 < 65'],
      }],
    });
    const html = renderToStaticMarkup(<MarketContextWidget ctx={ctx} />);
    expect(html).toContain('No BUY');
    expect(html).toContain('decision score 58');
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
