import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReplayBar from './ReplayBar';

const baseProps = {
  selecting: false,
  playing: false,
  phase: 'paused' as const,
  index: 24,
  total: 100,
  speed: 1,
  bookmarks: [],
  onExit: vi.fn(),
  onTogglePlay: vi.fn(),
  onStep: vi.fn(),
  onScrub: vi.fn(),
  onSpeed: vi.fn(),
  onBookmark: vi.fn(),
  onJumpBookmark: vi.fn(),
  onRemoveBookmark: vi.fn(),
};

describe('Stage 7 Task 6 replay controls', () => {
  it('keeps replay identity, UTC time, and visual/execution timeframe truth visible', () => {
    const html = renderToStaticMarkup(
      <ReplayBar
        {...baseProps}
        replayTime={Date.UTC(2026, 7, 23, 14, 35)}
        executionTimeframe="5m"
        visualTimeframe="1h"
      />,
    );
    expect(html).toContain('REPLAY');
    expect(html).toContain('Snapshot data');
    expect(html).toContain('Simulated execution');
    expect(html).toContain('23 Aug 2026 · 14:35 UTC');
    expect(html).toContain('Exec 5m');
    expect(html).toContain('Viewing: 1h');
    expect(html).toContain('Exit Replay');
  });

  it('shows end-of-data feedback and preserves safe boundary controls', () => {
    const html = renderToStaticMarkup(
      <ReplayBar {...baseProps} index={99} total={100} endOfData />,
    );
    expect(html).toContain('End of replay data');
    expect(html).toContain('aria-label="Next bar"');
    expect(html).toContain('disabled=""');
  });

  it('uses touch-sized primary controls and a compact mobile disclosure hook', () => {
    const html = renderToStaticMarkup(<ReplayBar {...baseProps} />);
    expect(html).toContain('data-testid="replay-controller"');
    expect(html).toContain('h-11 w-11');
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain('aria-label="Previous bar"');
    expect(html).toContain('aria-label="Next bar"');
  });
});
