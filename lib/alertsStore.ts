'use client';

// Reactive, localStorage-backed store for the Alerts command center: the user's
// alert rules + delivery-method toggles. Mirrors the singleton-store pattern used
// elsewhere (priceAlertsStore). The triggered feed is session-derived in the page.

import { useSyncExternalStore } from 'react';
import { seedAlerts, type Alert, type AlertFilters, type AlertType, type Condition, type Severity } from './alertsEngine';

const ALERTS_KEY = 'mcs:alerts:v1';
const DELIVERY_KEY = 'mcs:alerts-delivery:v1';

export type DeliveryMethod = 'browser' | 'telegram' | 'email' | 'discord' | 'push';
export type Delivery = Record<DeliveryMethod, boolean>;
const DEFAULT_DELIVERY: Delivery = { browser: true, telegram: true, email: true, discord: false, push: true };

let alertsCache: Alert[] | null = null;
let deliveryCache: Delivery | null = null;
const listeners = new Set<() => void>();
const EMPTY: Alert[] = [];

function loadAlerts(): Alert[] {
  if (alertsCache) return alertsCache;
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(ALERTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      alertsCache = Array.isArray(parsed) ? parsed : seedAlerts();
    } else {
      alertsCache = seedAlerts();
      window.localStorage.setItem(ALERTS_KEY, JSON.stringify(alertsCache));
    }
  } catch {
    alertsCache = seedAlerts();
  }
  return alertsCache;
}
function loadDelivery(): Delivery {
  if (deliveryCache) return deliveryCache;
  let d: Delivery = DEFAULT_DELIVERY;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(DELIVERY_KEY);
      if (raw) d = { ...DEFAULT_DELIVERY, ...JSON.parse(raw) };
    } catch {}
  }
  deliveryCache = d;
  return d;
}

function saveAlerts(next: Alert[]) {
  alertsCache = next;
  try { window.localStorage.setItem(ALERTS_KEY, JSON.stringify(next)); } catch {}
  for (const l of listeners) l();
}
function saveDelivery(next: Delivery) {
  deliveryCache = next;
  try { window.localStorage.setItem(DELIVERY_KEY, JSON.stringify(next)); } catch {}
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export interface NewAlertInput {
  symbol: string; type: AlertType; condition: Condition; threshold: number; severity: Severity; filters?: AlertFilters;
}
export function addAlert(input: NewAlertInput): Alert {
  const alert: Alert = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: input.symbol, type: input.type, condition: input.condition, threshold: input.threshold,
    severity: input.severity, status: 'Active', createdAt: Date.now(), lastTriggered: null, filters: input.filters,
  };
  saveAlerts([alert, ...loadAlerts()]);
  return alert;
}
export function removeAlert(id: string) { saveAlerts(loadAlerts().filter((a) => a.id !== id)); }
export function toggleAlertStatus(id: string) {
  saveAlerts(loadAlerts().map((a) => (a.id === id ? { ...a, status: a.status === 'Active' ? 'Paused' : 'Active' } : a)));
}
export function markAlertTriggered(id: string, ts = Date.now()) {
  saveAlerts(loadAlerts().map((a) => (a.id === id ? { ...a, lastTriggered: ts } : a)));
}
export function toggleDelivery(method: DeliveryMethod) {
  const d = loadDelivery();
  saveDelivery({ ...d, [method]: !d[method] });
}

export function getAlerts(): Alert[] { return loadAlerts(); }
export function useAlertRules(): Alert[] {
  return useSyncExternalStore(subscribe, () => alertsCache ?? loadAlerts(), () => EMPTY);
}
export function useDelivery(): Delivery {
  return useSyncExternalStore(subscribe, () => deliveryCache ?? loadDelivery(), () => DEFAULT_DELIVERY);
}
