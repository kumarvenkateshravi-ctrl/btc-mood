'use client';

import { CalendarDays, LoaderCircle, Pause, Play, X, SkipBack, SkipForward } from 'lucide-react';
import { cx } from '@/components/ui/util';

interface ReplayBarProps {
  selecting: boolean;
  playing: boolean;
  speed: number;
  onExit: () => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
  /** Start or restart replay from this UTC day. */
  onPickTime?: (ms: number) => void;
  /** Earliest selectable practice date for the active timeframe. */
  minPickMs?: number;
  /** Frozen timeframe used for replay fills. */
  executionTimeframe?: string;
  /** Date currently being loaded into the immutable replay snapshot. */
  loadingDate?: number | null;
  replayLoading?: string | null;
  onStep?: (direction: number) => void;
}

const SPEEDS = [0.1, 0.3, 0.5, 1, 3, 10];

/**
 * A deliberately small replay transport. Trading happens on the chart itself;
 * this strip only controls the historical tape.
 */
export default function ReplayBar({
  selecting,
  playing,
  speed,
  onExit,
  onTogglePlay,
  onSpeed,
  onPickTime,
  minPickMs,
  executionTimeframe,
  loadingDate = null,
  replayLoading,
  onStep,
}: ReplayBarProps) {
  const min = minPickMs ? new Date(minPickMs).toISOString().slice(0, 10) : undefined;
  const max = new Date().toISOString().slice(0, 10);
  const isLoading = loadingDate != null;

  return (
    <div data-testid="replay-controller" className="flex flex-wrap items-center gap-2" aria-busy={isLoading}>
      <label className={cx(
        'focus-within:ring-2 focus-within:ring-accent/40 inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition',
        isLoading ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-base text-ink-muted hover:border-line-strong hover:text-ink',
      )}>
        <CalendarDays className="h-3.5 w-3.5 text-accent" />
        <span>Select date</span>
        <input
          type="date"
          min={min}
          max={max}
          disabled={isLoading}
          onChange={(event) => {
            const [year, month, day] = event.target.value.split('-').map(Number);
            if (!year || !month || !day || !onPickTime) return;
            let timestamp = Date.UTC(year, month - 1, day);
            if (minPickMs != null && timestamp < minPickMs) timestamp = minPickMs;
            onPickTime(timestamp);
          }}
          aria-label="Select replay date"
          className="w-[118px] rounded-sm bg-transparent font-mono text-[11px] tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-wait disabled:text-ink-muted [color-scheme:dark]"
        />
      </label>

      <span className="h-5 w-px bg-line" aria-hidden="true" />
      {onStep && <button type="button" aria-label="Previous replay candle" disabled={selecting || isLoading} onClick={() => onStep(-1)} className="focus-ring inline-flex h-8 w-8 items-center justify-center text-ink-muted disabled:opacity-40"><SkipBack size={16} /></button>}

      <button
        type="button"
        onClick={onTogglePlay}
        disabled={selecting || isLoading}
        aria-label={playing ? 'Pause' : 'Play'}
        title={isLoading ? 'Loading selected date' : selecting ? 'Select a date first' : playing ? 'Pause replay' : 'Play replay'}
        className={cx(
          'focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-40',
          playing ? 'bg-accent text-white hover:bg-accent-bright' : 'border border-line bg-base text-ink-muted hover:border-accent/50 hover:text-ink',
        )}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      {onStep && <button type="button" aria-label="Next replay candle" disabled={selecting || isLoading} onClick={() => onStep(1)} className="focus-ring inline-flex h-8 w-8 items-center justify-center text-ink-muted disabled:opacity-40"><SkipForward size={16} /></button>}
      <label className="inline-flex h-8 items-center rounded-md border border-line bg-base px-2 text-[11px] text-ink-muted">
        <span className="mr-1.5">Speed</span>
        <select
          value={speed}
          disabled={isLoading}
          onChange={(event) => onSpeed(Number(event.target.value))}
          aria-label="Replay speed"
          className="cursor-pointer rounded-sm bg-transparent font-mono text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-wait disabled:text-ink-muted"
        >
          {SPEEDS.map((value) => <option key={value} value={value}>{value}x</option>)}
        </select>
      </label>

      <span className="inline-flex h-8 items-center rounded-md border border-line bg-base px-2 font-mono text-[11px] tabular-nums text-ink" title="Replay execution timeframe">
        {executionTimeframe ?? '—'}
      </span>

      <button
        type="button"
        onClick={onExit}
        aria-label="Exit replay"
        title="Exit replay"
        className="focus-ring ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-2 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>

      {isLoading && (
        <div role="status" aria-live="polite" className="basis-full inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] text-accent">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span>
            Loading {formatReplayDate(loadingDate!)} history
            {executionTimeframe ? ` at ${executionTimeframe}` : ''}…
          </span>
          {replayLoading && <span className="text-ink-muted">{replayLoading}</span>}
        </div>
      )}
    </div>
  );
}

function formatReplayDate(value: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
}
