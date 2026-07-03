'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type DensityMode = 'comfortable' | 'standard' | 'compact';

export interface DensityContextValue {
  mode: DensityMode;
  setMode: (mode: DensityMode) => void;
  // Layout values derived from DESIGN.md G1
  gap: string; // row gap
  p: string; // padding class for panels
  maxWidgets: number;
  maxKpis: number;
}

const DensityContext = createContext<DensityContextValue | null>(null);

const DENSITY_MAP: Record<DensityMode, Omit<DensityContextValue, 'mode' | 'setMode'>> = {
  comfortable: { gap: 'gap-6', p: 'p-5', maxWidgets: 6, maxKpis: 4 },
  standard:    { gap: 'gap-4', p: 'p-4', maxWidgets: 9, maxKpis: 6 },
  compact:     { gap: 'gap-3', p: 'p-3', maxWidgets: 12, maxKpis: 8 },
};

export function DensityProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DensityMode>('standard');

  // Load from local storage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('mcs:density') as DensityMode | null;
      if (stored && DENSITY_MAP[stored]) {
        setMode(stored);
      }
    } catch {}
  }, []);

  const handleSetMode = (m: DensityMode) => {
    setMode(m);
    try { localStorage.setItem('mcs:density', m); } catch {}
  };

  const value: DensityContextValue = {
    mode,
    setMode: handleSetMode,
    ...DENSITY_MAP[mode]
  };

  return (
    <DensityContext.Provider value={value}>
      <div className={`density-${mode} contents`}>
        {children}
      </div>
    </DensityContext.Provider>
  );
}

export function useDensity() {
  const ctx = useContext(DensityContext);
  if (!ctx) return { mode: 'standard', setMode: () => {}, ...DENSITY_MAP.standard } as DensityContextValue;
  return ctx;
}
