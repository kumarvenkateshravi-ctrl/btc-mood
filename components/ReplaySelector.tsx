'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChartApi } from './Chart';

interface ReplaySelectorProps {
  api: ChartApi | null;
  width: number;
  height: number;
  onPick: (index: number) => void;
  onCancel: () => void;
}

/**
 * Replay cut-point picker. A tokenized vertical guide follows the cursor;
 * clicking a candle sets the replay start. Esc cancels.
 */
export default function ReplaySelector({ api, width, height, onPick, onCancel }: ReplaySelectorProps) {
  const [x, setX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const localX = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return clientX - r.left;
  };

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="absolute inset-0 z-30"
      style={{ cursor: 'crosshair' }}
      onPointerMove={(e) => setX(localX(e.clientX))}
      onPointerLeave={() => setX(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const idx = api?.logicalAt(localX(e.clientX));
        if (idx != null && idx >= 1) onPick(idx);
      }}
    >
      <rect x={0} y={0} width={width} height={height} fill="var(--base)" opacity={0.18} />
      {x != null && (
        <g>
          <line x1={x} y1={0} x2={x} y2={height} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="6 4" />
          <g transform={`translate(${Math.min(x + 8, Math.max(8, width - 118))}, 10)`}>
            <rect x={0} y={0} width={110} height={24} rx={6} fill="var(--surface-2)" stroke="var(--accent)" strokeWidth={1} />
            <text x={8} y={16} fill="var(--accent)" fontSize={11} fontFamily="ui-sans-serif, system-ui">
              Start replay here
            </text>
          </g>
        </g>
      )}
      <g transform={`translate(12, ${Math.max(12, height - 34)})`}>
        <rect x={0} y={0} width={306} height={24} rx={6} fill="var(--surface-2)" opacity={0.92} stroke="var(--line)" />
        <text x={8} y={16} fill="var(--ink-muted)" fontSize={11} fontFamily="ui-sans-serif, system-ui">
          Click a candle to start replay. Press Esc to cancel.
        </text>
      </g>
    </svg>
  );
}
