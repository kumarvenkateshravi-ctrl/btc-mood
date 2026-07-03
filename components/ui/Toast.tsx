'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { X, AlertCircle, Info, CheckCircle2 } from 'lucide-react';
import { cx } from './util';

export type ToastType = 'info' | 'success' | 'warn' | 'critical';

export interface ToastMessage {
  id: string;
  source: string; // Used for G4 throttling and coalescing
  type: ToastType;
  title: string;
  message?: string;
  count?: number;
  timestamp: number;
}

interface ToastContextValue {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id' | 'timestamp' | 'count'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 3;
const THROTTLE_MS = 30000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [history, setHistory] = useState<Record<string, number>>({});

  const addToast = useCallback((toast: Omit<ToastMessage, 'id' | 'timestamp' | 'count'>) => {
    const now = Date.now();
    
    setToasts((prev) => {
      // G4: Duplicates coalesce with a count
      const existingIdx = prev.findIndex(t => t.source === toast.source && t.type === toast.type && t.title === toast.title);
      if (existingIdx >= 0) {
        const copy = [...prev];
        const existing = copy[existingIdx];
        copy[existingIdx] = { ...existing, count: (existing.count || 1) + 1, timestamp: now };
        // Move to top
        return [copy[existingIdx], ...copy.filter((_, i) => i !== existingIdx)];
      }

      // G4: Throttling (except critical)
      if (toast.type !== 'critical') {
        const lastSeen = history[toast.source];
        if (lastSeen && now - lastSeen < THROTTLE_MS) {
          // Throttled
          return prev;
        }
      }

      const newToast: ToastMessage = { ...toast, id: Math.random().toString(36).substr(2, 9), timestamp: now, count: 1 };
      
      // Update history
      setHistory(h => ({ ...h, [toast.source]: now }));

      const nextToasts = [newToast, ...prev];
      // G4: Max 3 toasts
      if (nextToasts.length > MAX_TOASTS) {
        return nextToasts.slice(0, MAX_TOASTS);
      }
      return nextToasts;
    });
  }, [history]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Auto-dismiss non-critical toasts after 5s
  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts(prev => prev.filter(t => t.type === 'critical' || now - t.timestamp < 5000));
    }, 1000);
    return () => clearInterval(interval);
  }, [toasts]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastCard key={t.id} toast={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'warn' || toast.type === 'critical' ? AlertCircle : Info;
  const colorClass = 
    toast.type === 'success' ? 'text-bull-bright border-bull/30 bg-surface-1' :
    toast.type === 'warn' ? 'text-regime-hot border-regime-hot/30 bg-surface-1' :
    toast.type === 'critical' ? 'text-bear-bright border-bear bg-bear/10' :
    'text-accent border-accent/30 bg-surface-1';

  return (
    <div className={cx('flex items-start gap-3 rounded-lg border p-3 shadow-lg pointer-events-auto transition-all w-[320px]', colorClass)}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-ink leading-none">{toast.title}</h4>
          {toast.count && toast.count > 1 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[10px] font-bold text-accent">
              {toast.count}
            </span>
          )}
        </div>
        {toast.message && <p className="mt-1 text-xs text-ink-muted leading-relaxed">{toast.message}</p>}
      </div>
      <button onClick={onClose} className="focus-ring text-ink-faint hover:text-ink transition-colors p-0.5">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { toasts: [], addToast: () => {}, removeToast: () => {} };
  return ctx;
}
