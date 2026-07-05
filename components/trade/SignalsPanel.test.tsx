import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SignalsPanel, { confidenceBand, signalRows, SignalDetails, STATUS_LABEL } from './SignalsPanel';
import type { SdSignal } from '@/lib/indicators/signalTypes';

const sig: SdSignal = {
  id: 'buy:D:demand:0', side: 'buy', timeframe: '1h', symbol: 'BTCUSDT',
  zoneId: 'D:demand:0', zoneTf: 'D', zoneKind: 'demand', status: 'triggered',
  entry: 108, stopLoss: 99, takeProfit1: 130, takeProfit2: 140, riskReward: 2.4, confidence: 82,
  explanation: {
    factors: [{ key: 'zoneStrength', label: 'Zone strength', input: 0.9, weight: 0.35, contribution: 31.5 }],
    summary: 'Strong demand zone, 2.4R', counterSignals: ['retested 3×'],
  },
  tier: 'strong', armedIndex: 2, triggeredIndex: 3, resolvedIndex: null, createdAt: 1_600_000_000, resolvedAt: null,
};

describe('SignalsPanel helpers', () => {
  it('confidenceBand bands the score', () => {
    expect(confidenceBand(82)).toBe('High');
    expect(confidenceBand(70)).toBe('Medium');
    expect(confidenceBand(56)).toBe('Low');
  });
  it('signalRows keeps only triggered signals, newest first', () => {
    const armedOnly = { ...sig, id: 'x', triggeredIndex: null };
    const rows = signalRows([armedOnly, sig]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('buy:D:demand:0');
  });
  it('STATUS_LABEL maps every status', () => {
    expect(STATUS_LABEL.triggered).toBe('Live');
    expect(STATUS_LABEL.tp2).toBe('TP2');
  });
});

describe('SignalsPanel render', () => {
  it('renders a signal row with side and confidence', () => {
    const html = renderToStaticMarkup(<SignalsPanel signals={[sig]} />);
    expect(html).toContain('BUY');
    expect(html).toContain('82');
    expect(html).toContain('not financial advice');
  });
  it('shows the empty state when there are no signals', () => {
    const html = renderToStaticMarkup(<SignalsPanel signals={[]} />);
    expect(html).toMatch(/No signals/i);
  });
  it('SignalDetails shows explanation factors and counter-signals', () => {
    const html = renderToStaticMarkup(<SignalDetails signal={sig} />);
    expect(html).toContain('Zone strength');
    expect(html).toContain('retested 3×');
    expect(html).toContain('Strong demand zone');
  });
});
