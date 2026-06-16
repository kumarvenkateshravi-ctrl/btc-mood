import { useCallback, useSyncExternalStore, useState, useEffect } from 'react';
import type { IndicatorDef } from './indicatorLibrary';
import type { ActiveIndicator } from '@/components/trade/IndicatorPicker';

const KEY = 'btc-mood:indicators:v1';
const VOL_KEY = 'btc-mood:showVolume:v1';

// ---- Shared store (global — all components see the same data) ----

let cache: ActiveIndicator[] | null = null;
let volumeCache: boolean | null = null;
const listeners = new Set<() => void>();

function load(): ActiveIndicator[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) { 
        cache = parsed.map(a => ({ ...a, instanceId: a.instanceId || crypto.randomUUID() })) as ActiveIndicator[]; 
        return cache; 
      }
    }
  } catch {}
  cache = [];
  return cache;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot(): ActiveIndicator[] {
  return cache ?? load();
}

const EMPTY: ActiveIndicator[] = [];

function getServerSnapshot(): ActiveIndicator[] {
  return EMPTY;
}

const getTrueSnapshot = (): boolean => true;

function save(v: ActiveIndicator[]) {
  cache = v;
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  for (const fn of listeners) fn();
}

function getVolumeSnapshot(): boolean {
  if (volumeCache !== null) return volumeCache;
  try { volumeCache = localStorage.getItem(VOL_KEY) !== 'false'; } catch { volumeCache = true; }
  return volumeCache;
}

function saveVolume(v: boolean) {
  volumeCache = v;
  try { localStorage.setItem(VOL_KEY, String(v)); } catch {}
  for (const fn of listeners) fn();
}

export function useSharedIndicators() {
  const active = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const showVolume = useSyncExternalStore(subscribe, getVolumeSnapshot, getTrueSnapshot);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setHydrated(true); }, []);

  const toggleVolume = useCallback(() => {
    saveVolume(!getVolumeSnapshot());
  }, []);

  const handleAdd = useCallback((def: IndicatorDef) => {
    const current = getSnapshot();
    const params: Record<string, number> = {};
    for (const p of def.params) params[p.key] = p.default;
    save([...current, { instanceId: crypto.randomUUID(), id: def.id, params, visible: true }]);
  }, []);

  const handleRemove = useCallback((instanceId: string) => {
    const current = getSnapshot();
    save(current.filter((a) => a.instanceId !== instanceId));
  }, []);

  const handleToggle = useCallback((instanceId: string) => {
    const current = getSnapshot();
    save(current.map((a) => (a.instanceId === instanceId ? { ...a, visible: !a.visible } : a)));
  }, []);

  const handleParam = useCallback((instanceId: string, key: string, value: number) => {
    const current = getSnapshot();
    save(current.map((a) =>
      a.instanceId === instanceId ? { ...a, params: { ...a.params, [key]: value } } : a,
    ));
  }, []);

  const handleColor = useCallback((instanceId: string, color: string) => {
    const current = getSnapshot();
    save(current.map((a) => (a.instanceId === instanceId ? { ...a, color } : a)));
  }, []);

  return { activeIndicators: active, showVolume, toggleVolume, hydrated, handleAdd, handleRemove, handleToggle, handleParam, handleColor } as const;
}
