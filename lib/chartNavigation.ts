import type { Timeframe } from './types';

export const MOBILE_PRIMARY_TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '1h', '4h'];
export const ALL_CHART_TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

export type ChartNavigationVariant = 'mobile' | 'tablet' | 'laptop' | 'desktop';
export type ChartNavigationControl =
  | 'instrument'
  | 'timeframe'
  | 'market-state'
  | 'execution-mode'
  | 'price-change'
  | 'chart-type'
  | 'indicators'
  | 'replay'
  | 'settings'
  | 'layout'
  | 'workspace'
  | 'fullscreen'
  | 'application-nav'
  | 'all-timeframes';

export interface ChartNavigationLayout {
  variant: ChartNavigationVariant;
  minTouchTarget: number;
  primary: readonly ChartNavigationControl[];
  secondary: readonly ChartNavigationControl[];
  timeframes: readonly Timeframe[];
}

/**
 * Read-only responsive composition contract. CSS owns the actual layout, so a
 * viewport change never creates a second chart/session/controller lifecycle.
 */
export function chartNavigationLayoutForWidth(width: number): ChartNavigationLayout {
  const primary = ['instrument', 'timeframe', 'market-state', 'execution-mode'] as const;
  if (width < 768) {
    return {
      variant: 'mobile', minTouchTarget: 44, primary,
      secondary: ['all-timeframes', 'chart-type', 'indicators', 'replay', 'settings', 'layout', 'workspace', 'fullscreen'],
      timeframes: MOBILE_PRIMARY_TIMEFRAMES,
    };
  }
  if (width < 1024) {
    return {
      variant: 'tablet', minTouchTarget: 40, primary,
      secondary: ['chart-type', 'indicators', 'replay', 'settings', 'layout', 'workspace', 'fullscreen'],
      timeframes: ALL_CHART_TIMEFRAMES,
    };
  }
  if (width < 1440) {
    return {
      variant: 'laptop', minTouchTarget: 32, primary,
      secondary: ['chart-type', 'indicators', 'replay', 'settings', 'layout', 'workspace', 'fullscreen'],
      timeframes: ALL_CHART_TIMEFRAMES,
    };
  }
  return {
    variant: 'desktop', minTouchTarget: 32, primary,
    secondary: ['chart-type', 'indicators', 'replay', 'settings', 'layout', 'workspace', 'fullscreen', 'application-nav'],
    timeframes: ALL_CHART_TIMEFRAMES,
  };
}