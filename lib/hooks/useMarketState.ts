import { useEffect, useState, useRef } from 'react';
import type { WSStatus } from '../ws';

export type MarketLifecycleState =
  | 'loading'
  | 'ready'
  | 'live'
  | 'updating'
  | 'stale'
  | 'disconnected'
  | 'retrying'
  | 'recovered';

export interface UseMarketStateProps {
  wsStatus: WSStatus;
  lastUpdateMs: number;
  hasData: boolean;
  staleThresholdMs?: number;
}

/**
 * Derives the precise lifecycle state of market data (MDS §I)
 * Loading → Ready → Live → Updating → Stale → Disconnected → Retrying → Recovered
 */
export function useMarketState({
  wsStatus,
  lastUpdateMs,
  hasData,
  staleThresholdMs = 15000,
}: UseMarketStateProps): MarketLifecycleState {
  const [state, setState] = useState<MarketLifecycleState>('loading');
  const prevWsStatus = useRef<WSStatus>(wsStatus);
  const recoveredTimer = useRef<number | null>(null);

  useEffect(() => {
    let nextState: MarketLifecycleState;

    if (!hasData) {
      nextState = 'loading';
    } else if (wsStatus === 'closed' || wsStatus === 'error') {
      nextState = 'disconnected';
    } else if (wsStatus === 'connecting') {
      nextState = 'retrying';
    } else {
      const isStale = lastUpdateMs > 0 && Date.now() - lastUpdateMs > staleThresholdMs;
      if (isStale) {
        nextState = 'stale';
      } else if (state === 'retrying' || prevWsStatus.current === 'connecting' || prevWsStatus.current === 'closed' || prevWsStatus.current === 'error') {
        nextState = 'recovered';
      } else if (state === 'recovered') {
        nextState = 'recovered';
      } else {
        nextState = 'live';
      }
    }

    if (nextState === 'recovered' && state !== 'recovered') {
      setState('recovered');
      if (recoveredTimer.current) window.clearTimeout(recoveredTimer.current);
      recoveredTimer.current = window.setTimeout(() => {
        setState('live');
      }, 2000);
    } else if (nextState !== state && nextState !== 'recovered') {
      setState(nextState);
    }

    prevWsStatus.current = wsStatus;
  }, [wsStatus, lastUpdateMs, hasData, staleThresholdMs, state]);

  useEffect(() => {
    if (state !== 'live' && state !== 'stale' && state !== 'ready') return;
    const interval = window.setInterval(() => {
      const isStale = lastUpdateMs > 0 && Date.now() - lastUpdateMs > staleThresholdMs;
      if (isStale && state === 'live') {
        setState('stale');
      } else if (!isStale && state === 'stale') {
        setState('live');
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [state, lastUpdateMs, staleThresholdMs]);

  return state;
}
