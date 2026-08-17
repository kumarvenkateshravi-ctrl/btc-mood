import {
  isPriceExecutionTrusted,
  type MarketDataIntegrity,
} from './marketDataIntegrity';

// This module is deliberately not persisted: every page load starts untrusted
// until the live market-data pipeline establishes a fresh exchange price.
let marketIntegrity: MarketDataIntegrity = 'loading';
let replayActive = false;

export function setMarketDataIntegrity(next: MarketDataIntegrity): void {
  marketIntegrity = next;
}

export function setMarketDataReplayActive(active: boolean): void {
  replayActive = active;
}

export function getMarketDataIntegrity(): MarketDataIntegrity {
  return replayActive ? 'replay' : marketIntegrity;
}

export function canExecutePriceDependentLiveAction(): boolean {
  return isPriceExecutionTrusted(getMarketDataIntegrity());
}

/** Test-only: controls the otherwise live market-data-driven trust state. */
export function setMarketDataIntegrityForTest(next: MarketDataIntegrity): void {
  replayActive = false;
  marketIntegrity = next;
}
