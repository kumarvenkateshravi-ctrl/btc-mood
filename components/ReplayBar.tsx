'use client';

import { Bookmark, CheckCircle2, Dices, EyeOff, Pause, Play, Scissors, ShieldCheck, SkipBack, SkipForward, X, XCircle } from 'lucide-react';
import type { ReplayPhase } from '@/lib/replay/replayState';
import type { IntegrityReport } from '@/lib/replay/verify';

interface ReplayBarProps {
  /** True while the user is still picking the cut point (no controls yet). */
  selecting: boolean;
  playing: boolean;
  /** Machine phase — drives the status readout. */
  phase?: ReplayPhase;
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
  /** Replay Verification (developer mode). */
  onVerify?: () => void;
  verification?: IntegrityReport | null;
  /** Jump-to-datetime replay start (selection mode). Epoch ms, local input. */
  onPickTime?: (ms: number) => void;
  /** Non-null while deep history is backfilling for a far-back practice date. */
  deepLoading?: { tf: string; pages: number; oldestMs: number } | null;
  /** Blind drill: random hidden start + masked axis (selection mode). */
  onDrill?: () => void;
  /** Blind mode: hide progress numbers and the scrubber (no future spoilers). */
  blind?: boolean;
  onToggleBlind?: () => void;
}

const PHASE_LABEL: Partial<Record<ReplayPhase, string>> = {
  ready: 'Ready',
  playing: 'Playing',
  paused: 'Paused',
  finished: 'Finished',
};

const SPEEDS = [0.1, 0.3, 0.5, 1, 3, 10];

export default function ReplayBar({
  selecting,
  playing,
  phase,
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
  onVerify,
  verification,
  onPickTime,
  deepLoading,
  onDrill,
  blind = false,
  onToggleBlind,
}: ReplayBarProps) {
  if (selecting) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-surface-1 px-3 py-2 text-xs">
        <Scissors className="h-3.5 w-3.5 text-accent" />
        <span className="text-ink-muted">Click a candle on the chart to set the replay start.</span>
        {deepLoading && (
          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-accent">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            Loading {deepLoading.tf} history… page {deepLoading.pages} · reached{' '}
            {new Date(deepLoading.oldestMs).toLocaleDateString()}
          </span>
        )}
        {onPickTime && (
          <label className="inline-flex items-center gap-1.5 text-ink-faint">
            or jump to
            <input
              type="date"
              onChange={(e) => {
                // Jump to the DAY OPEN of the picked date. Crypto's trading
                // day opens at 00:00 UTC — one instant worldwide, shown in
                // each user's local wall-clock by the chart (05:30 in
                // India, 01:00 in Berlin, ...). Date.UTC keeps the pick
                // timezone-proof; parsing via new Date(value) would drift
                // by the browser's offset in some engines.
                const [y, m, d] = e.target.value.split('-').map(Number);
                if (!y || !m || !d) return;
                const ms = Date.UTC(y, m - 1, d);
                if (Number.isFinite(ms)) onPickTime(ms);
              }}
              className="focus-ring rounded border border-line bg-base px-1.5 py-0.5 text-[11px] text-ink [color-scheme:dark]"
              aria-label="Jump to date (replay starts at the day open)"
            />
          </label>
        )}
        {onDrill && (
          <button
            onClick={onDrill}
            title="Blind drill: random hidden start, masked dates — trade it, then reveal your score"
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-ink-muted transition hover:bg-surface-2 hover:text-ink"
          >
            <Dices className="h-3.5 w-3.5" />
            Blind drill
          </button>
        )}
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

        {blind ? (
          // Future-blind: no scrubber, no counts — the trader genuinely
          // doesn't know how much history remains.
          <span className="flex-1 text-center font-mono text-[11px] uppercase tracking-wider text-ink-faint">
            {phase && PHASE_LABEL[phase] ? `${PHASE_LABEL[phase]} · ` : ''}blind drill
          </span>
        ) : (
          <>
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
              {phase && PHASE_LABEL[phase] && <span className="text-ink-muted">{PHASE_LABEL[phase]} · </span>}
              {Math.min(index, total - 1)}/{total - 1}
              <span className="text-ink-faint/70"> · {(total > 1 ? (Math.min(index, total - 1) / (total - 1)) * 100 : 0).toFixed(1)}%</span>
            </span>
          </>
        )}

        {onToggleBlind && (
          <button
            onClick={onToggleBlind}
            aria-pressed={blind}
            title={blind ? 'Reveal position and dates' : 'Blind mode: hide progress and dates'}
            className={[
              'focus-ring inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition',
              blind ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-ink-faint hover:bg-surface-2 hover:text-ink',
            ].join(' ')}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Blind
          </button>
        )}

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

        {onVerify && (
          <button
            onClick={onVerify}
            title="Verify replay integrity (developer)"
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-faint transition hover:bg-surface-2 hover:text-ink"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Verify
          </button>
        )}

        <button
          onClick={onExit}
          className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-faint transition hover:bg-surface-2 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
          Exit
        </button>
      </div>

      {verification && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Replay Verification</span>
          {verification.checks.map((c) => (
            <span
              key={c.name}
              title={c.detail}
              className={[
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                c.ok ? 'border-bull/30 text-bull-bright' : 'border-bear/40 text-bear-bright',
              ].join(' ')}
            >
              {c.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {c.name}
            </span>
          ))}
          <span
            className={[
              'ml-auto font-mono text-[12px] font-semibold tabular-nums',
              verification.integrity === 100 ? 'text-bull-bright' : 'text-bear-bright',
            ].join(' ')}
          >
            Integrity {verification.integrity}%
          </span>
        </div>
      )}

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
