import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Candle } from '@/lib/types';
import { computeTradeDecision } from '@/lib/mtf/decision/decisionEngine';
import { mkBoard, mkFullIntel, mkMarket } from '@/lib/mtf/decision/testFixtures';
import { TradeDecisionPanel } from './MarketIntelligence';

const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));
const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107, 107];

const readyIntel = () => mkFullIntel(mkMarket({
  readiness: { state: 'ready', reason: 'ok' },
  headline: { bias: 'bullish', calibration: 'prior' },
  risk: { level: 'low' },
  quality: { level: 'good' },
  outlook: { invalidation: { invalidated: false, condition: null } },
}));

const longBoard = () => mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });

describe('Phase 1c TradeDecisionPanel', () => {
  it('renders a long proposal with levels, tier, priors chip, and the toggle', () => {
    const decision = computeTradeDecision(longBoard(), readyIntel(), { '1d': bars(LONG) });
    const html = renderToStaticMarkup(
      <TradeDecisionPanel decision={decision} signal={null} recent={[]} smcEnabled={true} onToggleSmc={() => {}} />,
    );
    expect(html).toContain('>long<');
    expect(html).toContain('1D executes');
    expect(html).toContain('105–105.5');
    expect(html).toContain('103');
    expect(html).toContain('111');
    expect(html).toContain('risk: half');
    expect(html).toContain('model priors');
    expect(html).toContain('the stop is the invalidation');
    expect(html).toContain('SMC confluence: ON');
  });

  it('renders a blocked decision with the gate code and reason (Arch v2: Board no_trade, not M8 environment)', () => {
    const board = mkBoard({ direction: 'no_trade', bias: 'neutral', conviction: 40, executionTimeframe: '1d' });
    const decision = computeTradeDecision(board, readyIntel(), { '1d': bars(LONG) });
    const html = renderToStaticMarkup(
      <TradeDecisionPanel decision={decision} signal={null} recent={[]} smcEnabled={false} onToggleSmc={() => {}} />,
    );
    expect(html).toContain('>no trade<');
    expect(html).toContain('board_no_trade');
    expect(html).toContain('board bias is neutral');
    expect(html).toContain('SMC confluence: OFF');
  });

  it('renders confluence notes and stop-hunt warning when SMC adjusted the setup', () => {
    const smc = {
      objects: {
        orderBlocks: [], fvgs: [], structureLevels: [], zones: [],
        liquidityPools: [{
          id: 'p', kind: 'liquidityPool' as const, scope: 'swing' as const, direction: 'bearish' as const,
          top: 102.5, bottom: 102.5, createdAtBar: 0, createdAtTime: 0, updatedAtBar: 0,
          state: 'active' as const, touches: 0, strength: 50, quality: 50, confidence: 50,
        }],
      },
    };
    const decision = computeTradeDecision(longBoard(), readyIntel(), { '1d': bars(LONG) }, smc);
    const html = renderToStaticMarkup(
      <TradeDecisionPanel decision={decision} signal={null} recent={[]} smcEnabled={true} onToggleSmc={() => {}} />,
    );
    expect(html).toContain('STOP_EXTENDED_LIQUIDITY');
    expect(html).toContain('102.3');
    expect(html).toContain('sweep risk');
  });

  it('renders the Generated timestamp, freshness badge, and recent-decision history (2026-07-25 follow-up)', () => {
    const decision = computeTradeDecision(longBoard(), readyIntel(), { '1d': bars(LONG) });
    const html = renderToStaticMarkup(
      <TradeDecisionPanel
        decision={decision}
        signal={{ since: decision.generatedAt!, barsAgo: 3, freshness: 'active' }}
        recent={[{ action: 'short', barTime: 1000, barsAgo: 12 }, { action: 'no_trade', barTime: 940, barsAgo: 13 }]}
        smcEnabled={true}
        onToggleSmc={() => {}}
      />,
    );
    expect(html).toContain('Generated:');
    expect(html).toContain('3 bars ago');
    expect(html).toContain('Active');
    expect(html).toContain('SHORT · 12b');
    expect(html).toContain('NO TRADE · 13b');
  });

  it('omits the Generated line and history row when no signal has been tracked yet', () => {
    const decision = computeTradeDecision(longBoard(), readyIntel(), { '1d': bars(LONG) });
    const html = renderToStaticMarkup(
      <TradeDecisionPanel decision={decision} signal={null} recent={[]} smcEnabled={true} onToggleSmc={() => {}} />,
    );
    expect(html).not.toContain('Generated:');
  });
});
