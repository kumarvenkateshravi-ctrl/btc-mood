// MDS Phase C — shared primitive helpers. Tokens only; no hardcoded color.

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export type Tone = 'bull' | 'bear' | 'warn' | 'info' | 'accent' | 'gold' | 'neutral' | 'muted';

/** Semantic Tailwind text class per tone. */
export const toneText: Record<Tone, string> = {
  bull: 'text-bull-bright', bear: 'text-bear-bright', warn: 'text-regime-hot',
  info: 'text-info', accent: 'text-accent', gold: 'text-gold', neutral: 'text-ink', muted: 'text-ink-muted',
};

/** Semantic CSS-var per tone, for SVG fills/strokes. */
export const toneVar: Record<Tone, string> = {
  bull: 'var(--bull-bright)', bear: 'var(--bear-bright)', warn: 'var(--regime-hot)',
  info: 'var(--info)', accent: 'var(--accent)', gold: 'var(--gold)', neutral: 'var(--ink)', muted: 'var(--ink-faint)',
};

/** Value -> color ramp for gauges and scores (token-driven). */
export const scoreColor = (v: number) =>
  v >= 75 ? 'var(--bull-bright)' : v >= 50 ? 'var(--regime-hot)' : 'var(--bear-bright)';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
