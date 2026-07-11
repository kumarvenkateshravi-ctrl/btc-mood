/**
 * Feature flags read once on module load.
 *
 * - `chartSettings` gates the new TV-style chart settings popover. Defaults
 *   to `true` in dev and `false` in production until we ship it broadly.
 *
 * Next.js exposes `process.env.NEXT_PUBLIC_*` to the browser, so consumers
 * can import this from client components safely.
 */

const isProd = process.env.NODE_ENV === 'production';

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export const featureFlags = {
  chartSettings: readBool('NEXT_PUBLIC_CHART_SETTINGS_ENABLED', !isProd),
  layoutSwitcher: readBool('NEXT_PUBLIC_LAYOUT_SWITCHER_ENABLED', !isProd),
  /** Replay Verification developer panel (Verify button in the ReplayBar). */
  replayDebug: readBool('NEXT_PUBLIC_REPLAY_DEBUG', !isProd),
} as const;
