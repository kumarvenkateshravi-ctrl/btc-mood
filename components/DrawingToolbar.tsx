'use client';

import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Minus,
  MousePointer2,
  MoveUpRight,
  Redo2,
  Ruler,
  Square,
  Trash2,
  TrendingUp,
  Type,
  Undo2,
  X,
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
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selected: boolean;
  onDeleteSelected: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  scopeLabel: string;
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
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  selected,
  onDeleteSelected,
  mobileOpen,
  onMobileClose,
  scopeLabel,
}: DrawingToolbarProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  useEffect(() => {
    if (!mobileOpen && !confirmingClear) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmingClear) setConfirmingClear(false);
      else onMobileClose();
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmingClear, mobileOpen, onMobileClose]);
  const clearLabel = `Clear drawings for ${scopeLabel}`;
  const selectTool = (next: Tool) => {
    onToolChange(next);
    onMobileClose();
  };
  const requestClear = () => {
    if (count > 0) setConfirmingClear(true);
  };
  const confirmClear = () => {
    onClear();
    setConfirmingClear(false);
    onMobileClose();
  };

  return (
    <>
      <div data-testid="drawing-rail" className="hidden w-10 shrink-0 flex-col items-center gap-1 border-r border-line bg-base py-2 sm:flex">
        {TOOLS.map((t) => (
          <RailButton key={t.tool} label={t.label} active={tool === t.tool} onClick={() => onToolChange(t.tool)}>
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
        <RailButton label="Undo drawing" onClick={onUndo} disabled={!canUndo}>
          <Undo2 className="h-5 w-5" />
        </RailButton>
        <RailButton label="Redo drawing" onClick={onRedo} disabled={!canRedo}>
          <Redo2 className="h-5 w-5" />
        </RailButton>
        <RailButton label="Delete selected drawing" onClick={onDeleteSelected} disabled={!selected || locked} danger>
          <Trash2 className="h-5 w-5" />
        </RailButton>
        <RailButton label={clearLabel} onClick={requestClear} disabled={count === 0} danger>
          <Trash2 className="h-5 w-5" />
        </RailButton>

        <div className="my-1 h-px w-5 bg-line" />

        <div className="flex flex-col items-center gap-1.5 py-0.5" aria-label="Drawing colors">
          {DRAWING_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColorChange(c)}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              className={[
                'h-4 w-4 rounded-full border transition',
                color === c ? 'border-ink ring-1 ring-ink/40' : 'border-transparent hover:scale-110',
              ].join(' ')}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[90] flex items-end bg-base/65 px-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-16 sm:hidden" role="dialog" aria-modal="true" aria-label="Drawing tools">
          <button type="button" aria-label="Close drawing tools" className="absolute inset-0 cursor-default" onClick={onMobileClose} />
          <div className="relative z-10 w-full rounded-xl border border-line-strong bg-surface-1 p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <div>
                <span className="text-xs font-semibold text-ink">Draw</span>
                <span className="ml-2 text-[10px] text-ink-faint">{scopeLabel}</span>
              </div>
              <button type="button" onClick={onMobileClose} className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2" aria-label="Close drawing tools"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Drawing tools">
              {TOOLS.map((t) => (
                <button key={t.tool} type="button" onClick={() => selectTool(t.tool)} aria-pressed={tool === t.tool} className={[
                  'focus-ring flex min-h-11 flex-col items-center justify-center gap-1 rounded-md border text-[10px] font-medium',
                  tool === t.tool ? 'border-accent/60 bg-accent/15 text-ink' : 'border-line bg-surface-2 text-ink-muted hover:text-ink',
                ].join(' ')}>
                  {t.icon}
                  <span>{t.tool === 'cursor' ? 'Select' : t.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" onClick={onMagnetToggle} aria-pressed={magnet} className="focus-ring min-h-11 rounded-md border border-line bg-surface-2 px-1 text-[10px] font-semibold text-ink-muted">{magnet ? 'Magnet on' : 'Magnet'}</button>
              <button type="button" onClick={onLockToggle} aria-pressed={locked} className="focus-ring min-h-11 rounded-md border border-line bg-surface-2 px-1 text-[10px] font-semibold text-ink-muted">{locked ? 'Unlock' : 'Lock'}</button>
              <button type="button" onClick={onHiddenToggle} aria-pressed={hidden} className="focus-ring min-h-11 rounded-md border border-line bg-surface-2 px-1 text-[10px] font-semibold text-ink-muted">{hidden ? 'Show' : 'Hide'}</button>
            </div>
            <div className="mt-2 flex items-center gap-2 px-1" aria-label="Drawing colors">
              {DRAWING_COLORS.map((c) => <button key={c} type="button" onClick={() => onColorChange(c)} aria-label={`Color ${c}`} aria-pressed={color === c} className={['h-5 w-5 rounded-full border', color === c ? 'border-ink ring-1 ring-ink' : 'border-transparent'].join(' ')} style={{ background: c }} />)}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={onUndo} disabled={!canUndo} className="focus-ring min-h-11 rounded-md border border-line bg-surface-2 text-xs font-semibold text-ink-muted disabled:opacity-40"><Undo2 className="mr-1 inline h-4 w-4" />Undo</button>
              <button type="button" onClick={onRedo} disabled={!canRedo} className="focus-ring min-h-11 rounded-md border border-line bg-surface-2 text-xs font-semibold text-ink-muted disabled:opacity-40"><Redo2 className="mr-1 inline h-4 w-4" />Redo</button>
              <button type="button" onClick={onDeleteSelected} disabled={!selected || locked} className="focus-ring min-h-11 rounded-md border border-line bg-surface-2 text-xs font-semibold text-ink-muted disabled:opacity-40"><Trash2 className="mr-1 inline h-4 w-4" />Delete selected</button>
              <button type="button" onClick={requestClear} disabled={count === 0} className="focus-ring min-h-11 rounded-md border border-bear/40 bg-bear/10 text-xs font-semibold text-bear-bright disabled:opacity-40">Clear drawings</button>
            </div>
          </div>
        </div>
      )}

      {confirmingClear && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-base/70 px-4" role="dialog" aria-modal="true" aria-label={clearLabel}>
          <div className="w-full max-w-sm rounded-xl border border-line-strong bg-surface-1 p-4 shadow-2xl">
            <h2 className="text-sm font-semibold text-ink">Clear all drawings for {scopeLabel}?</h2>
            <p className="mt-1 text-xs text-ink-muted">This removes the saved drawings for this symbol only.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmingClear(false)} className="focus-ring min-h-11 rounded-md border border-line px-3 text-xs font-semibold text-ink-muted">Cancel</button>
              <button type="button" onClick={confirmClear} className="focus-ring min-h-11 rounded-md bg-bear px-3 text-xs font-bold text-base">Clear Drawings</button>
            </div>
          </div>
        </div>
      )}
    </>
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
      type="button"
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