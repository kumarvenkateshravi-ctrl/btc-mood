# Prop Challenge Task 9 — Deterministic Readiness Score v1

Task 9 adds the analytical policy mcs.challenge.readiness/1 for BTC Replay Challenge reports. It consumes one frozen ChallengeReportReadModel; it does not import or invoke accounting, execution, replay, persistence, or rule reducers. It does not affect Challenge status, pass/fail decisions, commands, fills, cash, equity, fees, day qualification, or historical evidence.

## Identity and version binding

Every result carries the Challenge id, active branch id and generation, BTC/replay identity, definition and dataset hashes, Task 8 report version, canonical report hash, frozen scoring-config hash, and the report's logical generatedAt. canonicalHash(report) includes bigint values without lossy conversion. Unsupported readiness versions fail explicitly. A future scoring policy must use a new readiness version and configuration hash; it cannot reinterpret an existing v1 result silently.

The report service constructs the Task 8 report first and then computes readiness once. React receives the two completed read models and only renders them.

## Eligibility and finality

A scope becomes scorable at all three exact thresholds:

- 3 closed trade lifecycles
- 3 finalized active UTC days
- 3 finalized active-day risk observations with a positive daily loss allowance (startingCash > dailyFloor)

Open lifecycles, in-progress days, and inactive finalized days do not satisfy these thresholds. Before eligibility, the overall score and every component score are null, every component is INSUFFICIENT_DATA, and the missing evidence is enumerated. No neutral 50 is inserted.

An eligible active scope is SCORABLE and PROVISIONAL. An eligible terminal scope is COMPLETE and FINAL. A terminal scope with too little evidence remains INSUFFICIENT_DATA and FINAL.

## Arithmetic

All money inputs remain exact USD-micro bigint values. Ratios are integer basis points. Divisions and the final weighted score use the approved half-even divider. Every intermediate score is bounded to 0–100.

For component scores s and integer percentage weights w, the final score is:

halfEven(sum(s × w) / 100)

The displayed contribution is s × w / 100, retained to two exact decimal places because both operands are integers.

Weights are frozen at Risk 30, Consistency 25, Profitability Quality 20, Execution Control 15, and Rule Discipline 10.

Grades are EXCELLENT at 90–100, STRONG at 80–89, DEVELOPING at 70–79, WEAK at 60–69, and NOT_READY below 60. These labels describe simulated evidence quality and are not probabilities.

## Component formulas

### Risk Discipline

Start at 100 and subtract:

- up to 45 points linearly for peak observed loss-capacity use
- up to 15 points linearly for average finalized daily loss-capacity use
- 3 per canonical WarningRaised, capped at 9
- 8 per canonical DangerRaised, capped at 16
- 24 per daily/maximum BreachRecorded, capped at 48

Daily utilization is maximumDailyLossUsage / (startingCash - dailyFloor). When Task 8 contains a maximum-loss transition with money evidence, overall utilization is (phaseStartingCash - observed) / (phaseStartingCash - floor) and participates in the peak. Task 8 currently records risk transitions rather than every SAFE maximum-loss observation, so v1 does not invent missing maximum-loss floor history. Eligibility's active trading requirements prevent inactivity from earning a risk score.

### Consistency

Only finalized active-day settled P&L is used.

- up to 60 points for the share of days with settledNetPnl > 0
- up to 25 points for stability; mean absolute return dispersion loses points linearly from 0 at 0 bps to the full 25-point penalty at 200 bps
- up to 15 points for positive-P&L concentration; no penalty through 50%, then a linear reduction to zero points when one day supplies 100% of positive day P&L

Each day return is normalized by that day's starting cash. An in-progress day cannot move this score.

### Profitability Quality

Only closed lifecycle economics are used. Capital normalization uses the sum of starting capital for phases represented by those closed trades.

- up to 50 points for net return, linear from -500 bps to +1000 bps
- up to 30 points for winning gross P&L divided by total absolute winning and losing gross P&L
- up to 20 points for fee efficiency; fee drag is fees / abs(grossPnl) and loses all 20 points at 2000 bps

All entry and exit commissions are already fee-complete Task 8 evidence. The scorer never reconstructs them.

### Execution Control

Start at 100 and subtract:

- up to 30 points from unique reversal transitions divided by completed lifecycles
- 8 points for each exit fill beyond three in one lifecycle, capped at 24
- up to 20 points for fee drag, with the full penalty at 2000 bps of absolute gross P&L

Reversal pairs are deduplicated from canonical related lifecycle ids. One entry with up to three exits has no churn penalty. Holding duration, trade frequency by itself, direction, and the presence or absence of protective orders are not scored, so v1 does not rank strategy style.

### Rule Discipline

Start at 100 and subtract:

- 2 per warning, capped at 8
- 3 per danger event, capped at 9
- 8 per hard breach, capped at 16
- an additional 30 per inactivity breach, capped at 60
- on terminal scopes only, up to 12 points for active-day requirement shortfall
- on terminal scopes only, up to 8 points for profitable-day requirement shortfall

Warning and danger penalties are deliberately smaller than in Risk Discipline. Risk measures use of loss capacity; Rule measures canonical requirement reliability. In-progress requirement counts do not penalize provisional attempts.

All breach penalties are bounded. Failure never maps directly to zero, and passing never grants score points.

## Two-Step and branch behavior

Each activated phase receives an isolated scope result. Locked phases have no readiness result. Overall Two-Step readiness pools closed lifecycles, finalized active days, and canonical risk events from all activated phases and runs the formulas over that pooled evidence. Capital normalization sums the represented phase starting capitals. This evidence-volume aggregation is not a simple average of phase scores and reflects the full causal attempt.

Task 9 scores exactly the branch supplied by Task 8. It neither discovers nor merges archived branches. Branch ids and report hashes make independently loaded branch results distinct.

## Explainability and UI

Every component exposes its score, weight, weighted contribution, status, raw evidence items with stable codes and units, positive factors, negative factors, and insufficient-data reasons. Overall strengths come from positive factors of components scoring at least 80; watch factors come from negative factors of components below 70. Labels are deterministic and map to named evidence boundaries.

The report places Readiness after Challenge Summary and before Phase Results. It uses one broad graphite surface, an elegant tabular score, horizontal component bars, restrained semantic color, phase evidence summaries, and 200 ms reduced-motion-aware transitions. It includes the required statement:

> Readiness Score measures performance quality and rule discipline within simulated Challenge evidence. It does not predict or guarantee results in a real evaluation.

No AI advice, probability claim, radar chart, coaching, Live Challenge behavior, Gold behavior, or server runtime is included.

## Known report limitation

Task 8 exposes every finalized day's peak daily-loss use and canonical risk transitions. It does not expose a continuous SAFE maximum-loss utilization series. Readiness v1 uses exact maximum-loss utilization when a transition supplies the floor and observation, and otherwise makes no maximum-loss claim. A future report version may add a canonical per-phase peak maximum-loss field; adopting it requires a new readiness scoring version if it changes scores.
