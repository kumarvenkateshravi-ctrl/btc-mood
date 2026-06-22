// In-process registry of DataSource implementations. The pattern is
// vardhan's `DataSource` protocol lifted from the vardhan Python
// reference: a single `register` / `get` / `list` seam so new exchanges
// plug in by writing one class. Re-registering the same id replaces
// (it never duplicates) so hot-reload is safe.

import type { DataSource, DataSourceMeta } from './types';

const _sources = new Map<string, DataSource>();

export function registerDataSource(src: DataSource): void {
  _sources.set(src.meta.id, src);
}

export function getDataSource(id: string): DataSource {
  const s = _sources.get(id);
  if (!s) {
    const known = listDataSourceMetas().map((m) => m.id).join(', ');
    throw new Error(`Unknown data source: ${id}. Known sources: ${known || '(none registered)'}`);
  }
  return s;
}

export function hasDataSource(id: string): boolean {
  return _sources.has(id);
}

export function listDataSources(): DataSource[] {
  return [..._sources.values()];
}

export function listDataSourceMetas(): DataSourceMeta[] {
  return [..._sources.values()].map((s) => s.meta);
}

export function defaultDataSource(): DataSource {
  // The default id is set when the package index registers the default
  // source. Fall back to whatever was registered first.
  // The DEFAULT_DATA_SOURCE_ID constant is intentionally imported lazily
  // here to avoid a circular import (index.ts imports registry.ts).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const id = (globalThis as { __DEFAULT_DATA_SOURCE_ID?: string }).__DEFAULT_DATA_SOURCE_ID;
  if (id && _sources.has(id)) return _sources.get(id)!;
  const first = _sources.values().next().value;
  if (!first) {
    throw new Error('No data sources registered. Did you import the dataSource package?');
  }
  return first;
}

export function setDefaultDataSourceId(id: string): void {
  (globalThis as { __DEFAULT_DATA_SOURCE_ID?: string }).__DEFAULT_DATA_SOURCE_ID = id;
}

/** Test-only: clear the registry. Never call from app code. */
export function __resetDataSourceRegistry(): void {
  _sources.clear();
  delete (globalThis as { __DEFAULT_DATA_SOURCE_ID?: string }).__DEFAULT_DATA_SOURCE_ID;
}
