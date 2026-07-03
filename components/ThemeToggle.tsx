'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  THEMES,
  THEME_LABEL,
  THEME_META,
  getStoredTheme,
  setStoredTheme,
  applyTheme,
  type Theme,
} from '@/lib/theme';
import { useThemeName } from '@/lib/chartTheme';

// Theme picker: a swatch button that opens a menu previewing every MDS
// theme (canvas + accent chip) instead of blind-cycling. Selection
// applies via data-theme on <html> (outside React, hydration-safe) with
// a one-shot crossfade (html.theme-fade, see globals.css). Reduced
// motion disables the fade globally.

const FADE_MS = 320;

/** Dual-color preview: theme canvas disc with an accent dot. */
function Swatch({ theme, size = 14 }: { theme: Theme; size?: number }) {
  const meta = THEME_META[theme];
  return (
    <span
      aria-hidden
      className="relative inline-block shrink-0 rounded-full ring-1 ring-white/15"
      style={{ width: size, height: size, backgroundColor: meta.base }}
    >
      <span
        className="absolute rounded-full"
        style={{
          width: size * 0.45,
          height: size * 0.45,
          right: size * 0.08,
          bottom: size * 0.08,
          backgroundColor: meta.accent,
        }}
      />
    </span>
  );
}

export default function ThemeToggle({ className }: { className?: string }) {
  // Live view of <html data-theme> — stays correct even when the theme
  // is changed from another ThemeToggle instance or from script.
  const theme = useThemeName();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: apply the stored theme (covers pages without the FOUC
  // guard script; useThemeName picks the attribute change up).
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (next: Theme) => {
    // One-shot crossfade around the swap. The class is removed after the
    // transition window so it never taxes normal interactions.
    const el = document.documentElement;
    el.classList.add('theme-fade');
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => el.classList.remove('theme-fade'), FADE_MS);
    setStoredTheme(next); // persists + applies data-theme (observer updates the label)
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={['relative', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Theme: ${THEME_LABEL[theme]}`}
        title={`Theme: ${THEME_LABEL[theme]}`}
        className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink"
      >
        <Swatch theme={theme} />
        <span>{THEME_LABEL[theme]}</span>
        <ChevronDown
          aria-hidden
          className={[
            'h-3 w-3 text-ink-faint transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Theme"
          className="absolute right-0 top-full z-50 mt-1.5 w-[200px] overflow-hidden rounded-xl border border-line bg-surface-2 py-1 shadow-2xl"
        >
          {THEMES.map((t) => {
            const active = t === theme;
            return (
              <button
                key={t}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => select(t)}
                className={[
                  'focus-ring flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  active ? 'bg-surface-3' : 'hover:bg-surface-hover',
                ].join(' ')}
              >
                <Swatch theme={t} size={18} />
                <span className="min-w-0 flex-1">
                  <span
                    className={[
                      'block text-[12px] font-medium leading-tight',
                      active ? 'text-ink' : 'text-ink-muted',
                    ].join(' ')}
                  >
                    {THEME_LABEL[t]}
                  </span>
                  <span className="block text-[10px] leading-tight text-ink-faint">
                    {THEME_META[t].blurb}
                  </span>
                </span>
                {active && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
