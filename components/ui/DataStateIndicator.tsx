import React from 'react';
import { Loader2, WifiOff, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { MarketLifecycleState } from '@/lib/hooks/useMarketState';

interface DataStateIndicatorProps {
  state: MarketLifecycleState;
  className?: string;
  showLabel?: boolean;
}

export function DataStateIndicator({ state, className = '', showLabel = false }: DataStateIndicatorProps) {
  const containerClasses = `flex items-center transition-opacity duration-300 ${className}`;

  if (state === 'loading') {
    return (
      <div className={`${containerClasses} gap-2 text-ink-muted`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {showLabel && <span className="text-[11px] font-medium tracking-wide">Connecting...</span>}
      </div>
    );
  }

  if (state === 'disconnected') {
    return (
      <div className={`${containerClasses} gap-1.5 px-2 py-1 rounded-md bg-bear-dim/30 text-bear text-[10px] font-bold uppercase tracking-[0.1em] border border-bear/20`}>
        <WifiOff className="w-3 h-3" />
        <span>Offline</span>
      </div>
    );
  }

  if (state === 'retrying') {
    return (
      <div className={`${containerClasses} gap-1.5 px-2 py-1 rounded-md bg-warn-dim/30 text-warn text-[10px] font-bold uppercase tracking-[0.1em] border border-warn/20`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Retrying</span>
      </div>
    );
  }

  if (state === 'stale') {
    return (
      <div className={`${containerClasses} gap-1.5 px-2 py-1 rounded-md bg-warn-dim/30 text-warn text-[10px] font-bold uppercase tracking-[0.1em] border border-warn/20`}>
        <AlertTriangle className="w-3 h-3" />
        <span>Delayed</span>
      </div>
    );
  }

  if (state === 'recovered') {
    return (
      <div className={`${containerClasses} gap-1.5 px-2 py-1 rounded-md bg-bull-dim/30 text-bull text-[10px] font-bold uppercase tracking-[0.1em] border border-bull/20`}>
        <CheckCircle2 className="w-3 h-3" />
        <span>Recovered</span>
      </div>
    );
  }

  // Live or Ready
  return (
    <div className={`${containerClasses} gap-2`}>
      <span className="relative flex h-2 w-2" aria-label="Live Connection">
        <span className="animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] absolute inline-flex h-full w-full rounded-full bg-bull opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-bull"></span>
      </span>
      {showLabel && <span className="text-[11px] font-medium tracking-wide text-ink-muted">Live</span>}
    </div>
  );
}
