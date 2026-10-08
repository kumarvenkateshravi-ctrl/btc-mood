import { describe, expect, it } from 'vitest';
import {
  DRAWING_TOOL_DEFINITIONS,
  armDrawingCreation,
  cancelDrawingCreation,
  drawingCreationPreviewPoints,
  placeDrawingAnchor,
  previewDrawingCreation,
} from './drawingCreation';

const a = { time: 100, price: 50 };
const b = { time: 200, price: 75 };

describe('shared drawing creation state machine', () => {
  it('moves idle → armed → first anchor → preview → final commit', () => {
    const armed = armDrawingCreation('rectangle');
    expect(armed.phase).toBe('armed');

    const first = placeDrawingAnchor(armed, a);
    expect(first.state.phase).toBe('anchor-placement');
    expect(first.commit).toBeNull();

    const preview = previewDrawingCreation(first.state, b);
    expect(preview.phase).toBe('previewing');
    expect(drawingCreationPreviewPoints(preview)).toEqual([a, b]);

    const final = placeDrawingAnchor(preview, b);
    expect(final.state.phase).toBe('committed');
    expect(final.commit).toEqual({ tool: 'rectangle', points: [a, b] });
  });

  it('commits a single-anchor tool in one placement', () => {
    const result = placeDrawingAnchor(armDrawingCreation('horizontal'), a);
    expect(result.commit).toEqual({ tool: 'horizontal', points: [a] });
  });

  it('cancels without preserving anchors', () => {
    const first = placeDrawingAnchor(armDrawingCreation('fib'), a).state;
    const cancelled = cancelDrawingCreation(first);
    expect(cancelled).toMatchObject({ phase: 'cancelled', tool: 'fib', anchors: [], preview: null });
  });

  it('tool changes replace the unfinished draft with a newly armed tool', () => {
    const rectangle = placeDrawingAnchor(armDrawingCreation('rectangle'), a).state;
    expect(rectangle.anchors).toHaveLength(1);
    const fib = armDrawingCreation('fib');
    expect(fib).toMatchObject({ phase: 'armed', tool: 'fib', anchors: [] });
  });

  it('rejects invalid final geometry without committing', () => {
    const first = placeDrawingAnchor(armDrawingCreation('trendline'), a).state;
    const invalid = placeDrawingAnchor(first, a);
    expect(invalid.rejected).toBe(true);
    expect(invalid.commit).toBeNull();
    expect(invalid.state.phase).toBe('anchor-placement');
  });

  it('registers every current drawing tool declaratively', () => {
    expect(Object.values(DRAWING_TOOL_DEFINITIONS).map(({ id, anchorCount, creationMode }) => ({ id, anchorCount, creationMode }))).toEqual([
      { id: 'horizontal', anchorCount: 1, creationMode: 'single-anchor' },
      { id: 'text', anchorCount: 1, creationMode: 'text-placement' },
      { id: 'trendline', anchorCount: 2, creationMode: 'multi-anchor' },
      { id: 'ray', anchorCount: 2, creationMode: 'multi-anchor' },
      { id: 'rectangle', anchorCount: 2, creationMode: 'multi-anchor' },
      { id: 'fib', anchorCount: 2, creationMode: 'multi-anchor' },
      { id: 'measure', anchorCount: 2, creationMode: 'multi-anchor' },
    ]);
  });
});
