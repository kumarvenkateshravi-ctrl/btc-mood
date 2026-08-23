/**
 * Presentation-only policy for analytical chart objects.
 *
 * This module deliberately contains no market calculations.  It decides only
 * how already-computed POCs/zones/structure should compete for pixels and
 * labels.  Keeping this separate prevents visual hierarchy changes from
 * changing replay, POC, FVG, SMC, or Supply/Demand truth.
 */

export const ANALYTICAL_POC_COLORS = Object.freeze({
  fourHour: '#00bcd4',
  daily: '#f0b90b',
  weekly: '#a855f7',
});

/** Apply presentation opacity while preserving the source hue. */
export function analyticalColor(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  if (clamped >= 0.999) return color;
  const rgba = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (rgba) return 'rgba(' + rgba[1] + ',' + rgba[2] + ',' + rgba[3] + ',' + clamped + ')';
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + clamped + ')';
  }
  return color;
}
/** Historical decay: recent/current objects remain readable, old history gets
 * quieter without disappearing.  Age is measured in rendered bars/runs. */
export function analyticalDecay(age: number, focused = false): number {
  if (focused || age <= 0) return 1;
  return Math.max(0.28, 1 / (1 + Math.max(0, age) * 0.08));
}

export type AnalyticalFocusKind = 'price' | 'sl' | 'tp' | 'entry' | 'poc' | 'structure' | 'fvg' | 'orderBlock' | 'liquidity' | 'supplyDemand';

export interface AnalyticalFocusCandidate {
  id: string;
  kind: AnalyticalFocusKind;
  distance: number;
  active: boolean;
}

const KIND_PRIORITY: Record<AnalyticalFocusKind, number> = {
  price: 100,
  sl: 95,
  tp: 95,
  entry: 90,
  poc: 80,
  structure: 70,
  fvg: 60,
  orderBlock: 55,
  liquidity: 50,
  supplyDemand: 45,
};

/** Select one focus target without inventing confluence or changing signals. */
export function chooseAnalyticalFocus(candidates: AnalyticalFocusCandidate[]): string | undefined {
  return candidates
    .filter((candidate) => candidate.active && Number.isFinite(candidate.distance))
    .slice()
    .sort((a, b) => a.distance - b.distance || KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind] || a.id.localeCompare(b.id))[0]?.id;
}

export interface AnalyticalLabelCandidate {
  id: string;
  y: number;
  priority: number;
}

/** Deterministic label collision suppression.  Higher priority wins. */
export function resolveLabelCollisions<T extends AnalyticalLabelCandidate>(labels: T[], minDistance: number): T[] {
  const accepted: T[] = [];
  for (const label of labels.slice().sort((a, b) => b.priority - a.priority || a.y - b.y || a.id.localeCompare(b.id))) {
    if (accepted.every((other) => Math.abs(other.y - label.y) >= minDistance)) accepted.push(label);
  }
  return accepted.sort((a, b) => a.y - b.y || b.priority - a.priority || a.id.localeCompare(b.id));
}
