import { deepFreeze } from "../domain/versions";
import {
  evaluateStableCheckpoint,
  initializeChallengeRuleLifecycle,
} from "./engine";
import type {
  ChallengeRuleLifecycleState,
  RebuildRuleLifecycleInput,
  RebuildRuleLifecycleResult,
  RuleEngineResult,
} from "./types";

export function rebuildChallengeRuleLifecycle(
  input: RebuildRuleLifecycleInput,
): RebuildRuleLifecycleResult {
  let state = initializeChallengeRuleLifecycle(input);
  const results: RuleEngineResult[] = [];
  for (const account of input.stableAccounts) {
    const result = evaluateStableCheckpoint(state, account, input.definition);
    results.push(result);
    if (result.status !== "applied") {
      throw new RangeError(
        `Rule lifecycle rebuild rejected checkpoint: ${result.rejection.code} ${result.rejection.message}`,
      );
    }
    state = result.state;
  }
  return deepFreeze({ state, results });
}

export function rebuildChallengeRuleLifecyclePrefix(
  input: RebuildRuleLifecycleInput,
  checkpointCount: number,
): ChallengeRuleLifecycleState {
  if (
    !Number.isSafeInteger(checkpointCount) ||
    checkpointCount < 0 ||
    checkpointCount > input.stableAccounts.length
  ) {
    throw new RangeError("Rule lifecycle prefix is outside the checkpoint stream.");
  }
  return rebuildChallengeRuleLifecycle({
    ...input,
    stableAccounts: input.stableAccounts.slice(0, checkpointCount),
  }).state;
}