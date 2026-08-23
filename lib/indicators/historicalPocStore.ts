import type { ProfileSourceProvenance } from './profileDataProvider';

export type HistoricalPocSessionType = '4h' | 'daily' | 'weekly';

/** Compact, immutable data required to render one completed session POC. */
export interface HistoricalPocRecord {
  symbol: string;
  sessionType: HistoricalPocSessionType;
  sessionStart: number;
  sessionEnd: number;
  poc: number;
  source: ProfileSourceProvenance;
  finalized: true;
}

export interface HistoricalPocIndex {
  records: readonly HistoricalPocRecord[];
}

export interface HistoricalPocStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface HistoricalPocStoreOptions {
  source: ProfileSourceProvenance;
  storage?: HistoricalPocStorage;
  persist?: boolean;
  /** A replay store may expose only sessions fully finalized by this cut. */
  replayCutTime?: number;
}

export interface FinalizedProfileLike {
  startTime: number;
  endTime: number;
  poc: number;
  source?: ProfileSourceProvenance;
}

const DAY_SECONDS = 86_400;
const RETENTION_SECONDS = 365 * DAY_SECONDS;
const MAX_SESSION_SECONDS = 7 * DAY_SECONDS;
const STORAGE_VERSION = 1;

function sourceIdentity(source: ProfileSourceProvenance): string {
  return JSON.stringify({
    symbol: source.symbol,
    sourceTimeframe: source.sourceTimeframe,
    tier: source.tier,
    quality: source.quality,
    completeness: source.completeness,
    sourceRevision: source.sourceRevision,
  });
}

export function pocRecordKey(record: HistoricalPocRecord): string {
  return JSON.stringify({
    symbol: record.symbol,
    sessionType: record.sessionType,
    sessionStart: record.sessionStart,
    sessionEnd: record.sessionEnd,
    source: sourceIdentity(record.source),
  });
}

/** Converts completed profiles to compact records; the final profile remains developing. */
export function extractFinalizedHistoricalPocs(
  profiles: readonly FinalizedProfileLike[],
  sessionType: HistoricalPocSessionType,
  fallbackSource?: ProfileSourceProvenance,
): HistoricalPocRecord[] {
  return profiles.slice(0, -1).flatMap((profile) => {
    const source = profile.source ?? fallbackSource;
    if (!source || !Number.isFinite(profile.poc)) return [];
    return [freezeRecord({
      symbol: source.symbol,
      sessionType,
      sessionStart: profile.startTime,
      sessionEnd: profile.endTime,
      poc: profile.poc,
      source: { ...source, sessionTimeframe: sessionType },
      finalized: true,
    })];
  });
}

function isRecord(value: unknown): value is HistoricalPocRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HistoricalPocRecord>;
  return candidate.finalized === true &&
    (candidate.sessionType === '4h' || candidate.sessionType === 'daily' || candidate.sessionType === 'weekly') &&
    typeof candidate.symbol === 'string' &&
    Number.isFinite(candidate.sessionStart) && Number.isFinite(candidate.sessionEnd) &&
    Number.isFinite(candidate.poc) && candidate.sessionEnd! > candidate.sessionStart! &&
    Boolean(candidate.source && typeof candidate.source === 'object');
}

function freezeRecord(record: HistoricalPocRecord): HistoricalPocRecord {
  return Object.freeze({ ...record, source: Object.freeze({ ...record.source }) });
}

function lowerBound(records: readonly HistoricalPocRecord[], value: number): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (records[middle].sessionStart < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(records: readonly HistoricalPocRecord[], value: number): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (records[middle].sessionStart <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function buildHistoricalPocIndex(records: readonly HistoricalPocRecord[]): HistoricalPocIndex {
  return {
    records: Object.freeze([...records].sort((a, b) => a.sessionStart - b.sessionStart || a.sessionEnd - b.sessionEnd)),
  };
}

/** O(log n + visible) lookup; only a one-week overlap window can precede view. */
export function selectVisibleHistoricalPocs(
  index: HistoricalPocIndex,
  range: { from: number; to: number } | null,
): HistoricalPocRecord[] {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return [];
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  const start = lowerBound(index.records, from - MAX_SESSION_SECONDS);
  const end = upperBound(index.records, to);
  return index.records.slice(start, end).filter((record) => record.sessionEnd >= from && record.sessionStart <= to);
}

function storageKey(source: ProfileSourceProvenance): string {
  return `btc-mood:historical-pocs:v${STORAGE_VERSION}:${encodeURIComponent(sourceIdentity(source))}`;
}

function browserStorage(): HistoricalPocStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try { return window.localStorage; } catch { return undefined; }
}

/**
 * A compact in-memory mirror with optional localStorage persistence. It stores
 * only finalized POC records, never profile rows, VAH/VAL, or histogram boxes.
 */
export class HistoricalPocStore {
  private readonly source: ProfileSourceProvenance;
  private readonly storage?: HistoricalPocStorage;
  private readonly persist: boolean;
  private readonly replayCutTime?: number;
  private readonly byKey = new Map<string, HistoricalPocRecord>();
  private index: HistoricalPocIndex = { records: [] };

  constructor(options: HistoricalPocStoreOptions) {
    this.source = options.source;
    this.storage = options.storage ?? browserStorage();
    this.persist = options.persist ?? options.source.mode !== 'replay';
    this.replayCutTime = options.replayCutTime;
    this.hydrate();
  }

  /** Cancellable seam for future deep-history/persistence loaders. */
  async load(records: readonly (HistoricalPocRecord | { finalized: false })[], signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    await Promise.resolve();
    if (signal?.aborted) return false;
    return this.merge(records);
  }

  merge(records: readonly (HistoricalPocRecord | { finalized: false })[]): boolean {
    let changed = false;
    for (const item of records) {
      if (!isRecord(item) || item.symbol !== this.source.symbol || sourceIdentity(item.source) !== sourceIdentity(this.source)) continue;
      if (this.replayCutTime != null && item.sessionEnd > this.replayCutTime) continue;
      const key = pocRecordKey(item);
      if (this.byKey.has(key)) continue; // finalized records are immutable.
      this.byKey.set(key, freezeRecord(item));
      changed = true;
    }
    if (!changed) return false;
    this.applyRetention();
    this.rebuildIndex();
    this.save();
    return true;
  }

  records(sessionType?: HistoricalPocSessionType): HistoricalPocRecord[] {
    const values = this.index.records.filter((record) => !sessionType || record.sessionType === sessionType);
    const replayCutTime = this.replayCutTime;
    return replayCutTime == null ? values.slice() : values.filter((record) => record.sessionEnd <= replayCutTime);
  }

  visible(range: { from: number; to: number } | null): HistoricalPocRecord[] {
    const replayCutTime = this.replayCutTime;
    return selectVisibleHistoricalPocs(this.index, range).filter((record) =>
      replayCutTime == null || record.sessionEnd <= replayCutTime,
    );
  }

  private applyRetention(): void {
    const latestEnd = new Map<HistoricalPocSessionType, number>();
    for (const record of this.byKey.values()) {
      latestEnd.set(record.sessionType, Math.max(latestEnd.get(record.sessionType) ?? -Infinity, record.sessionEnd));
    }
    for (const [key, record] of this.byKey) {
      const latest = latestEnd.get(record.sessionType);
      const cutoff = (latest == null ? record.sessionEnd : latest) - RETENTION_SECONDS;
      // Keep a weekly session that intersects the 365-day window.
      if (record.sessionEnd <= cutoff) this.byKey.delete(key);
    }
  }

  private rebuildIndex(): void {
    this.index = buildHistoricalPocIndex([...this.byKey.values()]);
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(storageKey(this.source));
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!isRecord(item) || item.symbol !== this.source.symbol || sourceIdentity(item.source) !== sourceIdentity(this.source)) continue;
        if (this.replayCutTime != null && item.sessionEnd > this.replayCutTime) continue;
        this.byKey.set(pocRecordKey(item), freezeRecord(item));
      }
      this.applyRetention();
      this.rebuildIndex();
    } catch {
      // Corrupt/blocked local storage is non-fatal; live recomputation refills it.
    }
  }

  private save(): void {
    if (!this.persist || !this.storage) return;
    try { this.storage.setItem(storageKey(this.source), JSON.stringify(this.index.records)); } catch {}
  }
}

