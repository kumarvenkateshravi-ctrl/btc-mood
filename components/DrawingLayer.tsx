'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChartApi } from './Chart';
import {
  useDrawings,
  addDrawing,
  updateDrawing,
  removeDrawing,
  undo,
  redo,
  newDrawingId,
  fibLevelPrices,
  type Drawing,
  type DPoint,
  type Tool,
} from '@/lib/drawings';
import {
  armDrawingCreation,
  cancelDrawingCreation,
  drawingCreationIncomplete,
  drawingCreationPreviewPoints,
  drawingToolDefinition,
  placeDrawingAnchor,
  previewDrawingCreation,
  type DrawingCreationState,
} from '@/lib/drawingCreation';

interface DrawingLayerProps {
  api: ChartApi | null;
  symbol: string;
  tool: Tool;
  color: string;
  magnet: boolean;
  locked: boolean;
  hidden: boolean;
  width: number;
  height: number;
  /** Bumped by the parent when candles change, to reposition drawings. */
  revision: number;
  /** Changes when timeframe, mode, symbol, or chart-session ownership changes. */
  creationContextKey: string;
  /** Called after a drawing commits, so the parent can reset the tool to cursor. */
  onToolUsed: () => void;
  onSelectionChange?: (id: string | null) => void;
}

interface ScreenPt {
  x: number;
  y: number;
}

function nearestOHLC(price: number, c: { open: number; high: number; low: number; close: number }): number {
  let best = c.open;
  for (const v of [c.high, c.low, c.close]) {
    if (Math.abs(v - price) < Math.abs(best - price)) best = v;
  }
  return best;
}

export default function DrawingLayer({
  api,
  symbol,
  tool,
  color,
  magnet,
  locked,
  hidden,
  width,
  height,
  creationContextKey,
  onToolUsed,
  onSelectionChange,
}: DrawingLayerProps) {
  const drawings = useDrawings(symbol);
  const svgRef = useRef<SVGSVGElement>(null);
  const activePointerId = useRef<number | null>(null);
  const creationGesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    multiTouch: boolean;
  } | null>(null);
  const touchPointers = useRef(new Set<number>());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creation, setCreation] = useState<DrawingCreationState>(() => armDrawingCreation(tool));
  const [textDraft, setTextDraft] = useState<{ point: DPoint; value: string } | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const selectDrawing = useCallback((id: string | null) => {
    setSelectedId(id);
    onSelectionChange?.(id);
  }, [onSelectionChange]);

  const [drag, setDrag] = useState<
    { id: string; handle: number | 'all'; startData: DPoint; startPoints: DPoint[]; live: DPoint[] } | null
  >(null);
  const [, setVersion] = useState(0);

  // Reposition on pan/zoom.
  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setVersion((v) => v + 1));
  }, [api]);

  // Tool, symbol, timeframe, mode, and chart-session changes cancel drafts.
  useEffect(() => {
    // These are intentionally transient session fields keyed by external chart ownership.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    selectDrawing(null);
    setCreation(armDrawingCreation(tool));
    setTextDraft(null);
    setDrag(null);
    creationGesture.current = null;
    touchPointers.current.clear();
  }, [creationContextKey, selectDrawing, symbol, tool]);

  useEffect(() => {
    if (textDraft) textInputRef.current?.focus();
  }, [textDraft]);

  // Latest values for the window-level pointer/key handlers.
  const ctx = useRef({ api, symbol, color, magnet, locked, tool, onToolUsed, onSelectionChange, creation, textDraft, drag, selectedId });
  useEffect(() => {
    ctx.current = { api, symbol, color, magnet, locked, tool, onToolUsed, onSelectionChange, creation, textDraft, drag, selectedId };
  });

  const sx = (t: number): number | null => api?.timeToX(t) ?? null;
  const sy = (p: number): number | null => api?.priceToY(p) ?? null;

  const screenToData = (lx: number, ly: number): DPoint | null => {
    const a = ctx.current.api;
    if (!a) return null;
    const time = a.xToTime(lx);
    let price = a.yToPrice(ly);
    if (time == null || price == null) return null;
    if (ctx.current.magnet) {
      const c = a.candleAtX(lx);
      if (c) price = nearestOHLC(price, c);
    }
    return { time, price };
  };

  const local = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const cancelActiveCreation = useCallback(() => {
    setCreation((current) => cancelDrawingCreation(current));
    setTextDraft(null);
    creationGesture.current = null;
    touchPointers.current.clear();
    ctx.current.onToolUsed();
  }, []);

  // ----- editing drag, driven by window listeners -----
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const { drag: dg } = ctx.current;
      if (!dg) return;
      if (activePointerId.current != null && e.pointerId !== activePointerId.current) return;
      const { x, y } = local(e.clientX, e.clientY);
      const p = screenToData(x, y);
      if (!p) return;
      let live: DPoint[];
      if (dg.handle === 'all') {
        const dt = p.time - dg.startData.time;
        const dp = p.price - dg.startData.price;
        live = dg.startPoints.map((sp) => ({ time: sp.time + dt, price: sp.price + dp }));
      } else {
        live = dg.startPoints.map((sp, i) => (i === dg.handle ? p : sp));
      }
      setDrag({ ...dg, live });
    };

    const onUp = (e: PointerEvent) => {
      if (activePointerId.current != null && e.pointerId !== activePointerId.current) return;
      const { drag: dg, symbol: sym } = ctx.current;
      if (dg) {
        const changed = dg.live.some((point, index) => (
          point.time !== dg.startPoints[index]?.time || point.price !== dg.startPoints[index]?.price
        ));
        if (changed) updateDrawing(sym, dg.id, { points: dg.live });
        setDrag(null);
        activePointerId.current = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const { selectedId: sel, symbol: sym, locked: lk, creation: cr, textDraft: text, drag: dg } = ctx.current;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !lk) {
        removeDrawing(sym, sel);
        selectDrawing(null);
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (e.key === 'Escape' && (ctx.current.tool !== 'cursor' || drawingCreationIncomplete(cr) || text || dg || sel)) {
        cancelActiveCreation();
        setDrag(null);
        selectDrawing(null);
        activePointerId.current = null;
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          redo(sym);
        } else {
          undo(sym);
        }
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      activePointerId.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [cancelActiveCreation, selectDrawing]);

  const placeCreationAnchor = (point: DPoint) => {
    const transition = placeDrawingAnchor(ctx.current.creation, point);
    setCreation(transition.state);
    if (!transition.commit) return;
    if (transition.commit.tool === 'text') {
      setTextDraft({ point: transition.commit.points[0], value: '' });
      return;
    }
    const drawing: Drawing = {
      id: newDrawingId(),
      type: transition.commit.tool,
      points: [...transition.commit.points],
      color: ctx.current.color,
    };
    addDrawing(ctx.current.symbol, drawing);
    selectDrawing(drawing.id);
    ctx.current.onToolUsed();
  };

  const commitText = () => {
    const pending = ctx.current.textDraft;
    const value = pending?.value.trim() ?? '';
    if (!pending || !value) {
      cancelActiveCreation();
      return;
    }
    const drawing: Drawing = {
      id: newDrawingId(),
      type: 'text',
      points: [pending.point],
      color: ctx.current.color,
      text: value,
    };
    addDrawing(ctx.current.symbol, drawing);
    selectDrawing(drawing.id);
    setTextDraft(null);
    ctx.current.onToolUsed();
  };

  const onDrawingDown = (e: React.PointerEvent, d: Drawing) => {
    if (tool !== 'cursor' || locked || e.button !== 0 || !e.isPrimary) return;
    activePointerId.current = e.pointerId;
    e.stopPropagation();
    const { x, y } = local(e.clientX, e.clientY);
    selectDrawing(d.id);
    const pts = d.points.map((p) => ({ x: sx(p.time) ?? -9999, y: sy(p.price) ?? -9999 }));
    let handle: number | 'all' = 'all';
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(x - pts[i].x, y - pts[i].y) < 9) {
        handle = i;
        break;
      }
    }
    const startData = screenToData(x, y);
    if (!startData) return;
    setDrag({ id: d.id, handle, startData, startPoints: d.points, live: d.points });
  };

  if (hidden || !api) return null;

  // Render committed drawings, editing previews, and transient creation previews.
  const liveDrawing = (d: Drawing): Drawing =>
    drag && drag.id === d.id ? { ...d, points: drag.live } : d;
  const previewPoints = drawingCreationPreviewPoints(creation);
  const previewDrawing = creation.tool && previewPoints.length > 0 && creation.tool !== 'text'
    ? { id: '__draft', type: creation.tool, points: [...previewPoints], color }
    : null;
  const incomplete = drawingCreationIncomplete(creation);
  const instruction = creation.tool ? drawingToolDefinition(creation.tool).nextAnchorLabel : '';
  const textX = textDraft ? sx(textDraft.point.time) : null;
  const textY = textDraft ? sy(textDraft.point.price) : null;

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        data-testid="drawing-layer"
        data-creation-phase={creation.phase}
        className="absolute inset-0 z-20"
        style={{
          pointerEvents: tool === 'cursor' ? 'none' : 'auto',
          cursor: tool === 'cursor' ? 'default' : 'crosshair',
          touchAction: tool === 'cursor' ? 'auto' : 'none',
        }}
        onPointerDown={(event) => {
          if (tool === 'cursor' || event.button !== 0 || !event.isPrimary && event.pointerType !== 'touch') return;
          event.preventDefault();
          event.stopPropagation();
          if (event.pointerType === 'touch') {
            touchPointers.current.add(event.pointerId);
            if (touchPointers.current.size > 1) {
              if (creationGesture.current) creationGesture.current.multiTouch = true;
              return;
            }
          }
          creationGesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            multiTouch: false,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (tool === 'cursor') return;
          const gesture = creationGesture.current;
          if (gesture?.pointerId === event.pointerId && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 6) {
            gesture.moved = true;
          }
          if (creation.anchors.length === 0 || !event.isPrimary) return;
          const { x, y } = local(event.clientX, event.clientY);
          const point = screenToData(x, y);
          if (point) setCreation((current) => previewDrawingCreation(current, point));
        }}
        onPointerUp={(event) => {
          if (tool === 'cursor') return;
          event.preventDefault();
          event.stopPropagation();
          if (event.pointerType === 'touch') touchPointers.current.delete(event.pointerId);
          const gesture = creationGesture.current;
          if (!gesture || gesture.pointerId !== event.pointerId) return;
          creationGesture.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          if (gesture.moved || gesture.multiTouch) return;
          const { x, y } = local(event.clientX, event.clientY);
          const point = screenToData(x, y);
          if (point) placeCreationAnchor(point);
        }}
        onPointerCancel={(event) => {
          touchPointers.current.delete(event.pointerId);
          if (creationGesture.current?.pointerId === event.pointerId) creationGesture.current = null;
        }}
        onContextMenu={(event) => {
          if (tool === 'cursor' && !incomplete && !textDraft) return;
          event.preventDefault();
          event.stopPropagation();
          cancelActiveCreation();
        }}
      >
        {drawings.map((d0) => {
          const d = liveDrawing(d0);
          return (
            <DrawingShape
              key={d.id}
              drawing={d}
              selected={selectedId === d.id}
              cursorMode={tool === 'cursor'}
              sx={sx}
              sy={sy}
              width={width}
              onPointerDown={(e) => onDrawingDown(e, d0)}
            />
          );
        })}
        {previewDrawing && (
          <DrawingShape
            drawing={previewDrawing}
            selected
            cursorMode={false}
            sx={sx}
            sy={sy}
            width={width}
          />
        )}
      </svg>

      {incomplete && (
        <div data-testid="drawing-creation-hint" className="pointer-events-auto absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border border-line-strong bg-surface-1 px-2.5 py-1.5 text-[11px] text-ink shadow-lg">
          <span>{instruction}</span>
          <button type="button" onClick={cancelActiveCreation} className="focus-ring rounded px-1.5 py-0.5 font-semibold text-ink-muted hover:text-ink">Cancel</button>
        </div>
      )}

      {textDraft && textX != null && textY != null && (
        <form
          data-testid="drawing-text-editor"
          className="absolute z-30 flex items-center gap-1 rounded-md border border-line-strong bg-surface-1 p-1 shadow-lg"
          style={{ left: Math.max(8, Math.min(width - 220, textX)), top: Math.max(8, textY - 18) }}
          onSubmit={(event) => { event.preventDefault(); commitText(); }}
        >
          <input
            ref={textInputRef}
            aria-label="Drawing text"
            value={textDraft.value}
            onChange={(event) => setTextDraft((current) => current ? { ...current, value: event.target.value } : current)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelActiveCreation();
              }
            }}
            className="focus-ring h-8 w-36 rounded border border-line bg-base px-2 text-xs text-ink"
            placeholder="Text label"
          />
          <button type="submit" disabled={!textDraft.value.trim()} className="focus-ring h-8 rounded bg-accent px-2 text-xs font-semibold text-base disabled:opacity-40">Add</button>
          <button type="button" onClick={cancelActiveCreation} className="focus-ring h-8 rounded px-2 text-xs font-semibold text-ink-muted hover:text-ink">Cancel</button>
        </form>
      )}
    </>
  );
}

function DrawingShape({
  drawing: d,
  selected,
  cursorMode,
  sx,
  sy,
  width,
  onPointerDown,
}: {
  drawing: Drawing;
  selected: boolean;
  cursorMode: boolean;
  sx: (t: number) => number | null;
  sy: (p: number) => number | null;
  width: number;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const hitEvents = cursorMode ? 'auto' : 'none';
  const stroke = d.color;
  const sw = selected ? 2.5 : 1.5;

  const pts: ScreenPt[] = d.points.map((p) => ({ x: sx(p.time) ?? NaN, y: sy(p.price) ?? NaN }));

  const handles = (screen: ScreenPt[]) =>
    selected
      ? screen.map((p, i) =>
          Number.isFinite(p.x) && Number.isFinite(p.y) ? (
            <circle key={i} cx={p.x} cy={p.y} r={4} fill="#11151f" stroke={stroke} strokeWidth={1.5} />
          ) : null,
        )
      : null;

  // Wide invisible hit line for selection/drag.
  const hit = (x1: number, y1: number, x2: number, y2: number) => (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="transparent"
      strokeWidth={10}
      style={{ pointerEvents: hitEvents, cursor: 'move' }}
      onPointerDown={onPointerDown}
    />
  );

  if (d.type === 'horizontal') {
    const y = pts[0]?.y;
    if (!Number.isFinite(y)) return null;
    return (
      <g>
        <line x1={0} y1={y} x2={width} y2={y} stroke={stroke} strokeWidth={sw} strokeDasharray="6 4" />
        {hit(0, y, width, y)}
        {handles([{ x: width / 2, y }])}
      </g>
    );
  }

  if (d.type === 'text') {
    const p = pts[0];
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return null;
    return (
      <g>
        <text x={p.x} y={p.y} fill={stroke} fontSize={13} fontFamily="ui-sans-serif, system-ui" style={{ pointerEvents: hitEvents, cursor: 'move' }} onPointerDown={onPointerDown}>
          {d.text || 'Text'}
        </text>
        {handles([p])}
      </g>
    );
  }

  // 2-point shapes.
  const a = pts[0];
  const b = pts[1];
  if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    return null;
  }

  if (d.type === 'trendline') {
    return (
      <g>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={sw} />
        {hit(a.x, a.y, b.x, b.y)}
        {handles([a, b])}
      </g>
    );
  }

  if (d.type === 'ray') {
    // Extend from a through b to the right/left edge.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const targetX = dx >= 0 ? width : 0;
    const t = dx !== 0 ? (targetX - a.x) / dx : 0;
    const ex = dx !== 0 ? targetX : b.x;
    const ey = dx !== 0 ? a.y + dy * t : b.y;
    return (
      <g>
        <line x1={a.x} y1={a.y} x2={ex} y2={ey} stroke={stroke} strokeWidth={sw} />
        {hit(a.x, a.y, b.x, b.y)}
        {handles([a, b])}
      </g>
    );
  }

  if (d.type === 'rectangle') {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={stroke} fillOpacity={0.08} stroke={stroke} strokeWidth={sw} />
        <rect x={x} y={y} width={w} height={h} fill="transparent" style={{ pointerEvents: hitEvents, cursor: 'move' }} onPointerDown={onPointerDown} />
        {handles([a, b])}
      </g>
    );
  }

  if (d.type === 'fib') {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const levels = fibLevelPrices(d.points[0].price, d.points[1].price);
    return (
      <g>
        {levels.map((lv, i) => {
          const y = sy(lv.price);
          if (y == null) return null;
          return (
            <g key={i}>
              <line x1={x0} y1={y} x2={x1} y2={y} stroke={stroke} strokeWidth={1} strokeOpacity={0.7} />
              <text x={x0 + 2} y={y - 2} fill={stroke} fontSize={9} fontFamily="ui-monospace, monospace" fillOpacity={0.9}>
                {lv.level.toFixed(3)} · {lv.price.toFixed(1)}
              </text>
            </g>
          );
        })}
        {hit(a.x, a.y, b.x, b.y)}
        {handles([a, b])}
      </g>
    );
  }

  if (d.type === 'measure') {
    const p0 = d.points[0];
    const p1 = d.points[1];
    const dPrice = p1.price - p0.price;
    const pct = p0.price !== 0 ? (dPrice / p0.price) * 100 : 0;
    const up = dPrice >= 0;
    const col = up ? '#22d39a' : '#fb5168';
    const midX = (a.x + b.x) / 2;
    const label = `${up ? '+' : ''}${dPrice.toFixed(1)} (${up ? '+' : ''}${pct.toFixed(2)}%)`;
    return (
      <g>
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          fill={col}
          fillOpacity={0.1}
          stroke={col}
          strokeWidth={1}
        />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={sw} />
        <g transform={`translate(${midX}, ${b.y})`}>
          <rect x={-52} y={6} width={104} height={16} rx={3} fill="#11151f" stroke={col} strokeWidth={1} />
          <text x={0} y={18} fill={col} fontSize={10} fontFamily="ui-monospace, monospace" textAnchor="middle">
            {label}
          </text>
        </g>
        {hit(a.x, a.y, b.x, b.y)}
        {handles([a, b])}
      </g>
    );
  }

  return null;
}
