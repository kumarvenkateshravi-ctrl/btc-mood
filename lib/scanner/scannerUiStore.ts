// Technical Scanner — UI store: the page publishes the engine snapshot here;
// the chart indicator and the signal dock read the SAME object (one source of
// truth). Also holds the selected-signal id (dock click → chart focus + card).

import type { ScannerSnapshot } from './engine';

let _snapshot: ScannerSnapshot | null = null;
let _selectedSignalId: string | null = null;

export function publishScannerSnapshot(s: ScannerSnapshot): void {
  _snapshot = s;
}
export function latestScannerSnapshot(): ScannerSnapshot | null {
  return _snapshot;
}
export function selectScannerSignal(id: string | null): void {
  _selectedSignalId = id;
}
export function selectedScannerSignalId(): string | null {
  return _selectedSignalId;
}

/** Test-only. */
export function __resetScannerUiForTest(): void {
  _snapshot = null;
  _selectedSignalId = null;
}
