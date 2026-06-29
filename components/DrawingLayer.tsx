'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChartApi } from './Chart';
import {
  useDrawings,
  addDrawing,
  updateDrawing,
  removeDrawing,
  newDrawingId,
  fibLevelPrices,
  TOOL_POINTS,
  type Drawing,
  type DPoint,
  type Tool,
} from '@/lib/drawings';

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
  /** Called after a drawing commits, so the parent can reset the tool to cursor. */
  onToolUsed: () => void;
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
  onToolUsed,
}: DrawingLayerProps) {
  const drawings = useDrawings(symbol);
  const svgRef = useRef<SVGSVGElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ type: Exclude<Tool, 'cursor'>; points: DPoint[] } | null>(null);
  const [drag, setDrag] = useState<
    { id: string; handle: number | 'all'; startData: DPoint; startPoints: DPoint[]; live: DPoint[] } | null
  >(null);
  const [, setVersion] = useState(0);

  // Reposition on pan/zoom.
  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setVersion((v) => v + 1));
  }, [api]);

  // Reset transient state when the symbol changes (different drawing set).
  useEffect(() => {
    setSelectedId(null);
    setDraft(null);
    setDrag(null);
  }, [symbol]);

  // Latest values for the window-level pointer/key handlers.
  const ctx = useRef({ api, symbol, color, magnet, locked, tool, onToolUsed, draft, drag, selectedId });
  ctx.current = { api, symbol, color, magnet, locked, tool, onToolUsed, draft, drag, selectedId };

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

  // ----- creation + drag, driven by window listeners -----
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const { draft: dr, drag: dg } = ctx.current;
      if (!dr && !dg) return;
      const { x, y } = local(e.clientX, e.clientY);
      const p = screenToData(x, y);
      if (!p) return;
      if (dr) {
        setDraft({ type: dr.type, points: [dr.points[0], p] });
      } else if (dg) {
        let live: DPoint[];
        if (dg.handle === 'all') {
          const dt = p.time - dg.startData.time;
          const dp = p.price - dg.startData.price;
          live = dg.startPoints.map((sp) => ({ time: sp.time + dt, price: sp.price + dp }));
        } else {
          live = dg.startPoints.map((sp, i) => (i === dg.handle ? p : sp));
        }
        setDrag({ ...dg, live });
      }
    };

    const onUp = () => {
      const { draft: dr, drag: dg, symbol: sym, color: col, onToolUsed: used } = ctx.current;
      if (dr) {
        const [a, b] = dr.points;
        if (Math.abs(a.time - b.time) > 1e-9 || Math.abs(a.price - b.price) > 1e-9) {
          const d: Drawing = { id: newDrawingId(), type: dr.type, points: dr.points, color: col };
          addDrawing(sym, d);
          setSelectedId(d.id);
        }
        setDraft(null);
        used();
      } else if (dg) {
        updateDrawing(sym, dg.id, { points: dg.live });
        setDrag(null);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const { selectedId: sel, symbol: sym, locked: lk } = ctx.current;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !lk) {
        removeDrawing(sym, sel);
        setSelectedId(null);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        setDraft(null);
        setSelectedId(null);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const startCreate = (lx: number, ly: number) => {
    const p = screenToData(lx, ly);
    if (!p || tool === 'cursor') return;
    if (TOOL_POINTS[tool] === 1) {
      let text: string | undefined;
      if (tool === 'text') {
        text = (typeof window !== 'undefined' ? window.prompt('Text label:') : '') ?? '';
        if (!text) return;
      }
      const d: Drawing = { id: newDrawingId(), type: tool, points: [p], color, ...(text != null ? { text } : {}) };
      addDrawing(symbol, d);
      setSelectedId(d.id);
      onToolUsed();
    } else {
      setDraft({ type: tool, points: [p, p] });
    }
  };

  const onDrawingDown = (e: React.PointerEvent, d: Drawing) => {
    if (tool !== 'cursor' || locked || e.button !== 0) return;
    e.stopPropagation();
    const { x, y } = local(e.clientX, e.clientY);
    setSelectedId(d.id);
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

  // Render a drawing (committed, or its live-drag / draft override) to SVG.
  const liveDrawing = (d: Drawing): Drawing =>
    drag && drag.id === d.id ? { ...d, points: drag.live } : d;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="absolute inset-0 z-20"
      style={{ pointerEvents: tool === 'cursor' ? 'none' : 'auto', cursor: tool === 'cursor' ? 'default' : 'crosshair' }}
      onPointerDown={(e) => {
        if (tool === 'cursor' || e.button !== 0) return;
        e.stopPropagation();
        const { x, y } = local(e.clientX, e.clientY);
        startCreate(x, y);
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
      {draft && (
        <DrawingShape
          drawing={{ id: '__draft', type: draft.type, points: draft.points, color }}
          selected
          cursorMode={false}
          sx={sx}
          sy={sy}
          width={width}
        />
      )}
    </svg>
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
