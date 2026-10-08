import { z } from "zod";

import {
  isCanonicalDecimalText,
  moneyFromDecimal,
  normalizeDecimalText,
  parseScaledDecimal,
  ppmFromRate,
  USD_MICRO_SCALE,
} from "./money";
import type {
  ChallengeTemplate,
  FrozenChallengeDefinition,
  InstrumentPolicy,
} from "./types";
import {
  ACCOUNTING_VERSION,
  CALENDAR_VERSION,
  EXECUTION_VERSION,
  ROUNDING_VERSION,
  RULES_VERSION,
  SCHEMA_VERSION,
  SNAPSHOT_VERSION,
} from "./versions";

const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const versionSchema = z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/);
const canonicalDecimalSchema = z.string().refine(isCanonicalDecimalText, {
  message: "Expected canonical base-10 decimal text.",
});
const positiveDecimalSchema = canonicalDecimalSchema.refine((value) => {
  try {
    return parseScaledDecimal(value, 18) > BigInt(0);
  } catch {
    return false;
  }
}, { message: "Expected a positive decimal with at most 18 fractional digits." });
const rateSchema = canonicalDecimalSchema.refine((value) => {
  try {
    ppmFromRate(value);
    return true;
  } catch {
    return false;
  }
}, { message: "Expected a rate from 0 through 1 with at most six fractional digits." });

const percentageAllowanceSchema = z.object({
  kind: z.literal("percentage"),
  rate: rateSchema,
  basis: z.literal("phaseStartingCash"),
}).strict();

const absoluteAllowanceSchema = z.object({
  kind: z.literal("absolute"),
  amount: positiveDecimalSchema,
}).strict();

const allowanceSchema = z.discriminatedUnion("kind", [
  percentageAllowanceSchema,
  absoluteAllowanceSchema,
]);

const warningPolicySchema = z.object({
  warningConsumed: rateSchema,
  dangerConsumed: rateSchema,
  rearmBelow: rateSchema,
}).strict().superRefine((value, context) => {
  const warning = ppmFromRate(value.warningConsumed);
  const danger = ppmFromRate(value.dangerConsumed);
  const rearm = ppmFromRate(value.rearmBelow);
  if (!(rearm < warning && warning < danger)) {
    context.addIssue({
      code: "custom",
      message: "Warning thresholds must satisfy rearmBelow < warningConsumed < dangerConsumed.",
    });
  }
});

const baseRule = {
  id: idSchema,
  enforcement: z.enum(["hard", "advisory"]),
  enabled: z.boolean(),
};

const lossRuleSchema = z.object({
  ...baseRule,
  kind: z.literal("loss"),
  window: z.enum(["daily", "phase"]),
  method: z.enum(["static", "trailing"]),
  observed: z.literal("equity"),
  anchor: z.enum(["phaseStartingCash", "dayStartCash", "peakEquity"]),
  allowance: allowanceSchema,
  breachAt: z.literal("atOrBelowFloor"),
  highWaterUpdate: z.enum(["eachObservation", "dayClose"]).optional(),
  warnings: warningPolicySchema,
}).strict().superRefine((value, context) => {
  if (value.window === "daily" && (value.anchor !== "dayStartCash" || value.method !== "static")) {
    context.addIssue({
      code: "custom",
      message: "Challenge v1 daily loss must be static and anchored to dayStartCash.",
    });
  }
  if (value.method === "trailing" && value.anchor !== "peakEquity") {
    context.addIssue({
      code: "custom",
      message: "A trailing loss rule must be anchored to peakEquity.",
    });
  }
});

const profitTargetRuleSchema = z.object({
  ...baseRule,
  kind: z.literal("profitTarget"),
  observed: z.literal("cash"),
  reference: z.literal("phaseStartingCash"),
  amount: allowanceSchema,
  reachedAt: z.literal("atOrAboveTarget"),
  requireFlat: z.literal(true),
  requireNoWorkingOrders: z.literal(true),
}).strict();

const activeDaysRuleSchema = z.object({
  ...baseRule,
  kind: z.literal("activeDays"),
  required: z.number().int().positive(),
  qualifiesOn: z.literal("exposureIncreasingFill"),
  finalization: z.literal("dayClose"),
}).strict();

const profitableDaysRuleSchema = z.object({
  ...baseRule,
  kind: z.literal("profitableDays"),
  required: z.number().int().positive(),
  pnlBasis: z.literal("feeCompleteSettledPnl"),
  threshold: percentageAllowanceSchema,
  finalization: z.literal("dayClose"),
  requireActiveDay: z.literal(true),
}).strict();

const inactivityRuleSchema = z.object({
  ...baseRule,
  kind: z.literal("inactivity"),
  limitDays: z.number().int().positive(),
  clock: z.literal("elapsedUtcDays"),
  qualifiesOn: z.literal("exposureIncreasingFill"),
  deadlineAt: z.literal("inclusive"),
}).strict();

const leverageRuleSchema = z.object({
  ...baseRule,
  kind: z.literal("leverage"),
  maximum: positiveDecimalSchema,
  enforcementPoint: z.literal("exposureAdmission"),
  appliesTo: z.tuple([
    z.literal("entry"),
    z.literal("increase"),
    z.literal("reversalResidual"),
  ]),
  reductionsAlwaysPermitted: z.literal(true),
}).strict();

export const ChallengeRuleSchema = z.discriminatedUnion("kind", [
  lossRuleSchema,
  profitTargetRuleSchema,
  activeDaysRuleSchema,
  profitableDaysRuleSchema,
  inactivityRuleSchema,
  leverageRuleSchema,
]);

const roundingPolicySchema = z.object({
  command: z.literal("reject"),
  derived: z.enum(["adverse", "towardZero"]),
}).strict();

export const InstrumentPolicySchema = z.object({
  symbol: z.literal("BTCUSDT"),
  policyVersion: versionSchema,
  priceScale: z.number().int().min(0).max(18),
  quantityScale: z.number().int().min(0).max(18),
  priceTick: positiveDecimalSchema,
  quantityStep: positiveDecimalSchema,
  minimumQuantity: positiveDecimalSchema,
  minimumNotional: positiveDecimalSchema,
  priceRounding: roundingPolicySchema,
  quantityRounding: roundingPolicySchema,
}).strict().superRefine((value, context) => {
  try {
    const tick = parseScaledDecimal(value.priceTick, value.priceScale);
    const step = parseScaledDecimal(value.quantityStep, value.quantityScale);
    const minimumQuantity = parseScaledDecimal(value.minimumQuantity, value.quantityScale);
    moneyFromDecimal(value.minimumNotional);

    if (tick <= BigInt(0)) {
      context.addIssue({ code: "custom", path: ["priceTick"], message: "Price tick must be positive." });
    }
    if (step <= BigInt(0)) {
      context.addIssue({ code: "custom", path: ["quantityStep"], message: "Quantity step must be positive." });
    }
    if (minimumQuantity < step || minimumQuantity % step !== BigInt(0)) {
      context.addIssue({
        code: "custom",
        path: ["minimumQuantity"],
        message: "Minimum quantity must be at least one step and an exact step multiple.",
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid instrument scale.",
    });
  }
});

export const ExecutionPolicySchema = z.object({
  policyId: idSchema,
  policyVersion: versionSchema,
  instrumentPolicyVersion: versionSchema,
  commissionRate: rateSchema,
  marketSlippageTicks: z.number().int().nonnegative(),
  normalStopCrossing: z.literal("stopPrice"),
  gapThroughStop: z.literal("firstObservableAdverse"),
  commandGridValidation: z.literal("reject"),
  reversalProtection: z.literal("reset"),
  replayIntrabarPath: z.object({
    upCandle: z.tuple([
      z.literal("open"),
      z.literal("low"),
      z.literal("high"),
      z.literal("close"),
    ]),
    downCandle: z.tuple([
      z.literal("open"),
      z.literal("high"),
      z.literal("low"),
      z.literal("close"),
    ]),
  }).strict(),
}).strict();

export const DayBoundaryPolicySchema = z.object({
  timezone: z.literal("UTC"),
  localResetTime: z.literal("00:00:00"),
  timezoneDataVersion: z.literal("UTC-fixed-v1"),
  intervals: z.literal("startInclusiveEndExclusive"),
  ambiguousTime: z.literal("earlier"),
  nonexistentTime: z.literal("nextValid"),
}).strict();

const phaseSchema = z.object({
  id: idSchema,
  sequence: z.number().int().positive(),
  name: z.string().min(1).max(80),
  rules: z.array(ChallengeRuleSchema).min(1),
  completion: z.object({
    allRuleIds: z.array(idSchema).min(1),
    requireFlat: z.literal(true),
    requireNoWorkingOrders: z.literal(true),
    simultaneousOutcome: z.literal("hardBreachWins"),
  }).strict(),
  transition: z.object({
    nextPhaseId: idSchema.nullable(),
    capital: z.literal("resetToSelectedCapital"),
    counters: z.literal("reset"),
    drawdownReferences: z.literal("reset"),
    positionsAndOrders: z.literal("clear"),
    nextPhaseTrading: z.literal("nextCausalObservation"),
  }).strict(),
}).strict();

const domainVersionsSchema = z.object({
  snapshot: z.literal(SNAPSHOT_VERSION),
  schema: z.literal(SCHEMA_VERSION),
  accounting: z.literal(ACCOUNTING_VERSION),
  rounding: z.literal(ROUNDING_VERSION),
  calendar: z.literal(CALENDAR_VERSION),
  rules: z.literal(RULES_VERSION),
  execution: z.literal(EXECUTION_VERSION),
}).strict();

export const ChallengeTemplateSchema = z.object({
  templateId: idSchema,
  templateVersion: versionSchema,
  displayName: z.string().min(1).max(120),
  challengeType: z.enum(["oneStep", "twoStep"]),
  status: z.literal("PUBLISHED"),
  supportedSymbols: z.array(z.literal("BTCUSDT")).length(1),
  startingCapitalOptions: z.array(canonicalDecimalSchema).min(1),
  instrumentPolicies: z.array(InstrumentPolicySchema).length(1),
  executionPolicy: ExecutionPolicySchema,
  calendar: DayBoundaryPolicySchema,
  phases: z.array(phaseSchema).min(1).max(2),
  versions: domainVersionsSchema,
  source: z.object({
    origin: z.literal("internal"),
    name: z.literal("MyCryptoStack"),
  }).strict(),
}).strict().superRefine((template, context) => {
  if (
    (template.challengeType === "oneStep" && template.phases.length !== 1) ||
    (template.challengeType === "twoStep" && template.phases.length !== 2)
  ) {
    context.addIssue({ code: "custom", path: ["phases"], message: "Phase count must match challengeType." });
  }

  const capitalKeys = new Set<string>();
  for (const [index, capital] of template.startingCapitalOptions.entries()) {
    try {
      if (moneyFromDecimal(capital) <= BigInt(0)) throw new RangeError();
      if (capitalKeys.has(capital)) {
        context.addIssue({ code: "custom", path: ["startingCapitalOptions", index], message: "Duplicate capital option." });
      }
      capitalKeys.add(capital);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["startingCapitalOptions", index],
        message: "Starting capital must be positive and fit USD-micro precision.",
      });
    }
  }

  const instrument = template.instrumentPolicies[0];
  if (instrument && instrument.policyVersion !== template.executionPolicy.instrumentPolicyVersion) {
    context.addIssue({
      code: "custom",
      path: ["executionPolicy", "instrumentPolicyVersion"],
      message: "Execution policy must reference the frozen instrument policy version.",
    });
  }

  const phaseIds = new Set(template.phases.map((phase) => phase.id));
  for (const [index, phase] of template.phases.entries()) {
    if (phase.sequence !== index + 1) {
      context.addIssue({ code: "custom", path: ["phases", index, "sequence"], message: "Phase sequences must start at 1 and be contiguous." });
    }
    const expectedNext = template.phases[index + 1]?.id ?? null;
    if (phase.transition.nextPhaseId !== expectedNext) {
      context.addIssue({ code: "custom", path: ["phases", index, "transition", "nextPhaseId"], message: "Phase transition must point to the next phase." });
    }

    const ruleIds = phase.rules.map((rule) => rule.id);
    if (new Set(ruleIds).size !== ruleIds.length) {
      context.addIssue({ code: "custom", path: ["phases", index, "rules"], message: "Rule IDs must be unique within a phase." });
    }
    if (
      phase.completion.allRuleIds.length !== ruleIds.length ||
      new Set(phase.completion.allRuleIds).size !== ruleIds.length ||
      ruleIds.some((ruleId) => !phase.completion.allRuleIds.includes(ruleId))
    ) {
      context.addIssue({ code: "custom", path: ["phases", index, "completion", "allRuleIds"], message: "Completion rule IDs must reference every phase rule exactly once." });
    }

    const enabledKinds = phase.rules.filter((rule) => rule.enabled).map((rule) => rule.kind);
    const requiredKinds = ["profitTarget", "activeDays", "profitableDays", "inactivity", "leverage"] as const;
    for (const kind of requiredKinds) {
      if (enabledKinds.filter((candidate) => candidate === kind).length !== 1) {
        context.addIssue({ code: "custom", path: ["phases", index, "rules"], message: `Phase requires exactly one enabled ${kind} rule.` });
      }
    }
    const lossWindows = phase.rules.flatMap((rule) =>
      rule.enabled && rule.kind === "loss" ? [rule.window] : [],
    );
    if (
      lossWindows.length !== 2 ||
      !lossWindows.includes("daily") ||
      !lossWindows.includes("phase")
    ) {
      context.addIssue({ code: "custom", path: ["phases", index, "rules"], message: "Phase requires enabled daily and phase loss rules." });
    }
  }

  if (phaseIds.size !== template.phases.length) {
    context.addIssue({ code: "custom", path: ["phases"], message: "Phase IDs must be unique." });
  }
});

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const FrozenChallengeDefinitionSchema = z.object({
  snapshotVersion: z.literal(SNAPSHOT_VERSION),
  template: ChallengeTemplateSchema,
  selectedCapital: canonicalDecimalSchema,
  selectedSymbol: z.literal("BTCUSDT"),
  mode: z.enum(["replay", "live"]),
  instrumentPolicy: InstrumentPolicySchema,
  executionPolicy: ExecutionPolicySchema,
  calendar: DayBoundaryPolicySchema,
  versions: domainVersionsSchema,
  templateHash: hashSchema,
  instrumentPolicyHash: hashSchema,
  calendarHash: hashSchema,
  definitionHash: hashSchema,
}).strict();

export function parseChallengeTemplate(input: unknown): ChallengeTemplate {
  return ChallengeTemplateSchema.parse(input) as ChallengeTemplate;
}

export function parseFrozenChallengeDefinition(input: unknown): FrozenChallengeDefinition {
  return FrozenChallengeDefinitionSchema.parse(input) as FrozenChallengeDefinition;
}

export type InstrumentValueIssueCode =
  | "INVALID_DECIMAL"
  | "INVALID_PRICE"
  | "INVALID_QUANTITY"
  | "OFF_TICK"
  | "OFF_STEP"
  | "BELOW_MINIMUM_QUANTITY"
  | "BELOW_MINIMUM_NOTIONAL";

export interface InstrumentValueIssue {
  code: InstrumentValueIssueCode;
  field: "price" | "quantity" | "notional";
  message: string;
}

export type InstrumentValueValidation =
  | { ok: true; price: string; quantity: string }
  | { ok: false; issues: readonly InstrumentValueIssue[] };

function tenTo(scale: number): bigint {
  return BigInt(10) ** BigInt(scale);
}

export function validateInstrumentOrderValues(
  rawPolicy: InstrumentPolicy,
  input: { price: string; quantity: string },
): InstrumentValueValidation {
  const parsedPolicy = InstrumentPolicySchema.safeParse(rawPolicy);
  if (!parsedPolicy.success) {
    throw new TypeError("Instrument policy must be schema-valid before command validation.");
  }
  const policy = parsedPolicy.data;
  const issues: InstrumentValueIssue[] = [];

  let priceText: string;
  let quantityText: string;
  try {
    priceText = normalizeDecimalText(input.price);
  } catch {
    issues.push({ code: "INVALID_DECIMAL", field: "price", message: "Price must be plain base-10 decimal text." });
    priceText = "0";
  }
  try {
    quantityText = normalizeDecimalText(input.quantity);
  } catch {
    issues.push({ code: "INVALID_DECIMAL", field: "quantity", message: "Quantity must be plain base-10 decimal text." });
    quantityText = "0";
  }
  if (issues.length > 0) return { ok: false, issues };

  let price: bigint;
  let quantity: bigint;
  try {
    price = parseScaledDecimal(priceText, policy.priceScale);
  } catch {
    return { ok: false, issues: [{ code: "INVALID_PRICE", field: "price", message: "Price exceeds instrument precision." }] };
  }
  try {
    quantity = parseScaledDecimal(quantityText, policy.quantityScale);
  } catch {
    return { ok: false, issues: [{ code: "INVALID_QUANTITY", field: "quantity", message: "Quantity exceeds instrument precision." }] };
  }

  const tick = parseScaledDecimal(policy.priceTick, policy.priceScale);
  const step = parseScaledDecimal(policy.quantityStep, policy.quantityScale);
  const minimumQuantity = parseScaledDecimal(policy.minimumQuantity, policy.quantityScale);
  const minimumNotional = parseScaledDecimal(policy.minimumNotional, USD_MICRO_SCALE);

  if (price <= BigInt(0)) issues.push({ code: "INVALID_PRICE", field: "price", message: "Price must be positive." });
  else if (price % tick !== BigInt(0)) issues.push({ code: "OFF_TICK", field: "price", message: `Price must align to tick ${policy.priceTick}.` });

  if (quantity <= BigInt(0)) issues.push({ code: "INVALID_QUANTITY", field: "quantity", message: "Quantity must be positive." });
  else {
    if (quantity % step !== BigInt(0)) issues.push({ code: "OFF_STEP", field: "quantity", message: `Quantity must align to step ${policy.quantityStep}.` });
    if (quantity < minimumQuantity) issues.push({ code: "BELOW_MINIMUM_QUANTITY", field: "quantity", message: `Quantity must be at least ${policy.minimumQuantity}.` });
  }

  if (price > BigInt(0) && quantity > BigInt(0)) {
    const actualCrossProduct = price * quantity * tenTo(USD_MICRO_SCALE);
    const minimumCrossProduct = minimumNotional * tenTo(policy.priceScale + policy.quantityScale);
    if (actualCrossProduct < minimumCrossProduct) {
      issues.push({ code: "BELOW_MINIMUM_NOTIONAL", field: "notional", message: `Notional must be at least ${policy.minimumNotional} USD.` });
    }
  }

  return issues.length > 0
    ? { ok: false, issues: Object.freeze(issues) }
    : { ok: true, price: priceText, quantity: quantityText };
}
