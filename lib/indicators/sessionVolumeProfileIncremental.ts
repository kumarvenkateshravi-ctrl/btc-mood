import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorResult } from '../indicatorFramework';
import type { IncrementalIndicatorFactory } from '../incrementalIndicatorEngine';
import {
  buildProfile,
  buildPocOnlyProfile,
  computeSessionVolumeProfile,
  groupIntoSessions,
  type ProfileOptions,
  type SessionOptions,
  type SessionProfileProvider,
  type SessionMode,
  type VolumeProfile,
} from './sessionVolumeProfile';
import { createProfileDataProvider, type ProfileSourceProvenance } from './profileDataProvider';
import { HistoricalPocStore } from './historicalPocStore';

export interface SessionProfileCacheStats {
  completedBuilds: number;
  activeBuilds: number;
  cacheHits: number;
  cachedSessions: number;
}

interface CachedProfile extends VolumeProfile {
  readonly __cacheKey: string;
}

function freezeProfile(profile: VolumeProfile, cacheKey: string): CachedProfile {
  const rows = profile.rows.map((row) => Object.freeze({ ...row }));
  return Object.freeze({ ...profile, rows: Object.freeze(rows), __cacheKey: cacheKey }) as unknown as CachedProfile;
}

/**
 * Session cache used by the SVP incremental adapter. The cache only owns
 * completed sessions. The last session for each mode is always rebuilt from
 * the current candle tail so developing POCs retain their existing semantics.
 */
const FULL_PROFILE_CACHE_LIMIT = 60;

export class SessionVolumeProfileCache {
  private readonly scope: string;
  private readonly provenance?: ProfileSourceProvenance;
  private readonly completed = new Map<string, CachedProfile>();
  private readonly counters = { completedBuilds: 0, activeBuilds: 0, cacheHits: 0 };

  constructor(scope: string, provenance?: ProfileSourceProvenance) {
    this.scope = scope;
    this.provenance = provenance;
    this.provider.provenance = provenance;
    this.provider.cacheIdentity = this.sourceCacheIdentity();
  }

  clear(): void {
    this.completed.clear();
    this.counters.completedBuilds = 0;
    this.counters.activeBuilds = 0;
    this.counters.cacheHits = 0;
  }

  stats(): SessionProfileCacheStats {
    return { ...this.counters, cachedSessions: this.completed.size };
  }

  provider: SessionProfileProvider = (candles, sessionOpts, profileOpts, pocOnly = false) => {
    const sessions = groupIntoSessions(candles, sessionOpts);
    const lastIndex = sessions.length - 1;
    const fullProfileStart = Math.max(0, sessions.length - FULL_PROFILE_CACHE_LIMIT);
    return sessions.flatMap((session, index) => {
      const compact = pocOnly || index < fullProfileStart;
      // A session that ages out of the recent window is demoted once: retain
      // its compact POC, never its historical histogram rows/VAH/VAL payload.
      if (compact && !pocOnly) this.completed.delete(this.key(sessionOpts, profileOpts, session.startTime, false));
      const key = this.key(sessionOpts, profileOpts, session.startTime, compact);
      if (index < lastIndex) {
        const cached = this.completed.get(key);
        if (cached) {
          this.counters.cacheHits += 1;
          return [cached];
        }
        const built = compact ? buildPocOnlyProfile(session.candles, profileOpts) : buildProfile(session.candles, profileOpts);
        if (!built) return [];
        this.counters.completedBuilds += 1;
        const frozen = freezeProfile(this.stampSource(built, sessionOpts.mode), key);
        this.completed.set(key, frozen);
        return [frozen];
      }
      this.counters.activeBuilds += 1;
      const active = pocOnly ? buildPocOnlyProfile(session.candles, profileOpts) : buildProfile(session.candles, profileOpts);
      return active ? [active] : [];
    });
  };

  /** Prime completed sessions once after the authoritative initial compute. */
  prime(candles: Candle[], modes: Array<{ session: SessionOptions; profile: Partial<ProfileOptions>; pocOnly: boolean }>): void {
    for (const mode of modes) {
      const sessions = groupIntoSessions(candles, mode.session);
      const fullProfileStart = Math.max(0, sessions.length - FULL_PROFILE_CACHE_LIMIT);
      for (let index = 0; index < Math.max(0, sessions.length - 1); index += 1) {
        const session = sessions[index];
        const compact = mode.pocOnly || index < fullProfileStart;
        const key = this.key(mode.session, mode.profile, session.startTime, compact);
        if (this.completed.has(key)) continue;
        const built = compact ? buildPocOnlyProfile(session.candles, mode.profile) : buildProfile(session.candles, mode.profile);
        if (!built) continue;
        this.counters.completedBuilds += 1;
        this.completed.set(key, freezeProfile(this.stampSource(built, mode.session.mode), key));
      }
    }
  }

  private key(session: SessionOptions, profile: Partial<ProfileOptions>, startTime: number, pocOnly: boolean): string {
    return JSON.stringify({ scope: this.scope, source: this.provenance ?? null, mode: session.mode, customStartMin: session.customStartMin ?? null, customEndMin: session.customEndMin ?? null, tzOffsetMin: session.tzOffsetMin ?? null, profile, pocOnly, startTime });
  }

  private sourceCacheIdentity(): string {
    return JSON.stringify({ scope: this.scope, source: this.provenance ?? null });
  }

  private stampSource(profile: VolumeProfile, sessionTimeframe: string): VolumeProfile {
    return this.provenance ? { ...profile, source: { ...this.provenance, sessionTimeframe } } : profile;
  }
}

function profileSettings(config?: CustomIndicatorConfig): {
  mode: SessionMode;
  session: SessionOptions;
  profile: Partial<ProfileOptions>;
  pocOnly: boolean;
  additional: Array<{ session: SessionOptions; profile: Partial<ProfileOptions>; pocOnly: boolean }>;
} {
  const inputs = config?.settings?.inputs ?? {};
  const num = (id: string, fallback: number) => Number.isFinite(Number(inputs[id])) ? Number(inputs[id]) : fallback;
  const str = (id: string, fallback: string) => typeof inputs[id] === 'string' ? String(inputs[id]) : fallback;
  const bool = (id: string, fallback: boolean) => typeof inputs[id] === 'boolean' ? Boolean(inputs[id]) : fallback;
  const mode = str('sessions', 'daily') as SessionMode;
  const session: SessionOptions = { mode, customStartMin: num('customStartHour', 9) * 60, customEndMin: num('customEndHour', 16) * 60 };
  const profile: Partial<ProfileOptions> = { rowsLayout: str('rowsLayout', 'rows') as ProfileOptions['rowsLayout'], rowSize: num('rowSize', 24), valueAreaVolume: num('valueAreaVolume', 70) };
  const configuredTickSize = Number(inputs['tickSize']);
  if (Number.isFinite(configuredTickSize) && configuredTickSize > 0) profile.tickSize = configuredTickSize;
  const showBoxes = bool('showProfileBoxes', true);
  const pocOnly = !showBoxes && !bool('extendVah', false) && !bool('extendVal', false);
  const additional = (['weekly', 'daily', '4h'] as SessionMode[]).filter((additionalMode) => additionalMode !== mode && bool(additionalMode === 'weekly' ? 'showWeeklyPocs' : additionalMode === 'daily' ? 'showDailyPocs' : 'show4hPocs', false)).map((additionalMode) => ({ session: { mode: additionalMode }, profile, pocOnly: true }));
  return { mode, session, profile, pocOnly, additional };
}

export const incrementalSessionVolumeProfile: IncrementalIndicatorFactory = ({ compute: _compute, config, identity, evaluationContext }) => {
  const initialSettings = profileSettings(config);
  const profileData = evaluationContext
    ? createProfileDataProvider({ context: evaluationContext, sessionTimeframe: initialSettings.mode })
    : undefined;
  const cache = new SessionVolumeProfileCache(identity ?? config?.id ?? 'session_volume_profile', profileData?.provenance);
  const historicalStore = profileData ? new HistoricalPocStore({
    source: profileData.provenance,
    replayCutTime: evaluationContext?.replay?.cutTime,
  }) : undefined;
  let history: Candle[] = [];
  let result: IndicatorResult;
  const retainHistorical = (next: IndicatorResult): IndicatorResult => {
    if (!historicalStore || !next.historicalPocs) return next;
    historicalStore.merge(next.historicalPocs);
    return { ...next, historicalPocs: historicalStore.records() };
  };
  const initialize = (next: Candle[]) => {
    history = next.slice();
    result = computeSessionVolumeProfile(history, config, undefined, cache.provider);
    return retainHistorical(result);
  };
  const update = (next: Candle[]) => {
    history = next.slice();
    result = computeSessionVolumeProfile(history, config, undefined, cache.provider);
    return retainHistorical(result);
  };
  return {
    initialize,
    updateLast: (bar: Candle) => update([...history.slice(0, -1), bar]),
    append: (bar: Candle) => update([...history, bar]),
    rebuild: (next: Candle[]) => { cache.clear(); return initialize(next); },
    stats: cache.stats.bind(cache),
  };
};
