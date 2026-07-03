// MDS theming. Obsidian Indigo is the :root default (no attribute);
// CryptoVision is an alternate that overrides the SEMANTIC token layer via a
// `data-theme` attribute on <html> (see app/globals.css). Persisted per-browser.

export const THEMES = ['obsidian', 'cryptovision', 'cobalt', 'bitcoin', 'material', 'lorento'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'obsidian';
export const THEME_KEY = 'mcs:theme';

export const THEME_LABEL: Record<Theme, string> = {
  obsidian: 'Obsidian',
  cryptovision: 'CryptoVision',
  cobalt: 'Cobalt',
  bitcoin: 'Bitcoin',
  material: 'Material Dark',
  lorento: 'Lorento',
};

/** Static preview colors + one-line identity for the theme picker.
 *  These are previews of each theme's tokens, not live tokens (a theme's
 *  own variables are only defined while it is active). */
export const THEME_META: Record<
  Theme,
  { base: string; surface: string; accent: string; blurb: string }
> = {
  obsidian: {
    base: '#12141c',
    surface: '#1b1e29',
    accent: '#6d5ef0',
    blurb: 'Indigo pro-terminal',
  },
  cryptovision: {
    base: '#141416',
    surface: '#1e1e21',
    accent: '#b7a8f5',
    blurb: 'Charcoal + lavender',
  },
  cobalt: {
    base: '#1a2233',
    surface: '#242f45',
    accent: '#3e6ef5',
    blurb: 'Navy + royal blue',
  },
  bitcoin: {
    base: '#151209',
    surface: '#201b10',
    accent: '#f0b90b',
    blurb: 'Warm black + gold',
  },
  material: {
    base: '#1E1E1E',
    surface: '#121212',
    accent: '#BB86FC',
    blurb: 'Pure Android material dark. Deep blacks, vivid purple and teal accents.',
  },
  lorento: {
    base: '#111317',
    surface: '#1A1C20',
    accent: '#675AFF',
    blurb: 'Soft rounded cards, deep slate background, vibrant violet gradient accents.',
  },
};

export function isTheme(v: string | null): v is Theme {
  return v != null && (THEMES as readonly string[]).includes(v);
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    return isTheme(t) ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** The next theme in the cycle (wraps around). */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

/** Apply a theme to the document. Obsidian = default (no attribute). */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (theme === DEFAULT_THEME) el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', theme);
}

export function setStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode / storage disabled — still apply for the session */
  }
  applyTheme(theme);
}
