import { describe, expect, it } from "vitest";

import {
  accountId,
  branchId,
  challengeId,
  instantMs,
  phaseId,
  replaySessionId,
} from "./types";
import {
  freezeChallengeDefinition,
  MYCRYPTOSTACK_ONE_STEP_V1,
  MYCRYPTOSTACK_TWO_STEP_V1,
  verifyFrozenChallengeDefinition,
} from "./templates";
import {
  canonicalHash,
  canonicalStringify,
  isCanonicalHash,
  sha256Hex,
} from "./versions";

function mutableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("challenge identity and canonical snapshots", () => {
  it("validates opaque domain identities and timestamps", () => {
    expect(challengeId("challenge:001")).toBe("challenge:001");
    expect(accountId("account_1")).toBe("account_1");
    expect(phaseId("phase-1")).toBe("phase-1");
    expect(branchId("branch.1")).toBe("branch.1");
    expect(replaySessionId("replay-1")).toBe("replay-1");
    expect(instantMs(0)).toBe(0);
    expect(() => challengeId("contains space")).toThrow();
    expect(() => instantMs(0.5)).toThrow();
  });

  it("implements standard SHA-256 and key-order-independent canonical hashing", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(canonicalStringify({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    );
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it("produces deterministic immutable snapshots with all dependency hashes", () => {
    const first = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "10000.00",
      selectedSymbol: "BTCUSDT",
      mode: "replay",
    });
    const second = freezeChallengeDefinition({
      template: mutableClone(MYCRYPTOSTACK_ONE_STEP_V1),
      selectedCapital: "10000",
      selectedSymbol: "BTCUSDT",
      mode: "replay",
    });

    expect(first).toEqual(second);
    expect(first.selectedCapital).toBe("10000");
    expect(first.instrumentPolicy.policyVersion).toBe("mcs.btcusdt/1");
    expect(first.executionPolicy.instrumentPolicyVersion).toBe(
      first.instrumentPolicy.policyVersion,
    );
    expect([
      first.templateHash,
      first.instrumentPolicyHash,
      first.calendarHash,
      first.definitionHash,
    ].every(isCanonicalHash)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.template.phases[0].rules)).toBe(true);
    expect(verifyFrozenChallengeDefinition(first)).toEqual(first);
  });

  it("binds hashes to capital, template, mode, and policy content", () => {
    const oneStep = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "10000",
      selectedSymbol: "BTCUSDT",
      mode: "replay",
    });
    const twoStep = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_TWO_STEP_V1,
      selectedCapital: "10000",
      selectedSymbol: "BTCUSDT",
      mode: "replay",
    });
    const differentCapital = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "25000",
      selectedSymbol: "BTCUSDT",
      mode: "replay",
    });
    const futureLive = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "10000",
      selectedSymbol: "BTCUSDT",
      mode: "live",
    });

    expect(new Set([
      oneStep.definitionHash,
      twoStep.definitionHash,
      differentCapital.definitionHash,
      futureLive.definitionHash,
    ]).size).toBe(4);
  });

  it("detects snapshot tampering", () => {
    const definition = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "10000",
      selectedSymbol: "BTCUSDT",
      mode: "replay",
    });
    const tampered = mutableClone(definition);
    (tampered as unknown as { selectedCapital: string }).selectedCapital = "25000";

    expect(() => verifyFrozenChallengeDefinition(tampered)).toThrow(
      "Frozen definition hash mismatch",
    );
  });

  it("requires explicit supported selections and applies no hidden defaults", () => {
    expect(() =>
      freezeChallengeDefinition({
        template: MYCRYPTOSTACK_ONE_STEP_V1,
        selectedCapital: "5000",
        selectedSymbol: "BTCUSDT",
        mode: "replay",
      }),
    ).toThrow("not offered");

    expect(() =>
      freezeChallengeDefinition({
        template: MYCRYPTOSTACK_ONE_STEP_V1,
        selectedCapital: "10000",
        selectedSymbol: "XAUUSD",
        mode: "replay",
      }),
    ).toThrow("not supported");
  });

  it("freezes the approved phase reset and target rules", () => {
    const definition = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_TWO_STEP_V1,
      selectedCapital: "10000",
      selectedSymbol: "BTCUSDT",
      mode: "replay",
    });
    const [phaseOne, phaseTwo] = definition.template.phases;
    const targetOne = phaseOne.rules.find((rule) => rule.kind === "profitTarget");
    const targetTwo = phaseTwo.rules.find((rule) => rule.kind === "profitTarget");

    expect(targetOne?.kind === "profitTarget" && targetOne.amount).toMatchObject({
      kind: "percentage",
      rate: "0.1",
    });
    expect(targetTwo?.kind === "profitTarget" && targetTwo.amount).toMatchObject({
      kind: "percentage",
      rate: "0.08",
    });
    expect(phaseOne.transition).toEqual({
      nextPhaseId: "phase-2",
      capital: "resetToSelectedCapital",
      counters: "reset",
      drawdownReferences: "reset",
      positionsAndOrders: "clear",
      nextPhaseTrading: "nextCausalObservation",
    });
    expect(phaseTwo.transition.nextPhaseId).toBeNull();
  });
});
