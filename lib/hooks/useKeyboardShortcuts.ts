'use client';

import { useEffect } from 'react';
import { TIMEFRAMES, type Timeframe } from '../types';
import type { ChartType } from '@/components/Chart';
import type { GridCount } from '../gridLayout';

interface KeyboardShortcutOptions {
  onSearch: () => void;
  onSelectTf: (tf: Timeframe) => void;
  onChartType: (t: ChartType) => void;
  gridCount: GridCount;
  onGridCycle: (n: GridCount) => void;
}

/**
 * Global keyboard shortcuts for the dashboard:
 *   1–6   select timeframe
 *   H     Heikin Ashi
 *   C     candlestick
 *   R     renko
 *   G     cycle grid count (1 → 2 → 4 → 6 → 1)
 *   /     open symbol search
 *
 * Fullscreen (`F`) and `Esc` are handled by ChartPanel itself.
 */
export function useKeyboardShortcuts({
  onSearch,
  onSelectTf,
  onChartType,
  gridCount,
  onGridCycle,
}: KeyboardShortcutOptions): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        onSearch();
        e.preventDefault();
        return;
      }

      const idx = Number.parseInt(e.key, 10);
      if (!Number.isNaN(idx) && idx >= 1 && idx <= TIMEFRAMES.length) {
        onSelectTf(TIMEFRAMES[idx - 1]);
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'h') {
        onChartType('heikinAshi');
        e.preventDefault();
      } else if (k === 'c') {
        onChartType('candlestick');
        e.preventDefault();
      } else if (k === 'r') {
        onChartType('renko');
        e.preventDefault();
      } else if (k === 'g') {
        const order: GridCount[] = [1, 2, 4, 6];
        const i = order.indexOf(gridCount);
        onGridCycle(order[(i + 1) % order.length]);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSearch, onSelectTf, onChartType, gridCount, onGridCycle]);
}
