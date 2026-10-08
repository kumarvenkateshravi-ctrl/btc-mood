import { deepFreeze } from "../domain/versions";
import {
  applyChallengeAccountInput,
  initializeChallengeAccount,
} from "./ledger";
import type {
  ChallengeAccountState,
  RebuildChallengeAccountInput,
  RebuildChallengeAccountResult,
} from "./types";

export function rebuildChallengeAccount(
  input: RebuildChallengeAccountInput,
): RebuildChallengeAccountResult {
  let state = initializeChallengeAccount(input);
  const results = [];
  for (const ledgerInput of input.inputs) {
    const result = applyChallengeAccountInput(
      state,
      ledgerInput,
      input.definition,
    );
    results.push(result);
    if (result.status !== "applied") {
      throw new RangeError(
        "Account rebuild rejected " +
          (result.rejection.inputId ?? "unknown input") +
          ": " +
          result.rejection.code +
          " " +
          result.rejection.message,
      );
    }
    state = result.state;
  }
  return deepFreeze({ state, results });
}

export function rebuildChallengeAccountPrefix(
  input: RebuildChallengeAccountInput,
  inputCount: number,
): ChallengeAccountState {
  if (
    !Number.isSafeInteger(inputCount) ||
    inputCount < 0 ||
    inputCount > input.inputs.length
  ) {
    throw new RangeError("Rebuild prefix count is outside the input stream.");
  }
  return rebuildChallengeAccount({
    ...input,
    inputs: input.inputs.slice(0, inputCount),
  }).state;
}