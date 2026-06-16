import React, { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';

const TV_COLORS = [
  ['#ffffff', '#d1d4dc', '#b2b5be', '#787b86', '#434651', '#2a2e39', '#131722', '#000000'],
  ['#f23645', '#ff9800', '#ffeb3b', '#8ceb34', '#4caf50', '#089981', '#00bcd4', '#2962ff'],
  ['#e91e63', '#f44336', '#ff5722', '#ffc107', '#cddc39', '#8bc34a', '#009688', '#03a9f4'],
  ['#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bbd4', '#009688', '#4caf50', '#8bc34a'],
  ['#f8bbd0', '#f48fb1', '#f06292', '#ec407a', '#e91e63', '#d81b60', '#c2185b', '#ad1457'],
  ['#b3e5fc', '#81d4fa', '#4fc3f7', '#29b6f6', '#03a9f4', '#039be5', '#0288d1', '#0277bd'],
  ['#c8e6c9', '#a5d6a7', '#81c784', '#66bb6a', '#4caf50', '#43a047', '#388e3c', '#2e7d32'],
  ['#ffecb3', '#ffe082', '#ffd54f', '#ffca28', '#ffc107', '#ffb300', '#ffa000', '#ff8f00'],
];

export function ColorPicker({
  color,
  onChange,
  thickness,
  onThicknessChange,
}: {
  color: string;
  onChange: (c: string) => void;
  thickness?: number;
  onThicknessChange?: (t: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="h-8 w-12 rounded border border-[#363a45] overflow-hidden transition hover:border-[#434651]"
        style={{ backgroundColor: color }}
      />

      {open && (
        <div className="absolute right-0 top-10 z-50 flex w-[240px] flex-col gap-4 rounded-xl border border-[#2a2e39] bg-[#1a1e29] p-4 shadow-2xl">
          {/* Grid */}
          <div className="grid grid-cols-8 gap-1.5">
            {TV_COLORS.map((row, i) =>
              row.map((c, j) => (
                <button
                  key={`${i}-${j}`}
                  className="h-5 w-5 rounded-sm hover:scale-110 transition-transform"
                  style={{ backgroundColor: c }}
                  onClick={() => onChange(c)}
                />
              ))
            )}
          </div>

          <div className="h-px w-full bg-[#2a2e39]" />

          {/* Custom + Opacity */}
          <div className="flex items-center gap-2 text-[#a3a6af]">
            <button className="flex h-6 w-6 items-center justify-center rounded border border-[#2a2e39] hover:bg-[#2a2e39]">
              <Plus className="h-4 w-4" />
            </button>
            <div className="flex-1 text-[11px]">Opacity</div>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="100" defaultValue="100" className="w-20" />
              <span className="text-[11px] w-8 text-right">100%</span>
            </div>
          </div>

          {/* Thickness */}
          {thickness !== undefined && onThicknessChange && (
            <div className="flex flex-col gap-2">
              <div className="text-[11px] text-[#a3a6af]">Thickness</div>
              <div className="flex w-full overflow-hidden rounded border border-[#2a2e39]">
                {[1, 2, 3, 4].map((t) => (
                  <button
                    key={t}
                    onClick={() => onThicknessChange(t)}
                    className={['flex h-8 flex-1 items-center justify-center border-r border-[#2a2e39] last:border-0 hover:bg-[#2a2e39]', thickness === t ? 'bg-[#2a2e39]' : ''].join(' ')}
                  >
                    <div className="w-4 bg-white" style={{ height: t }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
