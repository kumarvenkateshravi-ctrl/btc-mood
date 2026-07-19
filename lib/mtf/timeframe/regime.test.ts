import { describe, expect, it } from 'vitest';
import type { CategoryResult } from '../categoryTypes';
import { classifyRegime } from './regime';

const trend = (verdict: CategoryResult['verdict'], strength: number): CategoryResult => ({
  id: 'trend', score: verdict === 'bullish' ? 80 : verdict === 'bearish' ? 20 : 50, verdict, confidence: strength, strength,
  state: 'ranging' as CategoryResult['state'], contributors: [], diagnostics: {}, signals: [], warnings: [],
});
const vol = (state: 'expanding' | 'compressed' | 'normal', strength: number): CategoryResult => ({
  id: 'volatility', score: 50, verdict: 'neutral', confidence: strength, strength,
  state: state as CategoryResult['state'], contributors: [], diagnostics: {}, signals: [], warnings: [],
});

describe('classifyRegime', () => {
  it('strong bullish trend → trending_up', () => {
    const r = classifyRegime(trend('bullish', 70), vol('normal', 30));
    expect(r.regime).toBe('trending_up');
    expect(r.clarity).toBe(70);
    expect(r.diagnostics).toEqual({ trendStrength: 70, volatility: 30, direction: 'bullish' });
  });
  it('strong bearish trend → trending_down', () => {
    expect(classifyRegime(trend('bearish', 65), vol('normal', 30)).regime).toBe('trending_down');
  });
  it('weak trend + expanding volatility → expansion', () => {
    expect(classifyRegime(trend('neutral', 30), vol('expanding', 40)).regime).toBe('expansion');
  });
  it('weak trend + high volatility strength → expansion', () => {
    expect(classifyRegime(trend('neutral', 30), vol('normal', 80)).regime).toBe('expansion');
  });
  it('weak trend + compressed → compression', () => {
    expect(classifyRegime(trend('neutral', 30), vol('compressed', 20)).regime).toBe('compression');
  });
  it('weak trend + normal → ranging', () => {
    const r = classifyRegime(trend('neutral', 30), vol('normal', 40));
    expect(r.regime).toBe('ranging');
    expect(r.clarity).toBe(70); // 100 − 30
  });
});
