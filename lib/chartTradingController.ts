import {
  createChartTradingCommands,
  type ChartTradingCommandOwners,
  type ChartTradingCommands,
  type ChartTradingMode,
} from './chartTradingCommands';

/** Minimal live/replay identity read at dispatch time by the composition root. */
export interface ChartTradingControllerSession {
  mode: ChartTradingMode;
  symbol: string;
}

export type ChartTradingControllerOwners = Omit<ChartTradingCommandOwners, 'getContext'> & {
  getSession: () => ChartTradingControllerSession;
};

/**
 * Compose one mode-aware command boundary for an active chart session.
 *
 * This wrapper intentionally does not own account state. It adapts the
 * Dashboard/ChartSession composition root to the existing command boundary,
 * while preserving dispatch-time mode and symbol resolution.
 */
export function createChartTradingController(owners: ChartTradingControllerOwners): ChartTradingCommands {
  return createChartTradingCommands({
    ...owners,
    getContext: () => owners.getSession(),
  });
}
