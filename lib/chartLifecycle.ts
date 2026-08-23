export type ChartLifecycleState = 'idle' | 'initializing' | 'ready' | 'disposed';

export interface ChartLifecycle {
  epoch: number;
  state: ChartLifecycleState;
  apiReady: boolean;
}

export const INITIAL_CHART_LIFECYCLE: ChartLifecycle = Object.freeze({
  epoch: 0,
  state: 'idle',
  apiReady: false,
});

export function beginChartLifecycle(previous: ChartLifecycle): ChartLifecycle {
  return { epoch: previous.epoch + 1, state: 'initializing', apiReady: false };
}

export function markChartReady(current: ChartLifecycle, epoch: number): ChartLifecycle {
  if (current.epoch !== epoch || current.state === 'disposed') return current;
  return { ...current, state: 'ready', apiReady: true };
}

export function disposeChartLifecycle(current: ChartLifecycle, epoch: number = current.epoch): ChartLifecycle {
  if (current.epoch !== epoch) return current;
  return { ...current, state: 'disposed', apiReady: false };
}

export function isChartLifecycleActive(current: ChartLifecycle, epoch: number): boolean {
  return current.epoch === epoch && (current.state === 'initializing' || current.state === 'ready');
}

export function canUseChartApi(current: ChartLifecycle, epoch: number): boolean {
  return current.epoch === epoch && current.state === 'ready' && current.apiReady;
}
