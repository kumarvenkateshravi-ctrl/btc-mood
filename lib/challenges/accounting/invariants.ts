import { moneyFromAtoms } from "../domain/money";
import type { ChallengeAccountState, AccountInvariantResult } from "./types";

export function accountInvariantErrors(
  state: ChallengeAccountState,
): readonly string[] {
  const errors: string[] = [];
  if (state.phaseStartedAt > state.lastOccurredAt) {
    errors.push("phaseStartedAt cannot follow the latest accounting input.");
  }
  const expectedCash = moneyFromAtoms(
    state.phaseStartingCash +
      state.realizedGrossPnl -
      state.totalCommissions +
      state.cumulativeCapitalAdjustments,
  );
  if (state.cashBalance !== expectedCash) {
    errors.push("cashBalance does not reconcile.");
  }
  if (state.equity !== state.cashBalance + state.unrealizedPnl) {
    errors.push("equity does not equal cash plus unrealized P&L.");
  }
  if (
    state.freeMargin !==
    state.equity - state.usedMargin - state.reservedMargin
  ) {
    errors.push("freeMargin does not reconcile.");
  }
  if (
    state.day.daySettledNetPnl !==
    state.day.dayRealizedGrossPnl - state.day.dayCommissions
  ) {
    errors.push("daySettledNetPnl does not reconcile.");
  }
  if (
    state.day.dayBalanceChange !==
    state.cashBalance -
      state.day.dayStartCash -
      state.day.dayCapitalAdjustments
  ) {
    errors.push("dayBalanceChange does not reconcile.");
  }
  if (
    state.day.dayUnrealizedChange !==
    state.unrealizedPnl - state.day.dayUnrealizedStart
  ) {
    errors.push("dayUnrealizedChange does not reconcile.");
  }
  if (
    state.day.dayEquityChange !==
    state.equity -
      state.day.dayStartEquity -
      state.day.dayCapitalAdjustments
  ) {
    errors.push("dayEquityChange does not reconcile.");
  }
  if (
    state.day.dayEquityChange !==
    state.day.dayBalanceChange + state.day.dayUnrealizedChange
  ) {
    errors.push("day equity-change identity does not reconcile.");
  }
  const postedGross = state.postings
    .filter((posting) => posting.kind === "realizedGrossPnl")
    .reduce((sum, posting) => sum + posting.amount, BigInt(0));
  if (postedGross !== state.realizedGrossPnl) {
    errors.push("realized gross P&L does not equal its unique postings.");
  }
  const postedFees = state.postings
    .filter((posting) => posting.kind === "commissionDebit")
    .reduce((sum, posting) => sum + posting.amount, BigInt(0));
  if (postedFees !== state.totalCommissions) {
    errors.push("total commissions do not equal commission postings.");
  }
  const postedCashDelta = state.postings
    .reduce((sum, posting) => sum + posting.cashDelta, BigInt(0));
  if (
    state.cashBalance !==
    state.phaseStartingCash + postedCashDelta +
      state.cumulativeCapitalAdjustments
  ) {
    errors.push("cash balance does not equal posting cash deltas.");
  }
  if (state.postings.some((posting) =>
      posting.kind !== "realizedGrossPnl" &&
      posting.kind !== "commissionDebit" &&
      posting.cashDelta !== BigInt(0))) {
    errors.push("a non-cash posting changed cash.");
  }
  if (new Set(state.postings.map((posting) => posting.postingId)).size !==
      state.postings.length) {
    errors.push("ledger posting identities are not unique.");
  }
  if (state.fills.length !== state.appliedFillIds.length ||
      state.fills.some((record, index) =>
        record.fill.fillId !== state.appliedFillIds[index])) {
    errors.push("canonical fill journal does not match applied fill identities.");
  }
  if (new Set(state.appliedFillIds).size !== state.appliedFillIds.length ||
      new Set(state.commissionedFillIds).size !==
        state.commissionedFillIds.length ||
      new Set(state.allocatedCloseFillIds).size !==
        state.allocatedCloseFillIds.length) {
    errors.push("fill reconciliation identities are not unique.");
  }
  if ((state.projectionStability === "STABLE") !==
      (state.pendingExecutionCommand === null)) {
    errors.push("projection stability disagrees with pending command state.");
  }
  const pending = state.pendingExecutionCommand;
  if (pending && (
    pending.factIds.length === 0 ||
    pending.lastFactSequence - pending.firstFactSequence + 1 !==
      pending.factIds.length ||
    pending.lastFactSequence !== state.lastExecutionFactSequence
  )) {
    errors.push("pending command fact range does not reconcile.");
  }
  if (state.stableCheckpointSequence !== state.checkpoints.length ||
      state.appliedCheckpointIds.length !== state.checkpoints.length ||
      state.checkpoints.some((checkpoint, index) =>
        checkpoint.checkpointSequence !== index + 1 ||
        checkpoint.checkpointId !== state.appliedCheckpointIds[index])) {
    errors.push("stable checkpoint sequence does not reconcile.");
  }
  const executionCheckpoints = state.checkpoints.filter(
    (checkpoint) => checkpoint.kind === "executionCommand",
  );
  if (executionCheckpoints.length !== state.committedCommandIds.length ||
      executionCheckpoints.some((checkpoint, index) =>
        checkpoint.commandId !== state.committedCommandIds[index])) {
    errors.push("committed command identities do not reconcile.");
  }
  if (new Set(state.appliedCheckpointIds).size !==
      state.appliedCheckpointIds.length ||
      new Set(state.committedCommandIds).size !==
        state.committedCommandIds.length) {
    errors.push("checkpoint or committed-command identities are not unique.");
  }
  const lastCheckpoint = state.checkpoints.length > 0
    ? state.checkpoints[state.checkpoints.length - 1]
    : null;
  if ((state.lastStableCheckpoint?.checkpointId ?? null) !==
      (lastCheckpoint?.checkpointId ?? null)) {
    errors.push("last stable checkpoint does not match checkpoint history.");
  }
  if (state.projectionStability === "STABLE" && lastCheckpoint && (
    lastCheckpoint.stableAccountRevision !== state.revision ||
    lastCheckpoint.stableLedgerHash !== state.ledgerHash
  )) {
    errors.push("stable projection does not match its checkpoint revision/hash.");
  }
  if (state.position === null && state.unrealizedPnl !== BigInt(0)) {
    errors.push("flat state and unrealized P&L disagree.");
  }
  if (state.position === null && state.grossExposure !== BigInt(0)) {
    errors.push("flat state has gross exposure.");
  }
  if (state.usedMargin < BigInt(0) || state.reservedMargin < BigInt(0)) {
    errors.push("margin cannot be negative.");
  }
  if (state.revision !== state.appliedInputIds.length) {
    errors.push("revision does not equal applied input count.");
  }
  return Object.freeze(errors);
}

export function verifyAccountInvariants(
  state: ChallengeAccountState,
): AccountInvariantResult {
  const errors = accountInvariantErrors(state);
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function assertAccountInvariants(state: ChallengeAccountState): void {
  const errors = accountInvariantErrors(state);
  if (errors.length > 0) {
    throw new RangeError(errors.join(" "));
  }
}
