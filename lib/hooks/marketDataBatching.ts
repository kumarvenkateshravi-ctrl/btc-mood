/**
 * Small frame-coalescing primitive for forming candles. Execution paths stay
 * immediate; this queue is only for visual React state updates.
 */
export interface LatestFrameQueue<T> {
  enqueue(key: string, value: T): void;
  flush(): void;
  clear(): void;
  pending(): Record<string, T>;
}

export function createLatestFrameQueue<T>(
  onFlush: (updates: Record<string, T>) => void,
  schedule: (callback: () => void) => void = (callback) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(callback);
    } else {
      setTimeout(callback, 0);
    }
  },
): LatestFrameQueue<T> {
  const queued = new Map<string, T>();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (queued.size === 0) return;
    const updates = Object.fromEntries(queued);
    queued.clear();
    onFlush(updates);
  };

  return {
    clear() {
      queued.clear();
      scheduled = false;
    },
    enqueue(key, value) {
      queued.set(key, value);
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
    flush,
    pending: () => Object.fromEntries(queued),
  };
}
