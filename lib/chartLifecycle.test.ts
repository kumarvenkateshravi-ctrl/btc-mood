import { describe, expect, it } from 'vitest';
import {
  INITIAL_CHART_LIFECYCLE,
  beginChartLifecycle,
  canUseChartApi,
  disposeChartLifecycle,
  isChartLifecycleActive,
  markChartReady,
} from './chartLifecycle';
import { deriveChartDiagnostics } from './chartDiagnostics';

describe('chart lifecycle ownership', () => {
  it('creates a new epoch for each mount and only the current epoch can become ready', () => {
    const first = beginChartLifecycle(INITIAL_CHART_LIFECYCLE);
    const ready = markChartReady(first, first.epoch);
    const second = beginChartLifecycle(ready);
    expect(second.epoch).toBe(first.epoch + 1);
    expect(markChartReady(first, first.epoch)).toEqual(ready);
    expect(isChartLifecycleActive(ready, first.epoch)).toBe(true);
    expect(isChartLifecycleActive(ready, second.epoch)).toBe(false);
    expect(canUseChartApi(ready, first.epoch)).toBe(true);
  });

  it('disposal invalidates API use and stale callbacks', () => {
    const ready = markChartReady(beginChartLifecycle(INITIAL_CHART_LIFECYCLE), 1);
    const disposed = disposeChartLifecycle(ready, 1);
    expect(disposed.state).toBe('disposed');
    expect(disposed.apiReady).toBe(false);
    expect(canUseChartApi(disposed, 1)).toBe(false);
    expect(isChartLifecycleActive(disposed, 1)).toBe(false);
    expect(disposeChartLifecycle(disposed, 0)).toEqual(disposed);
  });

  it('diagnostics expose lifecycle/session/trust/resource state without owning it', () => {
    const diagnostics = deriveChartDiagnostics({
      lifecycleState: 'ready',
      epoch: 4,
      sessionIdentity: 'live|BTCUSDT|15m',
      mode: 'live',
      marketDataIntegrity: 'live',
      chartApiReady: true,
      listenerCount: 3,
      pendingAnimationFrames: 1,
      indicators: [{ key: 'ema::default', plotCount: 1 }],
    });
    expect(diagnostics).toMatchObject({
      lifecycleState: 'ready',
      epoch: 4,
      sessionIdentity: 'live|BTCUSDT|15m',
      marketDataIntegrity: 'live',
      disposed: false,
    });
    expect(Object.isFrozen(diagnostics)).toBe(true);
  });
});
