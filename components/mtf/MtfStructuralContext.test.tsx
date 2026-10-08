import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Candle } from '@/lib/types';
import { createIndicatorEvaluationContext } from '@/lib/indicatorEvaluation';
import { evaluateClosedDerivedIntelligence } from '@/lib/mtf/derivedIntelligence';
import MtfStructuralContext from './MtfStructuralContext';

function candles(count = 240): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 60_000 + index * 8 + Math.sin(index / 4) * 20;
    const close = open + Math.cos(index / 3) * 12;
    return { time: 1_700_000_000 + index * 300, open, high: Math.max(open, close) + 10, low: Math.min(open, close) - 10, close, volume: 1_000 + index * 2 };
  });
}

describe('MtfStructuralContext', () => {
  it('renders closed-bar FVG, VWAP crossover, and POC context without claiming it changes the matrix', () => {
    const source = candles();
    const context = createIndicatorEvaluationContext({ rawCandles: source, displayCandles: source, symbol: 'BTCUSDT', timeframe: '1h', mode: 'live', hasFormingBar: true, sourceRevision: 'mtf-structural-context-test' });
    const html = renderToStaticMarkup(<MtfStructuralContext timeframeLabel="1H" derived={evaluateClosedDerivedIntelligence(context)} activeToday={{ bullish: 2, bearish: 1, total: 3 }} />);
    expect(html).toContain('Structural Context');
    expect(html).toContain('FVG activity');
    expect(html).toContain('Daily / weekly VWAP');
    expect(html).toContain('4H / daily / weekly POC');
    expect(html).toContain('Created today');
    expect(html).toContain('Context only. The original matrix score and decision path remain unchanged.');
  });
});
