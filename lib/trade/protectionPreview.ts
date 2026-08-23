import type { PaperPosition } from '../paper';

export interface ProtectionPreview {
  level: number | null;
  pnlAtLevel: number | null;
  /** The preview is informational only. It never changes execution state. */
  kind: 'risk' | 'profit-lock' | 'break-even' | 'unavailable';
  rMultiple: number | null;
}

/** Pure protection consequence preview for sheet/overlay drafts. */
export function previewProtection(position: PaperPosition, input: { sl?: number | null; tp?: number | null }): ProtectionPreview {
  const level = Object.prototype.hasOwnProperty.call(input, 'sl') ? input.sl : input.tp;
  if (level == null || !Number.isFinite(level) || level <= 0 || position.side === 'flat' || position.units <= 0) {
    return { level: null, pnlAtLevel: null, kind: 'unavailable', rMultiple: null };
  }
  const direction = position.side === 'long' ? 1 : -1;
  const pnlAtLevel = (level - position.entryPrice) * position.units * direction;
  const baselineRisk = position.sl == null ? null : Math.abs(position.entryPrice - position.sl) * position.units;
  const rMultiple = baselineRisk && baselineRisk > 0 ? pnlAtLevel / baselineRisk : null;
  const kind = pnlAtLevel === 0 ? 'break-even' : pnlAtLevel > 0 ? 'profit-lock' : 'risk';
  return { level, pnlAtLevel, kind, rMultiple };
}
