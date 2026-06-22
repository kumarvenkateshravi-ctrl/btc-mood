'use client';

import { Bookmark, Pause, Play, Scissors, SkipBack, SkipForward, X } from 'lucide-react';

interface ReplayBarProps {
  /** True while the user is still picking the cut point (no controls yet). */
  selecting: boolean;
  playing: boolean;
  index: number;
  total: number;
  speed: number;
  bookmarks: number[];
  onExit: () => void;
  onTogglePlay: () => void;
  onStep: (dir: 1 | -1) => void;
  onScrub: (index: number) => void;
  onSpeed: (speed: number) => void;
  onBookmark: () => void;
  onJumpBookmark: (index: number) => void;
  onRemoveBookmark: (index: number) => void;
}

const SPEEDS = [0.1, 0.3, 0.5, 1, 3, 10];

export default function ReplayBar({
  selecting,
  playing,
  index,
  total,
  speed,
  bookmarks,
  onExit,
  onTogglePlay,
  onStep,
  onScrub,
  onSpeed,
  onBookmark,
  onJumpBookmark,
  onRemoveBookmark,
}: ReplayBarProps) {
  if (selecting) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-surface-1 px-3 py-2 text-xs">
        <Scissors className="h-3.5 w-3.5 text-accent" />
        <span className="text-ink-muted">Click a candle on the chart to set the replay start.</span>
        <button
          onClick={onExit}
          className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-ink-faint transition hover:bg-surface-2 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    );
  }

  const atEnd = index >= total - 1;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-surface-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Replay</span>

        <div className="flex items-center gap-1">
          <IconBtn label="Step back" onClick={() => onStep(-1)} disabled={index <= 1}>
            <SkipBack className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn label={playing ? 'Pause' : 'Play'} onClick={onTogglePlay} disabled={atEnd} primary>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconBtn>
          <IconBtn label="Step forward" onClick={() => onStep(1)} disabled={atEnd}>
            <SkipForward className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn label="Bookmark this bar" onClick={onBookmark}>
            <Bookmark className="h-3.5 w-3.5" />
          </IconBtn>
        </div>

        <input
          type="range"
          min={1}
          max={Math.max(1, total - 1)}
          value={Math.min(index, total - 1)}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="h-1 flex-1 min-w-[120px] cursor-pointer accent-accent"
          aria-label="Replay position"
        />

        <span className="font-mono text-[11px] tabular-nums text-ink-faint">
          {Math.min(index, total - 1)}/{total - 1}
        </span>

        <div className="inline-flex items-center rounded-md border border-line bg-base p-0.5 text-[11px] font-mono">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => onSpeed(s)}
              aria-pressed={speed === s}
              className={[
                'rounded px-1.5 py-0.5 transition focus-ring',
                speed === s ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:text-ink',
              ].join(' ')}
            >
              {s}×
            </button>
          ))}
        </div>

        <button
          onClick={onExit}
          className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-faint transition hover:bg-surface-2 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
          Exit
        </button>
      </div>

      {bookmarks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Bookmarks</span>
          {bookmarks.map((b) => (
            <span
              key={b}
              className={[
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums',
                b === index ? 'border-accent/50 text-ink' : 'border-line text-ink-muted',
              ].join(' ')}
            >
              <button onClick={() => onJumpBookmark(b)} className="transition hover:text-ink" title={`Jump to bar ${b}`}>
                ▸ {b}
              </button>
              <button
                onClick={() => onRemoveBookmark(b)}
                aria-label={`Remove bookmark ${b}`}
                className="text-ink-faint transition hover:text-bear-bright"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={[
        'focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:opacity-30',
        primary ? 'bg-accent/15 text-ink hover:bg-accent/25' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
