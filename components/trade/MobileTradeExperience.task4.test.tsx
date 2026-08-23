// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import MobileTradeExperience from './MobileTradeExperience';

const position = { id: 'p', symbol: 'BTCUSDT', side: 'long' as const, units: 2, entryPrice: 100, realizedPnl: 0, feesPaid: 0, openedAt: 1, tp: 120, sl: 90, liquidated: false, leverage: 10, trailingSl: false, trailingBest: null };
const facade = { mode: 'live' as const, symbol: 'BTCUSDT', position, trades: [], balance: 1000, initialBalance: 1000, markPrice: 110, markTrusted: true };

describe('mobile position management', () => {
  it('opens a temporary management sheet and routes break-even atomically', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const setProtection = vi.fn(() => ({ status: 'accepted' as const, mode: 'live' as const }));
    const commands = { openOrderTicket: vi.fn(), submitOrder: vi.fn(), setProtection, partialClose: vi.fn(), toggleTrailing: vi.fn(), close: vi.fn() };
    await act(async () => root.render(<MobileTradeExperience symbol="BTCUSDT" presentation={facade} commands={commands} leverage={10} />));
    await act(async () => (host.querySelector('[aria-label="Manage active position"]') as HTMLButtonElement).click());
    expect(host.textContent).toContain('Move SL to BE');
    await act(async () => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Move SL to BE')!.click());
    expect(setProtection).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTCUSDT', protection: { sl: 100 } }));
    await act(async () => root.unmount()); host.remove();
  });
});
