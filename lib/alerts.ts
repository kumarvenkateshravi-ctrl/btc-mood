// Alert rule model + localStorage-backed store. Pure logic so it can
// be tested in isolation; the dashboard wires the persistence layer.

import type { Signal, Timeframe } from './types';

export type AlertSide = 'buy' | 'sell';

export interface AlertRule {
  id: string;
  tf: Timeframe;
  side: AlertSide;
  enabled: boolean;
  createdAt: number;
  lastFiredAt: number | null;
}

export const STORAGE_KEY = 'btc-mood:alerts:v1';

export function isAlertSide(s: string): s is AlertSide {
  return s === 'buy' || s === 'sell';
}

export function newRuleId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultRules(): AlertRule[] {
  return [];
}

export function loadRules(): AlertRule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRule);
  } catch {
    return [];
  }
}

export function saveRules(rules: AlertRule[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Quota / disabled storage — swallow.
  }
}

export function isRule(value: unknown): value is AlertRule {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.tf === 'string' &&
    isAlertSide(String(v.side)) &&
    typeof v.enabled === 'boolean' &&
    typeof v.createdAt === 'number' &&
    (v.lastFiredAt === null || typeof v.lastFiredAt === 'number')
  );
}

/**
 * For a given snapshot, return the rules that should fire. A rule fires
 * when the signal side matches the rule's side. We dedupe by `id` so
 * the same rule doesn't fire twice in a row — but we re-fire when the
 * signal flips back through (e.g. SELL→WAIT→SELL fires again).
 */
export function rulesToFire(
  rules: AlertRule[],
  snapshots: Record<Timeframe, Signal | null>,
  lastFiredSide: Record<string, AlertSide | null>,
): AlertRule[] {
  const out: AlertRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const sig = snapshots[rule.tf];
    if (!sig) continue;
    if (sig.side !== rule.side) continue;
    if (lastFiredSide[rule.id] === rule.side) continue; // dedupe
    out.push(rule);
  }
  return out;
}
