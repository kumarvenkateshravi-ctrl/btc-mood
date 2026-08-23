import type { MarketDataIntegrity } from './marketDataIntegrity';
import type { ChartLifecycleState } from './chartLifecycle';

export interface ChartIndicatorDiagnostic {
  key: string;
  plotCount?: number;
  signalCount?: number;
  error?: string;
}

export interface ChartDiagnostics {
  lifecycleState: ChartLifecycleState;
  epoch: number;
  sessionIdentity: string | null;
  mode: 'live' | 'replay' | null;
  marketDataIntegrity: MarketDataIntegrity | null;
  chartApiReady: boolean;
  disposed: boolean;
  listenerCount: number;
  pendingAnimationFrames: number;
  indicators: readonly ChartIndicatorDiagnostic[];
}

export function deriveChartDiagnostics(input: Omit<ChartDiagnostics, 'disposed'>): ChartDiagnostics {
  return Object.freeze({
    ...input,
    disposed: input.lifecycleState === 'disposed',
    indicators: Object.freeze(input.indicators.slice()),
  });
}
