import { describe, expect, it, afterEach } from 'vitest';
import { isDebugEnabled } from './debug';

const g = globalThis as { window?: unknown };

describe('isDebugEnabled', () => {
  afterEach(() => { delete g.window; });

  it('is false without a window (SSR)', () => {
    expect(isDebugEnabled('marketStructure')).toBe(false);
  });

  it('is false without ?debug', () => {
    g.window = { location: { search: '' } };
    expect(isDebugEnabled('marketStructure')).toBe(false);
  });

  it('is true for ?debug=1 (all scopes)', () => {
    g.window = { location: { search: '?debug=1' } };
    expect(isDebugEnabled('marketStructure')).toBe(true);
    expect(isDebugEnabled('scanner')).toBe(true);
  });

  it('is true for a named scope only', () => {
    g.window = { location: { search: '?debug=marketStructure' } };
    expect(isDebugEnabled('marketStructure')).toBe(true);
    expect(isDebugEnabled('scanner')).toBe(false);
  });
});
