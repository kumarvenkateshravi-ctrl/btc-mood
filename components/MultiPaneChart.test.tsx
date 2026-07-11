// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { tfsForPanes } from '@/lib/gridLayout';

describe('MultiPaneChart — additionalPanes data plumbing', () => {
  it('tfsForPanes(4, "15m") returns 4 copies of the active TF', () => {
    expect(tfsForPanes(4, '15m')).toEqual(['15m', '15m', '15m', '15m']);
  });

  it('tfsForPanes(2, "1h") returns 2 copies of the active TF', () => {
    expect(tfsForPanes(2, '1h')).toEqual(['1h', '1h']);
  });

  it('tfsForPanes(1, "5m") returns a single-entry array', () => {
    expect(tfsForPanes(1, '5m')).toEqual(['5m']);
  });
});

describe('MultiPaneChart — module shape', () => {
  // Generous timeout: the dynamic import pulls the lightweight-charts graph
  // through the transform pipeline, which can exceed 5s under parallel-suite
  // contention.
  it('is a React component (default export)', { timeout: 30000 }, async () => {
    const mod = await import('./MultiPaneChart');
    expect(typeof mod.default).toBe('function');
  });
});
