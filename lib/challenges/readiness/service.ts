import type { ChallengeReplayRepository } from '../persistence';
import { loadChallengeReport, type ChallengeReportReadModel } from '../report';
import { buildChallengeReadiness } from './scorer';
import type { ChallengeReadinessReadModel } from './types';

export interface LoadedChallengeReportWithReadiness {
  report: ChallengeReportReadModel;
  readiness: ChallengeReadinessReadModel;
  reportBuildDurationMs: number;
  readinessBuildDurationMs: number;
}

export async function loadChallengeReportWithReadiness(repository: ChallengeReplayRepository, challengeId: string): Promise<LoadedChallengeReportWithReadiness> {
  const loaded = await loadChallengeReport(repository, challengeId);
  const started = performance.now();
  const readiness = buildChallengeReadiness(loaded.report);
  return { report: loaded.report, readiness, reportBuildDurationMs: loaded.buildDurationMs, readinessBuildDurationMs: performance.now() - started };
}
