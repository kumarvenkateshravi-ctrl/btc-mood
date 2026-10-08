export const CHALLENGE_READINESS_VERSION = 'mcs.challenge.readiness/1' as const;

export type ReadinessVersion = typeof CHALLENGE_READINESS_VERSION;
export type ReadinessEligibilityStatus = 'INSUFFICIENT_DATA' | 'SCORABLE' | 'COMPLETE';
export type ReadinessFinality = 'PROVISIONAL' | 'FINAL';
export type ReadinessGrade = 'EXCELLENT' | 'STRONG' | 'DEVELOPING' | 'WEAK' | 'NOT_READY';
export type ReadinessComponentKey = 'riskDiscipline' | 'consistency' | 'profitabilityQuality' | 'executionControl' | 'ruleDiscipline';
export type ReadinessComponentStatus = 'INSUFFICIENT_DATA' | 'SCORED';

export interface ReadinessEvidenceItem {
  code: string;
  label: string;
  value: number | string;
  unit: 'count' | 'basisPoints' | 'moneyAtoms' | 'ratio' | 'text';
}

export interface ReadinessFactor { code: string; label: string; }

export interface ReadinessEvidenceCounts {
  completedLifecycles: number;
  finalizedActiveDays: number;
  finalizedDays: number;
  riskObservations: number;
  warningEvents: number;
  dangerEvents: number;
  breachEvents: number;
  inactivityBreaches: number;
  reversalTransitions: number;
  partialExitOverage: number;
}

export interface ReadinessEligibility {
  status: ReadinessEligibilityStatus;
  eligible: boolean;
  minimumCompletedLifecycles: number;
  minimumFinalizedActiveDays: number;
  minimumRiskObservations: number;
  gaps: readonly ReadinessFactor[];
}

export interface ReadinessComponent {
  key: ReadinessComponentKey;
  label: string;
  score: number | null;
  weight: number;
  weightedContribution: number | null;
  status: ReadinessComponentStatus;
  evidence: readonly ReadinessEvidenceItem[];
  positiveFactors: readonly ReadinessFactor[];
  negativeFactors: readonly ReadinessFactor[];
  insufficientData: readonly ReadinessFactor[];
}

export interface ChallengeReadinessScopeResult {
  scope: 'challenge' | 'phase';
  phaseId: string | null;
  phaseStatus: string;
  finality: ReadinessFinality;
  eligibility: ReadinessEligibility;
  score: number | null;
  grade: ReadinessGrade | null;
  components: readonly ReadinessComponent[];
  strengths: readonly ReadinessFactor[];
  weaknesses: readonly ReadinessFactor[];
  evidenceCounts: ReadinessEvidenceCounts;
}

export interface ChallengeReadinessProvenance {
  readinessVersion: ReadinessVersion;
  reportVersion: string;
  reportHash: string;
  definitionHash: string;
  datasetId: string;
  datasetHash: string;
  branchId: string;
  generation: number;
  challengeId: string;
  generatedAt: number;
  scoringConfigHash: string;
}

export interface ChallengeReadinessReadModel {
  scope: 'challenge';
  identity: { challengeId: string; branchId: string; generation: number; symbol: 'BTCUSDT'; mode: 'replay' };
  status: ReadinessEligibilityStatus;
  score: number | null;
  grade: ReadinessGrade | null;
  finality: ReadinessFinality;
  eligibility: ReadinessEligibility;
  components: readonly ReadinessComponent[];
  strengths: readonly ReadinessFactor[];
  weaknesses: readonly ReadinessFactor[];
  evidenceCounts: ReadinessEvidenceCounts;
  phaseResults: readonly ChallengeReadinessScopeResult[];
  provenance: ChallengeReadinessProvenance;
  version: ReadinessVersion;
}
