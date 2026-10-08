import {
  parseChallengeTemplate,
  parseFrozenChallengeDefinition,
} from "./configSchema";
import { UTC_DAY_BOUNDARY_POLICY } from "./calendar";
import { decimalText, moneyFromDecimal, normalizeDecimalText } from "./money";
import type {
  ChallengeMode,
  ChallengeRule,
  ChallengeTemplate,
  FrozenChallengeDefinition,
  InstrumentPolicy,
  PhaseDefinition,
  SymbolId,
} from "./types";
import {
  canonicalClone,
  canonicalHash,
  deepFreeze,
  DOMAIN_VERSIONS,
  frozenDefinitionHashBasis,
  SNAPSHOT_VERSION,
  assertSupportedDomainVersions,
} from "./versions";

export const BTC_INSTRUMENT_POLICY_V1: Readonly<InstrumentPolicy> = deepFreeze({
  symbol: "BTCUSDT",
  policyVersion: "mcs.btcusdt/1",
  priceScale: 6,
  quantityScale: 8,
  priceTick: decimalText("0.1"),
  quantityStep: decimalText("0.00001"),
  minimumQuantity: decimalText("0.00001"),
  minimumNotional: decimalText("5"),
  priceRounding: {
    command: "reject",
    derived: "adverse",
  },
  quantityRounding: {
    command: "reject",
    derived: "towardZero",
  },
});

export const BTC_EXECUTION_POLICY_V1 = deepFreeze({
  policyId: "mcs-btc-challenge",
  policyVersion: "mcs.btc-execution/1",
  instrumentPolicyVersion: BTC_INSTRUMENT_POLICY_V1.policyVersion,
  commissionRate: decimalText("0.001"),
  marketSlippageTicks: 1,
  normalStopCrossing: "stopPrice" as const,
  gapThroughStop: "firstObservableAdverse" as const,
  commandGridValidation: "reject" as const,
  reversalProtection: "reset" as const,
  replayIntrabarPath: {
    upCandle: ["open", "low", "high", "close"] as const,
    downCandle: ["open", "high", "low", "close"] as const,
  },
});

const warningPolicy = deepFreeze({
  warningConsumed: decimalText("0.8"),
  dangerConsumed: decimalText("0.95"),
  rearmBelow: decimalText("0.75"),
});

function phaseRules(phaseKey: string, targetRate: string): readonly ChallengeRule[] {
  return deepFreeze([
    {
      id: `${phaseKey}.daily-loss`,
      kind: "loss",
      enforcement: "hard",
      enabled: true,
      window: "daily",
      method: "static",
      observed: "equity",
      anchor: "dayStartCash",
      allowance: {
        kind: "percentage",
        rate: decimalText("0.05"),
        basis: "phaseStartingCash",
      },
      breachAt: "atOrBelowFloor",
      warnings: warningPolicy,
    },
    {
      id: `${phaseKey}.maximum-loss`,
      kind: "loss",
      enforcement: "hard",
      enabled: true,
      window: "phase",
      method: "static",
      observed: "equity",
      anchor: "phaseStartingCash",
      allowance: {
        kind: "percentage",
        rate: decimalText("0.1"),
        basis: "phaseStartingCash",
      },
      breachAt: "atOrBelowFloor",
      warnings: warningPolicy,
    },
    {
      id: `${phaseKey}.profit-target`,
      kind: "profitTarget",
      enforcement: "hard",
      enabled: true,
      observed: "cash",
      reference: "phaseStartingCash",
      amount: {
        kind: "percentage",
        rate: decimalText(targetRate),
        basis: "phaseStartingCash",
      },
      reachedAt: "atOrAboveTarget",
      requireFlat: true,
      requireNoWorkingOrders: true,
    },
    {
      id: `${phaseKey}.active-days`,
      kind: "activeDays",
      enforcement: "hard",
      enabled: true,
      required: 3,
      qualifiesOn: "exposureIncreasingFill",
      finalization: "dayClose",
    },
    {
      id: `${phaseKey}.profitable-days`,
      kind: "profitableDays",
      enforcement: "hard",
      enabled: true,
      required: 3,
      pnlBasis: "feeCompleteSettledPnl",
      threshold: {
        kind: "percentage",
        rate: decimalText("0.001"),
        basis: "phaseStartingCash",
      },
      finalization: "dayClose",
      requireActiveDay: true,
    },
    {
      id: `${phaseKey}.inactivity`,
      kind: "inactivity",
      enforcement: "hard",
      enabled: true,
      limitDays: 30,
      clock: "elapsedUtcDays",
      qualifiesOn: "exposureIncreasingFill",
      deadlineAt: "inclusive",
    },
    {
      id: `${phaseKey}.leverage`,
      kind: "leverage",
      enforcement: "hard",
      enabled: true,
      maximum: decimalText("20"),
      enforcementPoint: "exposureAdmission",
      appliesTo: ["entry", "increase", "reversalResidual"],
      reductionsAlwaysPermitted: true,
    },
  ] satisfies ChallengeRule[]);
}

function phase(
  id: string,
  sequence: number,
  targetRate: string,
  nextPhaseId: string | null,
): PhaseDefinition {
  const rules = phaseRules(id, targetRate);
  return deepFreeze({
    id,
    sequence,
    name: `Phase ${sequence}`,
    rules,
    completion: {
      allRuleIds: rules.map((rule) => rule.id),
      requireFlat: true,
      requireNoWorkingOrders: true,
      simultaneousOutcome: "hardBreachWins",
    },
    transition: {
      nextPhaseId,
      capital: "resetToSelectedCapital",
      counters: "reset",
      drawdownReferences: "reset",
      positionsAndOrders: "clear",
      nextPhaseTrading: "nextCausalObservation",
    },
  });
}

const COMMON_TEMPLATE = {
  displayName: "MyCryptoStack Practice Challenge",
  status: "PUBLISHED" as const,
  supportedSymbols: ["BTCUSDT"] as const,
  startingCapitalOptions: [
    decimalText("10000"),
    decimalText("25000"),
    decimalText("50000"),
    decimalText("100000"),
  ],
  instrumentPolicies: [BTC_INSTRUMENT_POLICY_V1],
  executionPolicy: BTC_EXECUTION_POLICY_V1,
  calendar: UTC_DAY_BOUNDARY_POLICY,
  versions: DOMAIN_VERSIONS,
  source: {
    origin: "internal" as const,
    name: "MyCryptoStack" as const,
  },
};

export const MYCRYPTOSTACK_ONE_STEP_V1: Readonly<ChallengeTemplate> = deepFreeze(
  parseChallengeTemplate({
    ...COMMON_TEMPLATE,
    templateId: "mcs-practice-one-step",
    templateVersion: "1",
    challengeType: "oneStep",
    phases: [phase("phase-1", 1, "0.1", null)],
  }),
);

export const MYCRYPTOSTACK_TWO_STEP_V1: Readonly<ChallengeTemplate> = deepFreeze(
  parseChallengeTemplate({
    ...COMMON_TEMPLATE,
    templateId: "mcs-practice-two-step",
    templateVersion: "1",
    challengeType: "twoStep",
    phases: [
      phase("phase-1", 1, "0.1", "phase-2"),
      phase("phase-2", 2, "0.08", null),
    ],
  }),
);

export const INTERNAL_CHALLENGE_TEMPLATES = deepFreeze([
  MYCRYPTOSTACK_ONE_STEP_V1,
  MYCRYPTOSTACK_TWO_STEP_V1,
]);

export interface FreezeChallengeDefinitionInput {
  template: unknown;
  selectedCapital: string;
  selectedSymbol: string;
  mode: ChallengeMode;
}

export function freezeChallengeDefinition(
  input: FreezeChallengeDefinitionInput,
): Readonly<FrozenChallengeDefinition> {
  const template = parseChallengeTemplate(input.template);
  const selectedCapital = normalizeDecimalText(input.selectedCapital);
  moneyFromDecimal(selectedCapital);

  if (!template.startingCapitalOptions.includes(selectedCapital)) {
    throw new RangeError(`Starting capital "${selectedCapital}" is not offered by this template.`);
  }
  if (input.selectedSymbol !== "BTCUSDT" || !template.supportedSymbols.includes(input.selectedSymbol)) {
    throw new RangeError(`Symbol "${input.selectedSymbol}" is not supported by this BTC-only template.`);
  }
  if (input.mode !== "replay" && input.mode !== "live") {
    throw new RangeError(`Challenge mode "${String(input.mode)}" is not supported.`);
  }

  assertSupportedDomainVersions(template.versions);
  const selectedSymbol = input.selectedSymbol as SymbolId;
  const instrumentPolicy = template.instrumentPolicies.find(
    (candidate) =>
      candidate.symbol === selectedSymbol &&
      candidate.policyVersion === template.executionPolicy.instrumentPolicyVersion,
  );
  if (!instrumentPolicy) {
    throw new RangeError("Template does not resolve one matching frozen InstrumentPolicy.");
  }

  const templateSnapshot = canonicalClone(template);
  const instrumentSnapshot = canonicalClone(instrumentPolicy);
  const executionSnapshot = canonicalClone(template.executionPolicy);
  const calendarSnapshot = canonicalClone(template.calendar);
  const versionsSnapshot = canonicalClone(template.versions);

  const basis: Omit<FrozenChallengeDefinition, "definitionHash"> = {
    snapshotVersion: SNAPSHOT_VERSION,
    template: templateSnapshot,
    selectedCapital,
    selectedSymbol,
    mode: input.mode,
    instrumentPolicy: instrumentSnapshot,
    executionPolicy: executionSnapshot,
    calendar: calendarSnapshot,
    versions: versionsSnapshot,
    templateHash: canonicalHash(templateSnapshot),
    instrumentPolicyHash: canonicalHash(instrumentSnapshot),
    calendarHash: canonicalHash(calendarSnapshot),
  };
  const definition = parseFrozenChallengeDefinition({
    ...basis,
    definitionHash: canonicalHash(basis),
  });
  return deepFreeze(definition);
}

export function verifyFrozenChallengeDefinition(
  input: unknown,
): Readonly<FrozenChallengeDefinition> {
  const definition = parseFrozenChallengeDefinition(input);
  assertSupportedDomainVersions(definition.versions);

  if (!definition.template.startingCapitalOptions.includes(definition.selectedCapital)) {
    throw new RangeError("Frozen capital is not offered by its template.");
  }
  if (!definition.template.supportedSymbols.includes(definition.selectedSymbol)) {
    throw new RangeError("Frozen symbol is not supported by its template.");
  }
  const templateInstrument = definition.template.instrumentPolicies.find((candidate) =>
    candidate.symbol === definition.selectedSymbol &&
    candidate.policyVersion === definition.executionPolicy.instrumentPolicyVersion,
  );
  if (!templateInstrument || canonicalHash(templateInstrument) !== canonicalHash(definition.instrumentPolicy)) {
    throw new RangeError("Frozen instrument policy is not bound to its template.");
  }
  if (canonicalHash(definition.template.executionPolicy) !== canonicalHash(definition.executionPolicy)) {
    throw new RangeError("Frozen execution policy is not bound to its template.");
  }
  if (canonicalHash(definition.template.calendar) !== canonicalHash(definition.calendar)) {
    throw new RangeError("Frozen calendar is not bound to its template.");
  }
  if (canonicalHash(definition.template.versions) !== canonicalHash(definition.versions)) {
    throw new RangeError("Frozen versions are not bound to their template.");
  }

  if (definition.templateHash !== canonicalHash(definition.template)) {
    throw new RangeError("Frozen template hash mismatch.");
  }
  if (definition.instrumentPolicyHash !== canonicalHash(definition.instrumentPolicy)) {
    throw new RangeError("Frozen instrument policy hash mismatch.");
  }
  if (definition.calendarHash !== canonicalHash(definition.calendar)) {
    throw new RangeError("Frozen calendar hash mismatch.");
  }
  if (definition.definitionHash !== canonicalHash(frozenDefinitionHashBasis(definition))) {
    throw new RangeError("Frozen definition hash mismatch.");
  }
  if (
    definition.executionPolicy.instrumentPolicyVersion !==
    definition.instrumentPolicy.policyVersion
  ) {
    throw new RangeError("Frozen execution and instrument policy versions do not match.");
  }
  return deepFreeze(canonicalClone(definition));
}
