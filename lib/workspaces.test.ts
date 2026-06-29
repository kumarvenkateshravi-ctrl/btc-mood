import { describe, it, expect } from 'vitest';
import { upsertWorkspace, removeWorkspace, isWorkspace } from './workspaces';

const cfg = { chartType: 'candlestick', symbol: 'BTCUSDT', tf: '15m', indicatorIds: ['rsi'] };

describe('workspaces', () => {
  it('upserts a new workspace at the front', () => {
    const list = upsertWorkspace([], 'Scalp', cfg);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Scalp');
    expect(list[0].indicatorIds).toEqual(['rsi']);
    expect(isWorkspace(list[0])).toBe(true);
  });

  it('replaces a workspace with the same name (case-insensitive)', () => {
    const a = upsertWorkspace([], 'Scalp', cfg);
    const b = upsertWorkspace(a, 'scalp', { ...cfg, tf: '1m' });
    expect(b.length).toBe(1);
    expect(b[0].tf).toBe('1m');
  });

  it('defaults a blank name to Untitled', () => {
    expect(upsertWorkspace([], '   ', cfg)[0].name).toBe('Untitled');
  });

  it('removes by id', () => {
    const a = upsertWorkspace([], 'Scalp', cfg);
    expect(removeWorkspace(a, a[0].id)).toEqual([]);
  });

  it('rejects malformed workspaces', () => {
    expect(isWorkspace({ id: '1', name: 'x' })).toBe(false);
    expect(isWorkspace({ ...cfg, id: '1', name: 'x' })).toBe(true);
  });
});
