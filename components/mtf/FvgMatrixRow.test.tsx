import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActiveFvgCountsByTimeframe } from '@/lib/mtf/fvgActivity';
import FvgMatrixRow, { fvgBalanceLabel } from './FvgMatrixRow';

const counts: ActiveFvgCountsByTimeframe = {
  '5m': { bullish: 3, bearish: 1, total: 4 },
  '15m': { bullish: 1, bearish: 2, total: 3 },
  '30m': { bullish: 2, bearish: 0, total: 2 },
  '1h': { bullish: 1, bearish: 3, total: 4 },
  '4h': { bullish: 0, bearish: 1, total: 1 },
  '1d': { bullish: 1, bearish: 0, total: 1 },
};

describe('FvgMatrixRow', () => {
  it('renders bullish/bearish counts in one row without directional arrows', () => {
    const html = renderToStaticMarkup(<table><tbody><FvgMatrixRow counts={counts} /></tbody></table>);

    expect(html).toContain('Active today Bullish / Bearish');
    expect(html).toContain('5M: 3 bullish FVGs, 1 bearish FVGs. Bull.');
    expect(html).toContain('15M: 1 bullish FVGs, 2 bearish FVGs. Bear.');
    expect(html).toContain('text-bull-bright');
    expect(html).toContain('text-bear-bright');
    expect(html).not.toContain('↑');
    expect(html).not.toContain('↓');
    expect(html).not.toContain('Bull-led');
    expect(html).not.toContain('Bear-led');
  });

  it('uses precise fallback labels when neither side is greater', () => {
    expect(fvgBalanceLabel({ bullish: 2, bearish: 2, total: 4 })).toBe('Mixed');
    expect(fvgBalanceLabel({ bullish: 0, bearish: 0, total: 0 })).toBe('None');
  });
});
