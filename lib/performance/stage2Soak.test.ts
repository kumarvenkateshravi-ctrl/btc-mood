// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { runStage2Soak, type SoakDuration } from './stage2Soak';

describe('Stage 2 long-running verification soak', () => {
  it('runs deterministic accelerated 30m, 2h, 8h, and 24h scenarios', () => {
    const durations: SoakDuration[] = ['30m', '2h', '8h', '24h'];
    const reports = durations.map((duration) => runStage2Soak(duration));

    expect(reports.map((report) => report.duration)).toEqual(durations);
    for (const report of reports) {
      expect(report.simulatedBars).toBeGreaterThan(0);
      expect(report.formingTicks).toBeGreaterThan(0);
      expect(report.closedBars).toBeGreaterThan(0);
      expect(report.indicatorToggles).toBeGreaterThan(0);
      expect(report.timeframeSwitches).toBeGreaterThan(0);
      expect(report.replayCycles).toBeGreaterThan(0);
      expect(report.panZoomEvents).toBeGreaterThan(0);
      expect(report.prepends).toBeGreaterThan(0);
      expect(report.seriesFullWrites).toBeGreaterThan(0);
      expect(report.seriesTailWrites).toBeGreaterThan(0);
      expect(report.svpCompletedBuilds).toBeGreaterThan(0);
      expect(report.svpCacheHits).toBeGreaterThan(0);
      expect(report.svpCachedAfterClear).toBe(0);
      expect(report.replayActiveBeforeClear).toBe(true);
      expect(report.replayActiveAfterClear).toBe(false);
      expect(report.transformResetLengths).toEqual({ heikinAshi: 0, renko: 0 });
      expect(report.noOpNotifications).toBe(0);
      expect(report.heapSamples.length).toBeGreaterThanOrEqual(2);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for the same duration and seed', () => {
    const left = runStage2Soak('2h', 0x5eed);
    const right = runStage2Soak('2h', 0x5eed);
    const normalize = (report: typeof left) => ({ ...report, durationMs: 0, heapSamples: [], heapSlope: 0 });
    expect(normalize(left)).toEqual(normalize(right));
  });
});
