// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileTradeExperience, { type MobileTradeExperienceProps } from './MobileTradeExperience';

const flat = { mode: 'live' as const, symbol: 'BTCUSDT', position: null, trades: [], balance: 10000, initialBalance: 10000, markPrice: 100, markTrusted: true };
const position = { id: 'mobile-test', symbol: 'BTCUSDT', side: 'long' as const, units: 2, entryPrice: 100, realizedPnl: 0, feesPaid: 0, openedAt: 1000, tp: 120, sl: 90, liquidated: false, leverage: 10, trailingSl: false, trailingBest: null };
const accepted = () => ({ status: 'accepted' as const, mode: 'live' as const });
const commands = () => ({ openOrderTicket: vi.fn(accepted), submitOrder: vi.fn(accepted), setProtection: vi.fn(accepted), partialClose: vi.fn(accepted), toggleTrailing: vi.fn(accepted), close: vi.fn(accepted) });
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
async function mount(overrides: Partial<MobileTradeExperienceProps> = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const props: MobileTradeExperienceProps = { symbol: 'BTCUSDT', presentation: flat, commands: commands(), leverage: 10, ...overrides };
  const render = async (patch: Partial<MobileTradeExperienceProps>) => { Object.assign(props, patch); await act(async () => root.render(<MobileTradeExperience {...props} />)); };
  await render({});
  const click = async (name: string) => { const target = Array.from(host.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === name || b.textContent === name); expect(target, name).toBeTruthy(); await act(async () => target!.click()); };
  cleanup.push(async () => { await act(async () => root.unmount()); host.remove(); });
  return { host, props, click, render };
}

describe('mobile terminal interaction contracts', () => {
  it.each(['BUY','SELL'])('opens the %s ticket through the existing command boundary', async direction => {
    const { host, props, click } = await mount();
    await click(`Open ${direction} order entry`);
    expect(props.commands.openOrderTicket).toHaveBeenCalledExactlyOnceWith('BTCUSDT');
    expect(host.querySelector('dialog')?.getAttribute('aria-label')).toBe(`${direction} BTCUSDT order entry`);
    expect(host.textContent).toContain(`Confirm ${direction}`);
    expect(props.commands.submitOrder).not.toHaveBeenCalled();
  });
  it.each(['stale','partial','unavailable'] as const)('explains and blocks %s entry', async integrity => {
    const { host, props, click } = await mount({ integrity, presentation: { ...flat, markTrusted: false } });
    expect(host.textContent).toContain('Trading paused');
    await click('Open BUY order entry');
    expect(props.commands.openOrderTicket).not.toHaveBeenCalled();
    expect(host.querySelector('dialog')).toBeNull();
  });
  it.each(['long','short'] as const)('transforms the flat dock into compact %s management', async side => {
    const { host, click } = await mount({ presentation: { ...flat, position: { ...position, side } } });
    expect(host.textContent).toContain(`Active ${side.toUpperCase()}`);
    expect(host.querySelector('[aria-label="Open BUY order entry"]')).toBeNull();
    expect(host.textContent).not.toContain('Move SL to BE');
    await click('Manage active position');
    expect(host.textContent).toContain('Move SL to BE');
    expect(host.querySelectorAll('[aria-label^="Partial close"]')).toHaveLength(3);
  });
  it.each([25,50,75])('routes %s%% partial close only after confirmation', async pct => {
    const { props, click } = await mount({ presentation: { ...flat, position } });
    await click('Manage active position'); await click(`Partial close ${pct}%`);
    expect(props.commands.partialClose).not.toHaveBeenCalled();
    await click('Confirm Partial Close');
    expect(props.commands.partialClose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ symbol:'BTCUSDT', fraction:pct/100, mark:100 }));
  });
  it('routes trailing and full close through commands, with close confirmation', async () => {
    const { props, click } = await mount({ presentation: { ...flat, position } });
    await click('Manage active position'); await click('Trailing OFF');
    expect(props.commands.toggleTrailing).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ symbol:'BTCUSDT', enabled:true }));
    await click('Close Position'); expect(props.commands.close).not.toHaveBeenCalled();
    await click('Confirm Close'); expect(props.commands.close).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ symbol:'BTCUSDT', mark:100 }));
  });
  it('discloses secondary content only on demand', async () => {
    const { host, click } = await mount({ secondaryContent:<div>Trade History fixture</div> });
    expect(host.textContent).not.toContain('Trade History fixture');
    await click('More'); expect(host.textContent).toContain('Trade History fixture');
    await click('Close Trading workspace'); expect(host.textContent).not.toContain('Trade History fixture');
  });
  it('isolates replay entry from the live ticket and forwards direction', async () => {
    const onReplayTrade = vi.fn();
    const { host, props, click } = await mount({ presentation: { ...flat, mode:'replay' }, onReplayTrade });
    expect(host.textContent).toContain('Snapshot · Simulated');
    await click('Replay SELL'); expect(onReplayTrade).toHaveBeenCalledExactlyOnceWith('sell');
    expect(props.commands.openOrderTicket).not.toHaveBeenCalled();
  });
  it('forwards immutable replay context to position management', async () => {
    const replayContext = { barIndex:12, cutTime:2000 };
    const { props, click } = await mount({ presentation: { ...flat, mode:'replay', position }, replayContext });
    await click('Manage active position'); await click('Move SL to BE');
    expect(props.commands.setProtection).toHaveBeenCalledExactlyOnceWith({ symbol:'BTCUSDT', protection:{ sl:100 }, replayContext });
  });
  it('closes a draft on symbol change and truthfully shows unavailable Gold', async () => {
    const { host, click, render } = await mount();
    await click('Open BUY order entry');
    await render({ symbol:'XAUUSD', integrity:'unavailable', presentation:{ ...flat, symbol:'XAUUSD', markPrice:null, markTrusted:false } });
    expect(host.querySelector('dialog')).toBeNull(); expect(host.textContent).toContain('Market data unavailable');
  });
  it('keeps the ticket and component identity through viewport events', async () => {
    const { host, click } = await mount(); await click('Open BUY order entry');
    const dialog = host.querySelector('dialog');
    await act(async () => { window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('orientationchange')); });
    expect(host.querySelector('dialog')).toBe(dialog);
  });
  it('blocks live entry while the replay snapshot is being selected', async () => {
    const { host, props, click } = await mount({ entryPausedReason:'Select a replay date to begin.' });
    await click('Open BUY order entry'); await click('Open trade ticket');
    expect(host.textContent).toContain('Select a replay date');
    expect(props.commands.openOrderTicket).not.toHaveBeenCalled();
  });
  it('keeps stale position management accessible but blocks price-based close', async () => {
    const { host, props, click } = await mount({ integrity:'stale', presentation:{ ...flat, position, markPrice:null, markTrusted:false } });
    expect(host.textContent).toContain('P&L unavailable');
    await click('Manage active position'); await click('Close Position'); await click('Confirm Close');
    expect(props.commands.close).not.toHaveBeenCalled();
  });
});
