// Chart Oscillator Design System — the single visual contract for every
// indicator pane below the price chart (MACD, RSI, Stochastic, CCI, ...).
//
// Premise (from DESIGN.md "density with composure" + IHS >= 80): price is the
// dominant focal point; oscillators recede until momentum matters. That is a
// VISUAL-WEIGHT problem, not a math problem, so the treatment lives here at the
// render layer — the pure indicator computes and their golden fixtures never
// change. Every present and future oscillator inherits the same restraint by
// flowing its plots through these tokens in useChartData.
//
// The levers, tuned against TradingView's reference rendering:
//   - lines are hair-thin (the eye follows shape, not stroke weight)
//   - the histogram is a soft momentum field, not saturated blocks
//   - panes are separated by whitespace + a whisper line, not a window frame
//   - curves keep breathing room and never touch the pane edges

export const OSC = {
  /** LWC's thinnest stroke. Oscillator lines default to this unless the user
   *  explicitly thickens one in the indicator settings. */
  lineWidth: 1 as const,

  /** Per-bar histogram colours are driven to this alpha so momentum reads as a
   *  soft field the signal lines float over, instead of competing bars.
   *  ~0.55 keeps TV's light 4-state palette legible without the blockiness. */
  histogramAlpha: 0.55,

  /** Breathing room inside an oscillator pane: curves float, never clip. */
  scaleMargins: { top: 0.22, bottom: 0.18 } as const,

  /** Pane chrome: connected, not walled off. A separator you feel more than
   *  see, and an axis border that barely registers. */
  separatorColor: 'rgba(255, 255, 255, 0.04)',
  separatorHoverColor: 'rgba(154, 178, 215, 0.22)',
  paneBorderColor: 'rgba(255, 255, 255, 0.05)',
  /** Axis numerals: present for the read, quiet in the hierarchy. */
  axisTextColor: 'rgba(210, 216, 228, 0.55)',
} as const;

/**
 * Soften a solid indicator colour (hex `#rrggbb`, `#rgb`, or `rgb()/rgba()`)
 * to a translucent fill for histogram bars. Idempotent-ish: an existing rgba
 * has its alpha reduced toward `alpha` rather than compounded.
 */
export function softHistogram(color: string, alpha: number = OSC.histogramAlpha): string {
  const c = color.trim();

  const hex = c.startsWith('#') ? c.slice(1) : null;
  if (hex && (hex.length === 3 || hex.length === 6)) {
    const full = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if ([r, g, b].every(Number.isFinite)) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;

  return c; // named colours / gradients pass through untouched
}
