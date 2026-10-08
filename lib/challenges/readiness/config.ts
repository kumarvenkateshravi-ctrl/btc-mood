import { canonicalHash, deepFreeze } from '../domain/versions';
import { CHALLENGE_READINESS_VERSION, type ReadinessComponentKey, type ReadinessGrade } from './types';

export interface ChallengeReadinessConfigV1 {
  version: typeof CHALLENGE_READINESS_VERSION;
  eligibility: { minimumCompletedLifecycles: number; minimumFinalizedActiveDays: number; minimumRiskObservations: number };
  weights: Readonly<Record<ReadinessComponentKey, number>>;
  grades: readonly { minimum: number; grade: ReadinessGrade }[];
  risk: { peakCapacityPoints: number; averageDailyPoints: number; warningPenalty: number; warningCap: number; dangerPenalty: number; dangerCap: number; lossBreachPenalty: number; lossBreachCap: number };
  consistency: { positiveSharePoints: number; stabilityPoints: number; concentrationPoints: number; fullDispersionBasisPoints: number; concentrationFreeBasisPoints: number };
  profitability: { netReturnPoints: number; netReturnFloorBasisPoints: number; netReturnCeilingBasisPoints: number; profitBalancePoints: number; feeEfficiencyPoints: number; fullFeeDragBasisPoints: number };
  execution: { reversalPenaltyPoints: number; churnPenaltyPerExit: number; churnPenaltyCap: number; freeExitFillsPerLifecycle: number; feeDragPenaltyPoints: number; fullFeeDragBasisPoints: number };
  rules: { warningPenalty: number; warningCap: number; dangerPenalty: number; dangerCap: number; breachPenalty: number; breachCap: number; inactivityPenalty: number; inactivityCap: number; terminalActiveDayShortfallPoints: number; terminalProfitableDayShortfallPoints: number };
}

export const CHALLENGE_READINESS_CONFIG_V1: Readonly<ChallengeReadinessConfigV1> = deepFreeze({
  version: CHALLENGE_READINESS_VERSION,
  eligibility: { minimumCompletedLifecycles: 3, minimumFinalizedActiveDays: 3, minimumRiskObservations: 3 },
  weights: { riskDiscipline: 30, consistency: 25, profitabilityQuality: 20, executionControl: 15, ruleDiscipline: 10 },
  grades: [
    { minimum: 90, grade: 'EXCELLENT' }, { minimum: 80, grade: 'STRONG' },
    { minimum: 70, grade: 'DEVELOPING' }, { minimum: 60, grade: 'WEAK' },
    { minimum: 0, grade: 'NOT_READY' },
  ],
  risk: { peakCapacityPoints: 45, averageDailyPoints: 15, warningPenalty: 3, warningCap: 9, dangerPenalty: 8, dangerCap: 16, lossBreachPenalty: 24, lossBreachCap: 48 },
  consistency: { positiveSharePoints: 60, stabilityPoints: 25, concentrationPoints: 15, fullDispersionBasisPoints: 200, concentrationFreeBasisPoints: 5000 },
  profitability: { netReturnPoints: 50, netReturnFloorBasisPoints: -500, netReturnCeilingBasisPoints: 1000, profitBalancePoints: 30, feeEfficiencyPoints: 20, fullFeeDragBasisPoints: 2000 },
  execution: { reversalPenaltyPoints: 30, churnPenaltyPerExit: 8, churnPenaltyCap: 24, freeExitFillsPerLifecycle: 3, feeDragPenaltyPoints: 20, fullFeeDragBasisPoints: 2000 },
  rules: { warningPenalty: 2, warningCap: 8, dangerPenalty: 3, dangerCap: 9, breachPenalty: 8, breachCap: 16, inactivityPenalty: 30, inactivityCap: 60, terminalActiveDayShortfallPoints: 12, terminalProfitableDayShortfallPoints: 8 },
});

export const CHALLENGE_READINESS_CONFIG_V1_HASH = canonicalHash(CHALLENGE_READINESS_CONFIG_V1);
