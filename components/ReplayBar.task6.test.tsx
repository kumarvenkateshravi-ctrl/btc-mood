import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReplayBar from './ReplayBar';

const baseProps = {
  selecting: false,
  playing: false,
  speed: 1,
  onExit: vi.fn(),
  onTogglePlay: vi.fn(),
  onSpeed: vi.fn(),
  onPickTime: vi.fn(),
};

describe('replay transport', () => {
  it('renders only the compact chart-first replay controls', () => {
    const html = renderToStaticMarkup(
      <ReplayBar {...baseProps} executionTimeframe="15m" />,
    );
    expect(html).toContain('data-testid="replay-controller"');
    expect(html).toContain('Select date');
    expect(html).toContain('aria-label="Select replay date"');
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain('aria-label="Replay speed"');
    expect(html).toContain('>15m</span>');
    expect(html).toContain('aria-label="Exit replay"');
    expect(html).not.toContain('Bookmarks and integrity');
    expect(html).not.toContain('Previous bar');
  });

  it('shows the requested date while its history is loading', () => {
    const html = renderToStaticMarkup(
      <ReplayBar {...baseProps} loadingDate={Date.UTC(2026, 7, 5)} executionTimeframe="15m" replayLoading="Preparing 15m replay history…" />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading 05 Aug 2026 history at 15m…');
    expect(html).toContain('Preparing 15m replay history…');
    expect(html).toContain('animate-spin');
  });

  it('keeps playback disabled until a date starts replay', () => {
    const html = renderToStaticMarkup(<ReplayBar {...baseProps} selecting />);
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain('disabled=""');
  });
});
