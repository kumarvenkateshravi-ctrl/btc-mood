'use client';

import type { IndicatorConfig } from '@/lib/indicatorFramework';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';

interface StrategyBuilderPanelProps {
  activeIndicators: IndicatorConfig[];
}

export default function StrategyBuilderPanel({ activeIndicators }: StrategyBuilderPanelProps) {
  return (
    <div className="flex h-full flex-col bg-surface p-4 text-ink">
      <h2 className="mb-6 text-lg font-bold text-ink">Strategy Builder</h2>
      
      <div className="mb-4 text-sm text-ink-muted">
        Select an active indicator to build custom signal conditions.
      </div>

      <div className="flex flex-col gap-3">
        {activeIndicators.length === 0 ? (
          <div className="rounded-lg border border-line border-dashed p-4 text-center text-sm text-ink-muted">
            No indicators active. Add an indicator to the chart to begin.
          </div>
        ) : (
          activeIndicators.map((ind) => {
            const def = CUSTOM_INDICATORS.find((d) => d.id === ind.id);
            if (!def) return null;
            
            return (
              <div 
                key={ind.instanceId} 
                className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-surface-2 p-3 hover:border-accent hover:bg-surface-3 transition-colors"
              >
                <div>
                  <div className="font-medium text-ink">{def.name}</div>
                  <div className="text-xs text-ink-muted mt-1">Click to build rules</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
