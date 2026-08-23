'use client';

import type { ReactNode } from 'react';
import {
  Bookmark,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Dices,
  EyeOff,
  MousePointer2,
  Pause,
  Play,
  ShieldCheck,
  SkipBack,
  SkipForward,
  X,
  XCircle,
} from 'lucide-react';
import type { ReplayPhase } from '@/lib/replay/replayState';
import type { IntegrityReport } from '@/lib/replay/verify';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/util';

interface ReplayBarProps {
  /** True while the user is still picking the cut point (no controls yet). */
  selecting: boolean;
  playing: boolean;
  /** Machine phase, drives the status readout. */
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
  /** Earliest selectable practice date (unix ms) for the active timeframe. */
  minPickMs?: number;
  /** Non-null while deep history is backfilling for a far-back practice date. */
  deepLoading?: { tf: string; pages: number; oldestMs: number } | null;
  /** Blind drill: random hidden start + masked axis (selection mode). */
  onDrill?: () => void;
  /** Blind mode: hide progress numbers and the scrubber (no future spoilers). */
  blind?: boolean;
  onToggleBlind?: () => void;
  replayTime?: number | null;
  executionTimeframe?: string;
  visualTimeframe?: string;
  endOfData?: boolean;
  replayLoading?: string | null;
}

const PHASE_LABEL: Partial<Record<ReplayPhase, string>> = {
  ready: 'Ready',
  playing: 'Playing',
  paused: 'Paused',
  finished: 'Finished',
};

const SPEEDS = [0.1, 0.3, 0.5, 1, 3, 10];
const SHORTCUTS = ['Space play/pause', 'Left/Right step', 'Shift step 10', 'Home reset', 'Esc exit'];

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
  minPickMs,
  deepLoading,
  onDrill,
  blind = false,
  onToggleBlind,
  replayTime,
  executionTimeframe,
  visualTimeframe,
  endOfData = false,
  replayLoading,
}: ReplayBarProps) {
  if (selecting) {
    return (
      <div data-testid="replay-selector" className="elev-1 rounded-xl p-3">
        <ReplayHeader phase="selecting" blind={blind} onExit={onExit} />
        {deepLoading && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[11px] text-accent">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            Loading {deepLoading.tf} history, page {deepLoading.pages}, reached {formatReplayUtc(deepLoading.oldestMs)}
          </div>
        )}
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <StartChoice
            icon={<MousePointer2 className="h-4 w-4" />}
            title="Pick a candle"
            body="Click directly on the chart to choose the exact replay cut."
            active
          />
          {onPickTime && <DateStartChoice onPickTime={onPickTime} minPickMs={minPickMs} />}
          {onDrill && (
            <button
              type="button"
              onClick={onDrill}
              title="Blind drill: random hidden start, masked dates, then review the score"
              className="focus-ring rounded-lg border border-line bg-base p-3 text-left transition hover:border-line-strong hover:bg-surface-2"
            >
              <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                <Dices className="h-4 w-4 text-accent" />
                Blind drill
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-ink-faint">Random start, hidden dates, no progress spoilers.</span>
            </button>
          )}
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">Esc cancels selection. Replay hides future candles and keeps live funds untouched.</p>
      </div>
    );
  }

  const atEnd = index >= total - 1;
  const progress = total > 1 ? (Math.min(index, total - 1) / (total - 1)) * 100 : 0;

  return (
    <div data-testid="replay-controller" className="elev-1 rounded-xl p-3">
      <ReplayHeader phase={phase} blind={blind} onExit={onExit} replayTime={replayTime} executionTimeframe={executionTimeframe} visualTimeframe={visualTimeframe} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-base p-1">
          <IconBtn label="Previous bar" onClick={() => onStep(-1)} disabled={index <= 1}>
            <SkipBack className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn label={playing ? 'Pause' : 'Play'} onClick={onTogglePlay} disabled={atEnd} primary>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconBtn>
          <IconBtn label="Next bar" onClick={() => onStep(1)} disabled={atEnd}>
            <SkipForward className="h-3.5 w-3.5" />
          </IconBtn>
        </div>

        {blind ? (
          <div className="flex min-w-[180px] flex-1 items-center justify-center rounded-lg border border-line bg-base px-3 py-2 text-[11px] uppercase tracking-wider text-ink-faint">
            Future hidden. Trade the tape in front of you.
          </div>
        ) : (
          <>
            <input
              type="range"
              min={1}
              max={Math.max(1, total - 1)}
              value={Math.min(index, total - 1)}
              onChange={(e) => onScrub(Number(e.target.value))}
              className="h-1 min-w-[160px] flex-1 cursor-pointer accent-accent"
              aria-label="Replay position"
            />
            <span className="min-w-[116px] text-right font-mono text-[11px] tabular-nums text-ink-faint">
              {Math.min(index, total - 1)}/{total - 1}
              <span className="text-ink-faint/70"> - {progress.toFixed(1)}%</span>
            </span>
          </>
        )}

        {onToggleBlind && (
          <button
            onClick={onToggleBlind}
            aria-pressed={blind}
            title={blind ? 'Reveal position and dates' : 'Blind mode: hide progress and dates'}
            className={cx(
              'focus-ring inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition',
              blind ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-ink-faint hover:bg-surface-2 hover:text-ink',
            )}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Blind
          </button>
        )}

        <div className="inline-flex items-center rounded-md border border-line bg-base p-0.5 text-[11px] font-mono" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => onSpeed(s)}
              aria-pressed={speed === s}
              className={cx('focus-ring min-h-11 min-w-9 rounded px-1.5 py-0.5 transition sm:min-h-0 sm:min-w-0', speed === s ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:text-ink')}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {replayLoading && (
        <div role="status" className="mt-2 inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          {replayLoading}
        </div>
      )}
      {(endOfData || atEnd) && (
        <div role="status" className="mt-2 rounded-md border border-line bg-base px-2.5 py-1.5 text-[11px] text-ink-muted">
          End of replay data
        </div>
      )}
      {!endOfData && index <= 1 && (
        <div role="status" className="mt-2 rounded-md border border-line bg-base px-2.5 py-1.5 text-[11px] text-ink-faint">
          Beginning of replay data
        </div>
      )}
      <div className="mt-2 hidden flex-wrap items-center gap-2 border-t border-line pt-2 sm:flex">
        {SHORTCUTS.map((shortcut) => (
          <span key={shortcut} className="rounded bg-base px-1.5 py-0.5 text-[10px] text-ink-faint">{shortcut}</span>
        ))}
      </div>

      <details className="mt-2 border-t border-line pt-2">
        <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-1 text-[11px] font-medium text-ink-muted transition hover:text-ink">
          <ChevronDown className="h-3.5 w-3.5" />
          Bookmarks and integrity
        </summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" icon={<Bookmark className="h-3.5 w-3.5" />} onClick={onBookmark}>
              Save bar
            </Button>
            {onVerify && (
              <Button size="sm" variant="outline" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={onVerify} title="Verify replay integrity">
                Verify
              </Button>
            )}
            {bookmarks.length === 0 && <span className="text-[11px] text-ink-faint">No saved bars yet.</span>}
            {bookmarks.map((b) => (
              <span
                key={b}
                className={cx(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums',
                  b === index ? 'border-accent/50 text-ink' : 'border-line text-ink-muted',
                )}
              >
                <button onClick={() => onJumpBookmark(b)} className="transition hover:text-ink" title={`Jump to bar ${b}`}>
                  Bar {b}
                </button>
                <button onClick={() => onRemoveBookmark(b)} aria-label={`Remove bookmark ${b}`} className="text-ink-faint transition hover:text-bear-bright">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          {verification && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-base p-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Replay integrity</span>
              {verification.checks.map((c) => (
                <span
                  key={c.name}
                  title={c.detail}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                    c.ok ? 'border-bull/30 text-bull-bright' : 'border-bear/40 text-bear-bright',
                  )}
                >
                  {c.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {c.name}
                </span>
              ))}
              <span className={cx('ml-auto font-mono text-[12px] font-semibold tabular-nums', verification.integrity === 100 ? 'text-bull-bright' : 'text-bear-bright')}>
                {verification.integrity}%
              </span>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function ReplayHeader({
  phase,
  blind,
  onExit,
  replayTime,
  executionTimeframe,
  visualTimeframe,
}: {
  phase?: ReplayPhase;
  blind?: boolean;
  onExit: () => void;
  replayTime?: number | null;
  executionTimeframe?: string;
  visualTimeframe?: string;
}) {
  const current = phase === 'selecting' ? 1 : phase === 'finished' ? 3 : 2;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-[180px] flex-col">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">REPLAY</span>
          <Badge tone="accent">Snapshot data</Badge>
          {blind && <Badge tone="warn">Blind</Badge>}
        </div>
        <span className="mt-1 text-[11px] text-ink-faint">Simulated execution · live paper account untouched</span>
      </div>
      <div className="hidden flex-1 items-center gap-1.5 sm:flex">
        <Step n={1} label="Setup" active={current === 1} done={current > 1} />
        <Rail />
        <Step n={2} label={PHASE_LABEL[phase ?? 'ready'] ?? 'Replay'} active={current === 2} done={current > 2} />
        <Rail />
        <Step n={3} label="Review" active={current === 3} />
      </div>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2 text-[11px] text-ink-faint">
        {replayTime != null && <span className="font-mono tabular-nums text-ink" title="Replay time in UTC">{formatReplayUtc(replayTime)}</span>}
        {executionTimeframe && <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-accent">Exec {executionTimeframe}</span>}
        {visualTimeframe && executionTimeframe && visualTimeframe !== executionTimeframe && (
          <span className="rounded border border-line bg-base px-1.5 py-0.5">Viewing: {visualTimeframe}</span>
        )}
      </div>
      <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={onExit}>
        Exit Replay
      </Button>
    </div>
  );
}

function formatReplayUtc(value: number): string {
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(new Date(ms)).replace(',', ' ·') + ' UTC';
}
function Step({ n, label, active, done }: { n: number; label: string; active?: boolean; done?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]', active ? 'bg-accent/15 text-accent' : done ? 'text-ink-muted' : 'text-ink-faint')}>
      <span className={cx('flex h-4 w-4 items-center justify-center rounded-full border text-[9px]', active ? 'border-accent' : done ? 'border-bull/50 text-bull-bright' : 'border-line')}>
        {done ? <CheckCircle2 className="h-3 w-3" /> : n}
      </span>
      {label}
    </span>
  );
}

function Rail() {
  return <span className="h-px min-w-4 flex-1 bg-line" />;
}

function StartChoice({ icon, title, body, active }: { icon: ReactNode; title: string; body: string; active?: boolean }) {
  return (
    <div className={cx('rounded-lg border p-3', active ? 'border-accent/40 bg-accent/10' : 'border-line bg-base')}>
      <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
        <span className={active ? 'text-accent' : 'text-ink-muted'}>{icon}</span>
        {title}
      </span>
      <span className="mt-1 block text-[11px] leading-snug text-ink-faint">{body}</span>
    </div>
  );
}

function DateStartChoice({ onPickTime, minPickMs }: { onPickTime: (ms: number) => void; minPickMs?: number }) {
  const minStr = minPickMs ? new Date(minPickMs).toISOString().slice(0, 10) : undefined;
  const maxStr = new Date().toISOString().slice(0, 10);
  return (
    <label className="rounded-lg border border-line bg-base p-3 transition focus-within:ring-2 focus-within:ring-accent/40 hover:border-line-strong hover:bg-surface-2">
      <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
        <CalendarDays className="h-4 w-4 text-accent" />
        Jump to date
      </span>
      <span className="mt-1 block text-[11px] leading-snug text-ink-faint">
        {minPickMs
          ? `History on this timeframe: ${new Date(minPickMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} → today.`
          : 'Start from a specific day open.'}
      </span>
      <input
        type="date"
        min={minStr}
        max={maxStr}
        onChange={(e) => {
          const [y, m, d] = e.target.value.split('-').map(Number);
          if (!y || !m || !d) return;
          let ms = Date.UTC(y, m - 1, d);
          if (!Number.isFinite(ms)) return;
          // Browsers show min/max but still allow typing out-of-range dates —
          // clamp so a too-early pick starts at the earliest available day.
          if (minPickMs != null && ms < minPickMs) ms = minPickMs;
          onPickTime(ms);
        }}
        className="input-field mt-2 h-8 w-full rounded-md border border-line bg-surface-1 px-2 text-[12px] text-ink [color-scheme:dark]"
        aria-label="Jump to date, replay starts at the day open"
      />
    </label>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
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
      className={cx(
        'focus-ring inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-md transition disabled:opacity-30 sm:h-8 sm:w-8',
        primary ? 'bg-accent text-white hover:bg-accent-bright' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
