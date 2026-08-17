'use client';

import {
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Minus,
  MousePointer2,
  MoveUpRight,
  Ruler,
  Square,
  Trash2,
  TrendingUp,
  Type,
} from 'lucide-react';
import { DRAWING_COLORS, type Tool } from '@/lib/drawings';

interface DrawingToolbarProps {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  color: string;
  onColorChange: (c: string) => void;
  magnet: boolean;
  onMagnetToggle: () => void;
  locked: boolean;
  onLockToggle: () => void;
  hidden: boolean;
  onHiddenToggle: () => void;
  onClear: () => void;
  count: number;
}

const TOOLS: { tool: Tool; label: string; icon: React.ReactNode }[] = [
  { tool: 'cursor', label: 'Cursor (select)', icon: <MousePointer2 className="h-5 w-5" /> },
  { tool: 'horizontal', label: 'Horizontal line', icon: <Minus className="h-5 w-5" /> },
  { tool: 'trendline', label: 'Trend line', icon: <TrendingUp className="h-5 w-5" /> },
  { tool: 'ray', label: 'Ray', icon: <MoveUpRight className="h-5 w-5" /> },
  { tool: 'rectangle', label: 'Rectangle / zone', icon: <Square className="h-5 w-5" /> },
  { tool: 'fib', label: 'Fib retracement', icon: <span className="text-[17px] font-semibold leading-none">φ</span> },
  { tool: 'measure', label: 'Measure', icon: <Ruler className="h-5 w-5" /> },
  { tool: 'text', label: 'Text', icon: <Type className="h-5 w-5" /> },
];

export default function DrawingToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  magnet,
  onMagnetToggle,
  locked,
  onLockToggle,
  hidden,
  onHiddenToggle,
  onClear,
  count,
}: DrawingToolbarProps) {
  return (
    <div className="flex w-10 flex-col items-center gap-1 border-r border-line bg-base py-2">
      {TOOLS.map((t) => (
        <RailButton
          key={t.tool}
          label={t.label}
          active={tool === t.tool}
          onClick={() => onToolChange(t.tool)}
        >
          {t.icon}
        </RailButton>
      ))}

      <div className="my-1 h-px w-5 bg-line" />

      <RailButton label={magnet ? 'Magnet on (snap to OHLC)' : 'Magnet off'} active={magnet} onClick={onMagnetToggle}>
        <Magnet className="h-5 w-5" />
      </RailButton>
      <RailButton label={locked ? 'Drawings locked' : 'Lock drawings'} active={locked} onClick={onLockToggle}>
        {locked ? <Lock className="h-5 w-5" /> : <LockOpen className="h-5 w-5" />}
      </RailButton>
      <RailButton label={hidden ? 'Show drawings' : 'Hide drawings'} active={hidden} onClick={onHiddenToggle}>
        {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </RailButton>
      <RailButton label={`Clear all${count ? ` (${count})` : ''}`} onClick={onClear} disabled={count === 0} danger>
        <Trash2 className="h-5 w-5" />
      </RailButton>

      <div className="my-1 h-px w-5 bg-line" />

      <div className="flex flex-col items-center gap-1.5 py-0.5">
        {DRAWING_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            aria-label={`Color ${c}`}
            className={[
              'h-4 w-4 rounded-full border transition',
              color === c ? 'border-ink ring-1 ring-ink/40' : 'border-transparent hover:scale-110',
            ].join(' ')}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

function RailButton({
  children,
  label,
  active,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={[
        'focus-ring inline-flex h-8 w-8 items-center justify-center rounded transition disabled:opacity-30',
        active
          ? 'text-accent'
          : danger
            ? 'text-ink-faint hover:text-bear-bright'
            : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
