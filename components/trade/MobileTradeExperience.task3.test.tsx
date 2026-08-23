// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MobileTradeExperience from './MobileTradeExperience';

const commands = {
  openOrderTicket: () => ({ status: 'accepted' as const, mode: 'live' as const }),
  submitOrder: () => ({ status: 'accepted' as const, mode: 'live' as const }),
  setProtection: () => ({ status: 'accepted' as const, mode: 'live' as const }),
  partialClose: () => ({ status: 'accepted' as const, mode: 'live' as const }),
  toggleTrailing: () => ({ status: 'accepted' as const, mode: 'live' as const }),
  close: () => ({ status: 'accepted' as const, mode: 'live' as const }),
};

const flat = {
  mode: 'live' as const, symbol: 'BTCUSDT', position: null, trades: [], balance: 1000,
  initialBalance: 1000, markPrice: 100000, markTrusted: true,
};

describe('MobileTradeExperience', () => {
  it('keeps thumb-safe flat BUY/SELL controls close to the chart', () => {
    const html = renderToStaticMarkup(<MobileTradeExperience symbol="BTCUSDT" presentation={flat} commands={commands} leverage={10} />);
    expect(html).toContain('data-testid="mobile-trade-flat"');
    expect(html).toContain('aria-label="Open BUY order entry"');
    expect(html).toContain('aria-label="Open SELL order entry"');
    expect(html).toContain('min-h-11');
  });

  it('uses active position presentation without BTC-specific unit assumptions', () => {
    const html = renderToStaticMarkup(<MobileTradeExperience symbol="XAUUSD" presentation={{ ...flat, symbol: 'XAUUSD', position: {
      id: 'gold', symbol: 'XAUUSD', side: 'long', units: 2, entryPrice: 2300, leverage: 10,
      realizedPnl: 0, feesPaid: 0, sl: 2280, tp: 2340, trailingSl: false, trailingBest: null, liquidated: false, openedAt: 1,
    } }} commands={commands} leverage={10} />);
    expect(html).toContain('LONG');
    expect(html).toContain('Gold');
    expect(html).not.toContain('BTC</span>');
  });

  it('explains when entry is paused by market-data integrity', () => {
    const html = renderToStaticMarkup(<MobileTradeExperience symbol="BTCUSDT" presentation={{ ...flat, markTrusted: false }} commands={commands} leverage={10} integrity="stale" />);
    expect(html).toContain('Trading paused');
    expect(html).toContain('Market data stale');
  });
  it('does not duplicate a disabled live ticket while flat replay owns entry through the replay HUD', () => {
    const html = renderToStaticMarkup(
      <MobileTradeExperience
        symbol="BTCUSDT"
        presentation={{ ...flat, mode: 'replay', markTrusted: false }}
        commands={commands}
        leverage={10}
        integrity="replay"
      />,
    );
    expect(html).toBe('');
  });

  it('opens the requested BUY direction through the controller-owned command', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const openOrderTicket = vi.fn(() => ({ status: 'accepted' as const, mode: 'live' as const }));
    await act(async () => { root.render(<MobileTradeExperience symbol="BTCUSDT" presentation={flat} commands={{ ...commands, openOrderTicket }} leverage={10} />); });
    await act(async () => { (host.querySelector('[aria-label="Open BUY order entry"]') as HTMLButtonElement).click(); });
    expect(openOrderTicket).toHaveBeenCalledWith('BTCUSDT');
    expect(host.textContent).toContain('BUY BTCUSDT');
    await act(async () => root.unmount());
    host.remove();
  });
});
