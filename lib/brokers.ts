// Broker affiliate-link configuration.
//
// The dashboard reads these from `process.env.NEXT_PUBLIC_*` so the
// URLs can be set at deploy time without a code change. Set
// `NEXT_PUBLIC_BROKERS_ENABLED=1` to expose the "Open a trading
// account" section on the home page. If the flag is off (default),
// the section is hidden entirely — no broken `#` links leak through.
//
// Per-broker URL env vars:
//   NEXT_PUBLIC_BROKER_BINANCE_URL
//   NEXT_PUBLIC_BROKER_BYBIT_URL
//   NEXT_PUBLIC_BROKER_OKX_URL
//
// Missing URLs render as a disabled card (not a clickable link) so
// the layout doesn't break if a partner agreement is still pending.

export type BrokerId = 'binance' | 'bybit' | 'okx';

export interface BrokerConfig {
  id: BrokerId;
  name: string;
  pitch: string;
  url: string | null;
}

const META: Omit<BrokerConfig, 'url'>[] = [
  { id: 'binance', name: 'Binance', pitch: 'Largest liquidity, lowest spreads.' },
  { id: 'bybit', name: 'Bybit', pitch: 'Derivatives-focused, fast matching.' },
  { id: 'okx', name: 'OKX', pitch: 'Deep books, strong on-chain tools.' },
];

const ENV_KEYS: Record<BrokerId, string> = {
  binance: 'NEXT_PUBLIC_BROKER_BINANCE_URL',
  bybit: 'NEXT_PUBLIC_BROKER_BYBIT_URL',
  okx: 'NEXT_PUBLIC_BROKER_OKX_URL',
};

function readUrl(id: BrokerId): string | null {
  const raw = process.env[ENV_KEYS[id]];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Refuse anything that doesn't look http(s) — defense in depth.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function getBrokersEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_BROKERS_ENABLED;
  return v === '1' || v === 'true';
}

export function getBrokers(): BrokerConfig[] {
  return META.map((m) => ({ ...m, url: readUrl(m.id) }));
}
