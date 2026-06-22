'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChartApi } from './Chart';

// A scissors cursor (emoji in an SVG data-URI; falls back to crosshair).
const SCISSORS_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><text x='2' y='20' font-size='18'>%E2%9C%82</text></svg>\") 6 20, crosshair";

interface ReplaySelectorProps {
  api: ChartApi | null;
  width: number;
  height: number;
  onPick: (index: number) => void;
  onCancel: () => void;
}

/**
 * Replay "cut point" picker: a blue dashed vertical line follows the cursor
 * with a scissors cursor; clicking a candle sets the replay start (everything
 * to its right is hidden). Esc cancels.
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
      style={{ cursor: SCISSORS_CURSOR }}
      onPointerMove={(e) => setX(localX(e.clientX))}
      onPointerLeave={() => setX(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const idx = api?.logicalAt(localX(e.clientX));
        if (idx != null && idx >= 1) onPick(idx);
      }}
    >
      <rect x={0} y={0} width={width} height={height} fill="rgba(10,14,22,0.12)" />
      {x != null && (
        <g>
          <line x1={x} y1={0} x2={x} y2={height} stroke="#5aa2e6" strokeWidth={1.5} strokeDasharray="6 4" />
          <g transform={`translate(${x + 6}, 8)`}>
            <rect x={0} y={0} width={70} height={18} rx={3} fill="#11151f" stroke="#5aa2e6" strokeWidth={1} />
            <text x={6} y={13} fill="#5aa2e6" fontSize={11} fontFamily="ui-sans-serif, system-ui">
              ✂ cut here
            </text>
          </g>
        </g>
      )}
      <g transform={`translate(10, ${height - 24})`}>
        <rect x={0} y={0} width={264} height={18} rx={3} fill="#11151f" fillOpacity={0.8} />
        <text x={6} y={13} fill="#7b88a0" fontSize={11} fontFamily="ui-sans-serif, system-ui">
          Click a candle to start replay · Esc to cancel
        </text>
      </g>
    </svg>
  );
}
