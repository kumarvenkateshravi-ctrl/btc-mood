import { describe, expect, it } from "vitest";

import {
  ChallengeTemplateSchema,
  InstrumentPolicySchema,
  validateInstrumentOrderValues,
} from "./configSchema";
import {
  BTC_INSTRUMENT_POLICY_V1,
  MYCRYPTOSTACK_ONE_STEP_V1,
  MYCRYPTOSTACK_TWO_STEP_V1,
} from "./templates";

function mutableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("Challenge v1 configuration schemas", () => {
  it("publishes BTC-only one-step and two-step templates", () => {
    expect(ChallengeTemplateSchema.parse(MYCRYPTOSTACK_ONE_STEP_V1).phases).toHaveLength(1);
    expect(ChallengeTemplateSchema.parse(MYCRYPTOSTACK_TWO_STEP_V1).phases).toHaveLength(2);
    expect(MYCRYPTOSTACK_ONE_STEP_V1.supportedSymbols).toEqual(["BTCUSDT"]);
    expect(MYCRYPTOSTACK_TWO_STEP_V1.phases.map((phase) => phase.sequence)).toEqual([1, 2]);
  });

  it("freezes the resolved executable grid separately from storage precision", () => {
    const policy = InstrumentPolicySchema.parse(BTC_INSTRUMENT_POLICY_V1);
    expect(policy).toMatchObject({
      symbol: "BTCUSDT",
      policyVersion: "mcs.btcusdt/1",
      priceScale: 6,
      quantityScale: 8,
      priceTick: "0.1",
      quantityStep: "0.00001",
      minimumQuantity: "0.00001",
      minimumNotional: "5",
    });
    expect(policy.quantityScale).toBeGreaterThan(
      policy.quantityStep.split(".")[1]?.length ?? 0,
    );
  });

  it("normalizes representation but never rounds an off-grid command", () => {
    expect(
      validateInstrumentOrderValues(BTC_INSTRUMENT_POLICY_V1, {
        price: "100.00",
        quantity: "0.05000",
      }),
    ).toEqual({ ok: true, price: "100", quantity: "0.05" });

    const offTick = validateInstrumentOrderValues(BTC_INSTRUMENT_POLICY_V1, {
      price: "100.03",
      quantity: "0.05",
    });
    expect(offTick.ok).toBe(false);
    if (!offTick.ok) expect(offTick.issues.map((issue) => issue.code)).toContain("OFF_TICK");

    const offStep = validateInstrumentOrderValues(BTC_INSTRUMENT_POLICY_V1, {
      price: "100",
      quantity: "0.000011",
    });
    expect(offStep.ok).toBe(false);
    if (!offStep.ok) expect(offStep.issues.map((issue) => issue.code)).toContain("OFF_STEP");
  });

  it("enforces minimum quantity and minimum notional exactly", () => {
    const belowMinimum = validateInstrumentOrderValues(BTC_INSTRUMENT_POLICY_V1, {
      price: "100",
      quantity: "0.000001",
    });
    expect(belowMinimum.ok).toBe(false);
    if (!belowMinimum.ok) {
      expect(belowMinimum.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["OFF_STEP", "BELOW_MINIMUM_QUANTITY", "BELOW_MINIMUM_NOTIONAL"]),
      );
    }

    const minimumNotional = validateInstrumentOrderValues(BTC_INSTRUMENT_POLICY_V1, {
      price: "100",
      quantity: "0.05",
    });
    expect(minimumNotional.ok).toBe(true);
  });

  it("rejects Gold and unknown symbols in Challenge v1", () => {
    const template = mutableClone(MYCRYPTOSTACK_ONE_STEP_V1) as Record<string, unknown>;
    template.supportedSymbols = ["XAUUSD"];
    expect(ChallengeTemplateSchema.safeParse(template).success).toBe(false);
  });

  it("rejects unknown rule kinds instead of ignoring them", () => {
    const template = mutableClone(MYCRYPTOSTACK_ONE_STEP_V1);
    (template.phases[0].rules as unknown[]).push({
      id: "phase-1.unknown",
      kind: "payoutConsistency",
      enforcement: "hard",
      enabled: true,
    });
    expect(ChallengeTemplateSchema.safeParse(template).success).toBe(false);
  });

  it("rejects unknown versions and mismatched instrument references", () => {
    const unknownVersion = mutableClone(MYCRYPTOSTACK_ONE_STEP_V1);
    unknownVersion.versions.accounting = "future-accounting/9";
    expect(ChallengeTemplateSchema.safeParse(unknownVersion).success).toBe(false);

    const mismatch = mutableClone(MYCRYPTOSTACK_ONE_STEP_V1);
    mismatch.executionPolicy.instrumentPolicyVersion = "mcs.btcusdt/2";
    expect(ChallengeTemplateSchema.safeParse(mismatch).success).toBe(false);
  });

  it("rejects invalid phase graphs and incomplete completion references", () => {
    const invalidGraph = mutableClone(MYCRYPTOSTACK_TWO_STEP_V1);
    invalidGraph.phases[0].transition.nextPhaseId = null;
    expect(ChallengeTemplateSchema.safeParse(invalidGraph).success).toBe(false);

    const incomplete = mutableClone(MYCRYPTOSTACK_ONE_STEP_V1);
    const completionIds = incomplete.phases[0].completion.allRuleIds as unknown as string[];
    completionIds.pop();
    expect(ChallengeTemplateSchema.safeParse(incomplete).success).toBe(false);

    const duplicated = mutableClone(MYCRYPTOSTACK_ONE_STEP_V1);
    const duplicatedIds = duplicated.phases[0].completion.allRuleIds as unknown as string[];
    duplicatedIds[1] = duplicatedIds[0];
    expect(ChallengeTemplateSchema.safeParse(duplicated).success).toBe(false);
  });
});
