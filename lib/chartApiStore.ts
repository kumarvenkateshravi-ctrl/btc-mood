import { useSyncExternalStore } from 'react';
import type { IChartApi } from 'lightweight-charts';

/**
 * Registry of live lightweight-charts instances, keyed by timeframe.
 * Single-chart mode registers one entry under its tf; multi-chart grids
 * register one per cell, so consumers (e.g. ConfluenceRibbon) can follow
 * the chart that matches the *selected* timeframe instead of whichever
 * chart happened to mount last.
 */
const charts = new Map<string, IChartApi>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const chartApiStore = {
  /** Chart for `key`, falling back to the sole registered chart if any. */
  get: (key: string): IChartApi | null =>
    charts.get(key) ?? (charts.size === 1 ? charts.values().next().value! : null),
  register: (key: string, api: IChartApi) => {
    charts.set(key, api);
    emit();
  },
  /** Unregisters only if `api` is still the chart under `key` (guards against
   *  a remounted chart being clobbered by its predecessor's cleanup). */
  unregister: (key: string, api: IChartApi) => {
    if (charts.get(key) === api) {
      charts.delete(key);
      emit();
    }
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Reactive lookup of the live chart registered under `key`. */
export function useRegisteredChart(key: string): IChartApi | null {
  return useSyncExternalStore(
    chartApiStore.subscribe,
    () => chartApiStore.get(key),
    () => null,
  );
}
