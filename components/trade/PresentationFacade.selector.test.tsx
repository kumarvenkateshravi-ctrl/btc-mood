// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useActiveTradePresentation } from '@/lib/trade/presentationFacade';
import { startReplaySession, endReplaySession, configureReplaySession } from '@/lib/replaySession';
import { DEFAULT_SESSION_CONFIG } from '@/lib/replay/sessionSim';
import { __resetForTest, placeOrder } from '@/lib/paperStore';

function Probe({ mode, symbol = 'BTCUSDT' }: { mode:'live'|'replay'; symbol?:string }) {
  const view = useActiveTradePresentation({ mode, symbol, markPrice:100, markTrusted:true });
  return <output>{JSON.stringify({ mode:view.mode, mark:view.markPrice, balance:view.balance, position:view.position?.symbol ?? null })}</output>;
}
describe('presentation selector identity', () => {
  it('reads an already-configured replay account immediately when mode changes', async () => {
    __resetForTest(); endReplaySession();
    const host=document.createElement('div'), root=createRoot(host);
    await act(async () => root.render(<Probe mode="live" />));
    // The store changes while the facade still selects its empty live-mode slice.
    await act(async () => { startReplaySession('BTCUSDT'); configureReplaySession(DEFAULT_SESSION_CONFIG); });
    await act(async () => root.render(<Probe mode="replay" />));
    expect(JSON.parse(host.textContent!)).toMatchObject({ mode:'replay', mark:100, balance:DEFAULT_SESSION_CONFIG.startBalance });
    await act(async () => root.render(<Probe mode="live" />));
    expect(JSON.parse(host.textContent!)).toMatchObject({ mode:'live', balance:10000 });
    await act(async () => root.unmount()); endReplaySession();
  });
  it('reselects the live position when the symbol changes without a store write', async () => {
    __resetForTest();
    placeOrder({ symbol:'BTCUSDT', side:'buy', type:'market', units:1, price:null, tp:null, sl:null, reduceOnly:false, postOnly:false, leverage:10, midPrice:100 });
    const host=document.createElement('div'), root=createRoot(host);
    await act(async () => root.render(<Probe mode="live" />));
    expect(JSON.parse(host.textContent!).position).toBe('BTCUSDT');
    await act(async () => root.render(<Probe mode="live" symbol="XAUUSD" />));
    expect(JSON.parse(host.textContent!).position).toBeNull();
    await act(async () => root.render(<Probe mode="live" />));
    expect(JSON.parse(host.textContent!).position).toBe('BTCUSDT');
    await act(async () => root.unmount()); __resetForTest();
  });
});
