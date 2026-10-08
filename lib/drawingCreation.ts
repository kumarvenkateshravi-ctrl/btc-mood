import type { DPoint, DrawingType, Tool } from './drawings';

export type DrawingCreationMode =
  | 'single-anchor'
  | 'multi-anchor'
  | 'text-placement'
  | 'freehand'
  | 'continuous';

export interface DrawingToolDefinition {
  readonly id: DrawingType;
  readonly anchorCount: number;
  readonly creationMode: DrawingCreationMode;
  readonly supportsPreview: boolean;
  readonly commitPolicy: 'final-anchor';
  readonly nextAnchorLabel: string;
}

export const DRAWING_TOOL_DEFINITIONS: Readonly<Record<DrawingType, DrawingToolDefinition>> = Object.freeze({
  horizontal: Object.freeze({ id: 'horizontal', anchorCount: 1, creationMode: 'single-anchor', supportsPreview: false, commitPolicy: 'final-anchor', nextAnchorLabel: 'Choose price' }),
  text: Object.freeze({ id: 'text', anchorCount: 1, creationMode: 'text-placement', supportsPreview: false, commitPolicy: 'final-anchor', nextAnchorLabel: 'Place text' }),
  trendline: Object.freeze({ id: 'trendline', anchorCount: 2, creationMode: 'multi-anchor', supportsPreview: true, commitPolicy: 'final-anchor', nextAnchorLabel: 'Choose endpoint' }),
  ray: Object.freeze({ id: 'ray', anchorCount: 2, creationMode: 'multi-anchor', supportsPreview: true, commitPolicy: 'final-anchor', nextAnchorLabel: 'Choose direction' }),
  rectangle: Object.freeze({ id: 'rectangle', anchorCount: 2, creationMode: 'multi-anchor', supportsPreview: true, commitPolicy: 'final-anchor', nextAnchorLabel: 'Choose opposite corner' }),
  fib: Object.freeze({ id: 'fib', anchorCount: 2, creationMode: 'multi-anchor', supportsPreview: true, commitPolicy: 'final-anchor', nextAnchorLabel: 'Choose endpoint' }),
  measure: Object.freeze({ id: 'measure', anchorCount: 2, creationMode: 'multi-anchor', supportsPreview: true, commitPolicy: 'final-anchor', nextAnchorLabel: 'Choose endpoint' }),
});

export type DrawingCreationPhase =
  | 'idle'
  | 'armed'
  | 'anchor-placement'
  | 'previewing'
  | 'committed'
  | 'cancelled';

export interface DrawingCreationState {
  readonly phase: DrawingCreationPhase;
  readonly tool: DrawingType | null;
  readonly anchors: readonly DPoint[];
  readonly preview: DPoint | null;
}

export interface DrawingCreationCommit {
  readonly tool: DrawingType;
  readonly points: readonly DPoint[];
}

export interface DrawingCreationTransition {
  readonly state: DrawingCreationState;
  readonly commit: DrawingCreationCommit | null;
  readonly rejected: boolean;
}

export const IDLE_DRAWING_CREATION: DrawingCreationState = Object.freeze({
  phase: 'idle',
  tool: null,
  anchors: Object.freeze([]),
  preview: null,
});

const freezePoint = (point: DPoint): DPoint => Object.freeze({ time: point.time, price: point.price });

const state = (
  phase: DrawingCreationPhase,
  tool: DrawingType | null,
  anchors: readonly DPoint[] = [],
  preview: DPoint | null = null,
): DrawingCreationState => Object.freeze({
  phase,
  tool,
  anchors: Object.freeze(anchors.map(freezePoint)),
  preview: preview ? freezePoint(preview) : null,
});

export function drawingToolDefinition(tool: DrawingType): DrawingToolDefinition {
  return DRAWING_TOOL_DEFINITIONS[tool];
}

export function armDrawingCreation(tool: Tool): DrawingCreationState {
  return tool === 'cursor' ? IDLE_DRAWING_CREATION : state('armed', tool);
}

export function previewDrawingCreation(current: DrawingCreationState, point: DPoint): DrawingCreationState {
  if (!current.tool || current.anchors.length === 0) return current;
  const definition = drawingToolDefinition(current.tool);
  if (!definition.supportsPreview || current.anchors.length >= definition.anchorCount) return current;
  return state('previewing', current.tool, current.anchors, point);
}

export function validDrawingGeometry(tool: DrawingType, points: readonly DPoint[]): boolean {
  const definition = drawingToolDefinition(tool);
  if (points.length !== definition.anchorCount) return false;
  if (points.some((point) => !Number.isFinite(point.time) || !Number.isFinite(point.price))) return false;
  if (definition.anchorCount === 1) return true;
  return points.some((point, index) => index > 0 && (
    Math.abs(point.time - points[0].time) > 1e-9 || Math.abs(point.price - points[0].price) > 1e-9
  ));
}

export function placeDrawingAnchor(current: DrawingCreationState, point: DPoint): DrawingCreationTransition {
  if (!current.tool || current.phase === 'idle' || current.phase === 'committed' || current.phase === 'cancelled') {
    return Object.freeze({ state: current, commit: null, rejected: true });
  }
  const definition = drawingToolDefinition(current.tool);
  const anchors = [...current.anchors, freezePoint(point)];
  if (anchors.length < definition.anchorCount) {
    return Object.freeze({
      state: state('anchor-placement', current.tool, anchors, point),
      commit: null,
      rejected: false,
    });
  }
  const completed = anchors.slice(0, definition.anchorCount);
  if (!validDrawingGeometry(current.tool, completed)) {
    return Object.freeze({
      state: state('anchor-placement', current.tool, current.anchors, point),
      commit: null,
      rejected: true,
    });
  }
  const committed = state('committed', current.tool, completed, null);
  return Object.freeze({
    state: committed,
    commit: Object.freeze({ tool: current.tool, points: Object.freeze(completed.map(freezePoint)) }),
    rejected: false,
  });
}

export function cancelDrawingCreation(current: DrawingCreationState): DrawingCreationState {
  if (!current.tool) return IDLE_DRAWING_CREATION;
  return state('cancelled', current.tool);
}

export function drawingCreationPreviewPoints(current: DrawingCreationState): readonly DPoint[] {
  if (!current.tool || current.anchors.length === 0) return Object.freeze([]);
  const definition = drawingToolDefinition(current.tool);
  if (!definition.supportsPreview) return current.anchors;
  const points = [...current.anchors];
  if (points.length < definition.anchorCount && current.preview) points.push(current.preview);
  while (points.length < definition.anchorCount) points.push(points[points.length - 1]);
  return Object.freeze(points.slice(0, definition.anchorCount).map(freezePoint));
}

export function drawingCreationIncomplete(current: DrawingCreationState): boolean {
  return current.tool !== null && current.anchors.length > 0 && (
    current.phase === 'anchor-placement' || current.phase === 'previewing'
  );
}
