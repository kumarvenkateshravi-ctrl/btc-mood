// Central debug service. Components ask isDebugEnabled('<scope>') and never
// read the URL themselves, so the mechanism can change without touching UI.
// v1 mechanism: ?debug=1 enables every scope; ?debug=<scope> enables one.

export function isDebugEnabled(scope: string): boolean {
  const w = (globalThis as { window?: { location?: { search?: string } } }).window;
  const search = w?.location?.search;
  if (!search) return false;
  const v = new URLSearchParams(search).get('debug');
  return v === '1' || v === 'true' || v === scope;
}
