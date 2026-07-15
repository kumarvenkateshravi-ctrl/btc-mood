'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Plus, RotateCcw } from 'lucide-react';
import type { ChartSettingsState } from './useChartSettings';
import type { PriceScaleModeOption } from './types';
import { CHART_SETTINGS_SHORTCUTS } from './chartSettingsKeys';

export interface ChartSettingsPopoverProps {
  open: boolean;
  onClose: () => void;
  settings: ChartSettingsState;
  onPatch: (p: Partial<ChartSettingsState>) => void;
  onReset: () => void;
  /** Anchor element — we return focus here on close. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** "Fit content" handler — also wired to the "Auto" item. */
  onFitContent?: () => void;
  align?: 'left' | 'right';
}

const SCALE_MODES: ReadonlyArray<{ value: PriceScaleModeOption; label: string; disabled?: boolean; title?: string }> = [
  { value: 'normal', label: 'Regular' },
  { value: 'percent', label: 'Percent' },
  { value: 'log', label: 'Logarithmic' },
];

const POPOVER_WIDTH = 280;

/**
 * TV-style chart settings popover. Five groups: Scale, Mode, Axis, Display,
 * Reset. Two legacy rows ("Plus button", "More settings…") render disabled
 * with a `title` tooltip explaining v1 scope.
 */
export function ChartSettingsPopover({
  open,
  onClose,
  settings,
  onPatch,
  onReset,
  anchorRef,
  onFitContent,
  align = 'right',
}: ChartSettingsPopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  // Outside click + Escape close. Mousedown on the anchor button is ignored
  // — its own click handler toggles the popover, and closing here first
  // would make that toggle reopen it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef?.current?.contains(t)) return;
      if (containerRef.current && !containerRef.current.contains(t)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  // First-item focus on open, focus return on close. `wasOpen` guards the
  // return branch so mounting with open=false doesn't steal focus.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      // Defer to next tick so the popover has mounted.
      const id = requestAnimationFrame(() => {
        firstItemRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      anchorRef?.current?.focus();
    }
  }, [open, anchorRef]);

  if (!open) return null;

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      ref={containerRef}
      id="chart-settings-popover"
      role="menu"
      aria-label="Chart settings"
      className={[
        'absolute top-full z-40 mt-1 rounded-md border border-line-strong bg-surface-1 shadow-2xl',
        reduceMotion ? '' : 'settingsPopoverIn',
        align === 'right' ? 'right-0' : 'left-0',
      ].join(' ')}
      style={{ width: POPOVER_WIDTH, animation: reduceMotion ? undefined : 'settingsPopoverIn 160ms ease-out' }}
    >
      <div className="px-3 py-2 border-b border-line">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Chart Settings
        </span>
      </div>

      <Group label="Scale">
        <Item
          ref={firstItemRef}
          label="Auto (fit data)"
          shortcut={CHART_SETTINGS_SHORTCUTS.reset.label}
          onClick={() => {
            onPatch({ autoScale: true });
            onFitContent?.();
          }}
        />
        <ToggleRow
          label="Lock price to bar ratio"
          tooltip="Approximate — keeps price scale auto-sized to visible bars. Lightweight-charts does not expose a true ratio."
          active={settings.lockPriceToBarRatio}
          onToggle={() =>
            onPatch({ lockPriceToBarRatio: !settings.lockPriceToBarRatio })
          }
        >
          <NumberStepper
            value={settings.lockPriceToBarRatioValue}
            onChange={(n) => onPatch({ lockPriceToBarRatioValue: n })}
            min={0.1}
            max={100}
            step={0.1}
          />
        </ToggleRow>
        <Item
          label="Scale price chart only"
          onClick={() =>
            onPatch({ scalePriceChartOnly: !settings.scalePriceChartOnly })
          }
          active={settings.scalePriceChartOnly}
        />
        <Item
          label="Invert scale"
          shortcut={CHART_SETTINGS_SHORTCUTS.invert.label}
          onClick={() => onPatch({ invertScale: !settings.invertScale })}
          active={settings.invertScale}
        />
      </Group>

      <Group label="Mode">
        {SCALE_MODES.map((m) => (
          <Item
            key={m.value}
            label={m.label}
            shortcut={m.value === 'log' ? CHART_SETTINGS_SHORTCUTS.log.label : undefined}
            radio
            active={settings.scaleMode === m.value}
            onClick={() => onPatch({ scaleMode: m.value })}
            disabled={m.disabled}
            title={m.title}
          />
        ))}
        <Item
          label="Indexed to 100"
          radio
          active={false}
          disabled
          title="Not supported by lightweight-charts"
        />
      </Group>

      <Group label="Axis">
        <Item
          label="Move scale to left"
          active={settings.activePriceScaleId === 'left'}
          onClick={() =>
            onPatch({
              activePriceScaleId:
                settings.activePriceScaleId === 'left' ? 'right' : 'left',
            })
          }
        />
        <Item
          label="Labels: status line"
          active={settings.labelsStatusLine}
          onClick={() =>
            onPatch({ labelsStatusLine: !settings.labelsStatusLine })
          }
        />
        <Item
          label="Lines: status line"
          active={settings.labelsStatusLine}
          disabled
          title="Tied to Labels: status line"
        />
      </Group>

      <Group label="Display">
        <Item
          label="Crosshair snap"
          active={settings.showCrosshairSnap}
          onClick={() =>
            onPatch({ showCrosshairSnap: !settings.showCrosshairSnap })
          }
        />
        <Item
          label="Show countdown"
          active={settings.showCountdown}
          onClick={() =>
            onPatch({ showCountdown: !settings.showCountdown })
          }
        />
      </Group>

      <Group label="Reset">
        <Item
          label="Reset price scale"
          shortcut={CHART_SETTINGS_SHORTCUTS.reset.label}
          destructive
          onClick={() => {
            onReset();
            onFitContent?.();
          }}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
        />
      </Group>

      <div className="border-t border-line px-3 py-1.5">
        <button
          type="button"
          disabled
          title="Coming soon"
          className="block w-full text-left text-[13px] font-medium text-ink-faint/60 cursor-not-allowed"
        >
          Plus button
        </button>
        <button
          type="button"
          disabled
          title="Coming soon — see Chart Settings dialog"
          className="block w-full text-left text-[13px] font-medium text-ink-faint/60 cursor-not-allowed"
        >
          More settings…
        </button>
      </div>
    </div>
  );
}

/** Group header + container. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line/60 last:border-b-0">
      <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      <ul className="px-1 pb-1">{children}</ul>
    </div>
  );
}

/** Single menu row. */
function Item({
  label,
  shortcut,
  active,
  radio,
  destructive,
  disabled,
  onClick,
  title,
  icon,
  ref: forwardedRef,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  radio?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  icon?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <li>
      <button
        ref={forwardedRef}
        type="button"
        role="menuitemcheckbox"
        aria-checked={radio ? (active ?? false) : undefined}
        disabled={disabled}
        title={title}
        onClick={disabled ? undefined : onClick}
        className={[
          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] font-medium transition-colors',
          disabled
            ? 'cursor-not-allowed text-ink-faint/60'
            : active
              ? 'bg-accent/15 text-ink'
              : destructive
                ? 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        ].join(' ')}
      >
        {icon && <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span>}
        <span className="flex-1 truncate">{label}</span>
        {active && !disabled && <Check className="h-3.5 w-3.5 text-accent" />}
        {shortcut && !disabled && (
          <span className="text-[11px] font-mono text-ink-faint">{shortcut}</span>
        )}
      </button>
    </li>
  );
}

/** Toggle row with optional inline children (e.g. a number stepper). */
function ToggleRow({
  label,
  tooltip,
  active,
  onToggle,
  children,
}: {
  label: string;
  tooltip?: string;
  active: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <div
        title={tooltip}
        className={[
          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] font-medium transition-colors',
          active ? 'bg-accent/15 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        ].join(' ')}
      >
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={active}
          onClick={onToggle}
          className="flex-1 text-left"
        >
          {label}
        </button>
        {active && <Check className="h-3.5 w-3.5 text-accent" />}
        {children}
      </div>
    </li>
  );
}

/** Tiny inline ± stepper for the cosmetic "ratio" value. */
function NumberStepper({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  // Reset draft when value changes externally.
  useEffect(() => {
    if (!editing) setDraft(value.toFixed(2));
  }, [value, editing]);

  const dec = () => onChange(Math.max(min, +(value - step).toFixed(4)));
  const inc = () => onChange(Math.min(max, +(value + step).toFixed(4)));

  return (
    <div className="flex items-center gap-1 ml-1">
      <button
        type="button"
        aria-label="Decrease"
        onClick={dec}
        className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded text-ink-faint hover:bg-surface-3 hover:text-ink"
      >
        <Minus className="h-3 w-3" />
      </button>
      {editing ? (
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = parseFloat(draft);
            if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-14 bg-surface-3 border border-line rounded px-1 py-0.5 text-[11px] font-mono tabular-nums text-ink"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(value.toFixed(2));
            setEditing(true);
          }}
          className="min-w-[3rem] rounded px-1 py-0.5 text-[11px] font-mono tabular-nums text-ink-faint hover:text-ink"
          aria-label="Edit value"
        >
          {value.toFixed(2)}
        </button>
      )}
      <button
        type="button"
        aria-label="Increase"
        onClick={inc}
        className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded text-ink-faint hover:bg-surface-3 hover:text-ink"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
