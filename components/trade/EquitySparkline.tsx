'use client';

import { useMemo } from 'react';

interface EquitySparklineProps {
  curve: number[];
  width?: number;
  height?: number;
}

export default function EquitySparkline({
  curve,
  width = 200,
  height = 40,
}: EquitySparklineProps) {
  const path = useMemo(() => {
    if (curve.length < 2) return null;
    const min = Math.min(...curve);
    const max = Math.max(...curve);
    const span = max - min || 1;
    const padX = 0;
    const padY = 2;
    const usableH = height - padY * 2;

    const points = curve.map((v, i) => {
      const x = padX + (i / (curve.length - 1)) * width;
      const y = padY + usableH - ((v - min) / span) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${points.join(' L')}`;
  }, [curve, width, height]);

  // Determine fill color: green gradient if final >= 0, red otherwise.
  const final = curve[curve.length - 1] ?? 0;
  const up = final >= 0;
  const strokeColor = up ? '#22d39a' : '#fb5168';

  if (!path) return null;

  const gradientId = up ? 'spark-grad-up' : 'spark-grad-down';
  // Close the area: line goes to bottom-right, then bottom-left, then back to start.
  const lastY = Number(path.split(' L').pop()?.split(',')[1] ?? '0');
  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="overflow-visible"
      role="img"
      aria-label={`Equity curve — ${up ? 'up' : 'down'} ${Math.abs(final).toFixed(2)}`}
    >
      <defs>
        <linearGradient id="spark-grad-up" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d39a" stopOpacity={0.18} />
          <stop offset="100%" stopColor="#22d39a" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="spark-grad-down" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb5168" stopOpacity={0.18} />
          <stop offset="100%" stopColor="#fb5168" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
