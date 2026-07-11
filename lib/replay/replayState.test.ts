import { describe, it, expect, beforeEach } from 'vitest';
import { replayActions, getReplayState, isReplayActive } from './replayState';

beforeEach(() => {
  replayActions.exit();
});

describe('replay state machine', () => {
  it('follows the legal lifecycle', () => {
    expect(getReplayState().phase).toBe('idle');
    expect(replayActions.enterSelecting()).toBe(true);
    expect(replayActions.startAt(120)).toBe(true);
    expect(getReplayState()).toMatchObject({ phase: 'ready', playIndex: 120, startIndex: 120 });
    expect(replayActions.play()).toBe(true);
    expect(replayActions.pause()).toBe(true);
    expect(replayActions.play()).toBe(true);
    expect(replayActions.finish()).toBe(true);
    expect(replayActions.exit()).toBe(true);
    expect(getReplayState().phase).toBe('idle');
  });

  it('ignores illegal transitions', () => {
    expect(replayActions.play()).toBe(false); // idle → playing is illegal
    expect(getReplayState().phase).toBe('idle');
    replayActions.enterSelecting();
    expect(replayActions.finish()).toBe(false); // selecting → finished is illegal
    expect(getReplayState().phase).toBe('selecting');
  });

  it('scrub clamps, finishes at the end while playing, and un-finishes when scrubbed back', () => {
    replayActions.enterSelecting();
    replayActions.startAt(50);
    replayActions.play();
    replayActions.scrubTo(5000, 100); // clamp to 99 = end while playing
    expect(getReplayState()).toMatchObject({ phase: 'finished', playIndex: 99 });
    replayActions.scrubTo(40, 100); // back off the end
    expect(getReplayState()).toMatchObject({ phase: 'paused', playIndex: 40 });
    replayActions.stepBy(-1000, 100); // clamp low
    expect(getReplayState().playIndex).toBe(1);
  });

  it('scrub is a no-op while idle/selecting', () => {
    replayActions.scrubTo(10, 100);
    expect(getReplayState().playIndex).toBe(0);
  });

  it('isReplayActive covers armed phases only', () => {
    expect(isReplayActive('idle')).toBe(false);
    expect(isReplayActive('selecting')).toBe(false);
    expect(isReplayActive('ready')).toBe(true);
    expect(isReplayActive('playing')).toBe(true);
    expect(isReplayActive('paused')).toBe(true);
    expect(isReplayActive('finished')).toBe(true);
  });

  it('is deterministic: identical action scripts produce identical states', () => {
    const script = () => {
      replayActions.exit();
      replayActions.enterSelecting();
      replayActions.startAt(30);
      replayActions.play();
      replayActions.stepBy(10, 200);
      replayActions.pause();
      replayActions.scrubTo(120, 200);
      return { ...getReplayState() };
    };
    expect(script()).toEqual(script());
  });
});
