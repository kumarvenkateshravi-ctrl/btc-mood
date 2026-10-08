import { deepFreeze } from "../domain/versions";

export const EXECUTION_CHECKPOINT_VERSION =
  "mcs.challenge.execution-checkpoint/1";

/**
 * Every Task 2 command, including marks, protection changes, working-order
 * actions, cancellations, and rejected commands, becomes lifecycle-eligible
 * only after one explicit checkpoint covering its complete fact batch.
 * UTC day boundaries are inherently stable. Logical-clock checkpoints remain
 * a future rule-engine input and are not introduced by Task 3A.
 */
export const EXECUTION_CHECKPOINT_POLICY_V1 = deepFreeze({
  checkpointVersion: EXECUTION_CHECKPOINT_VERSION,
  executionCommandBoundary: "explicitAfterCompleteFactBatch" as const,
  interleavedCommands: "reject" as const,
  markObservation: "explicitCommandCheckpoint" as const,
  protectionModification: "explicitCommandCheckpoint" as const,
  workingOrderAction: "explicitCommandCheckpoint" as const,
  rejectedCommand: "explicitCommandCheckpoint" as const,
  dayBoundary: "inherentlyStable" as const,
  logicalClockAdvance: "deferredToRuleEngine" as const,
});