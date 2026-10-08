# Prop Challenge Trainer: Task 0 domain contract and legacy characterization

**Status:** Task 0 complete and accepted; all section 10 decisions were approved on 11 September 2026.  
**Scope:** BTC only. The product label is `BTC`; the canonical internal symbol is `BTCUSDT`. Gold is outside this task.  
**Implementation boundary:** This document, the golden fixture, and characterization tests are the only deliverables. No production behavior, storage schema, route, UI, migration, or Gold behavior changes in Task 0.

## 1. Findings

The existing paper and replay modules provide a usable behavioral baseline, but they do not provide challenge-grade accounting or immutable audit semantics.

1. `lib/paper.ts` is the shared order/fill kernel. It models market slippage, entry/exit commissions, average entry price, margin, working orders, protective exits, and liquidation.
2. `lib/paperStore.ts` uses a field called `balance` as a reservation-adjusted amount while a position or order is open. It removes used or reserved margin from that value. This is not the Challenge v1 definition of cash.
3. The shared `applyFill` kernel incorrectly flattens a position when an opposite fill is smaller than the open quantity. The replay wrapper compensates for this by passing only the close quantity to the kernel and rebuilding the survivor. The live paper store does not use that workaround.
4. A closed `PaperTrade.realizedPnl` includes close P&L and the exit commission, but excludes the allocated entry commission. `replaySession.ts` reconstructs session balance from closed trades, so it overstates balance by all entry commissions.
5. Protective stops fill at the stop price even when the first observable price has gapped beyond it. This is optimistic.
6. Reversal in the raw kernel carries the old stop-loss and take-profit into the new opposite position. The old trailing flag is disabled, but other protective state is not treated as a new lifecycle.
7. BTC price tick and market slippage are constants, but input validation does not enforce the price tick or any quantity step.
8. Replay already has deterministic modeled intrabar paths, accepted-action journaling, frozen execution candles, and deterministic rewind. These behaviors are suitable foundations and are frozen below.
9. No challenge-day, drawdown, profit-target, phase, inactivity, or challenge-event domain exists in production code today.
10. Existing accounting is JavaScript floating-point arithmetic with local rounding in a few price paths. It has no ledger-wide money or quantity scale.

## 2. Current behavior matrix

| Area | Current behavior | Mismatch or ambiguity | Challenge v1 disposition |
|---|---|---|---|
| Starting cash | Paper store and replay each initialize a numeric balance. | No canonical ledger identity connects cash, equity, and margin. | Versioned challenge accounting. |
| Cash/balance | Paper store subtracts reserved/used margin and fees from `balance`; replay balance is starting balance plus closed trade P&L. | Paper balance behaves like available funds; replay omits entry fees. | `cash` is settled money only. Margin never changes cash. |
| Equity | Calculated in presentation/store paths from balance and position state. | Meaning depends on the local balance definition. | `equity = cash + unrealizedPnl`. |
| Realized P&L | Position accumulator includes entry fee; closed trade P&L excludes entry fee. | Two meanings use the same term. | Expose gross realized P&L, commissions, and lifecycle net P&L separately. |
| Unrealized P&L | Long: `(mark-entry)*quantity`; short reverses the sign. | No scale/rounding contract. | Preserve formula; post at USD micro precision with half-even rounding. |
| Entry/exit fees | Charged per fill as notional times fee rate. | Entry fees disappear from replay session balance and closed trade lifecycle P&L. | Every fee posts to cash; allocate entry fees across partial closes for reporting. |
| Used margin | `quantity*price/leverage`; paper store removes it from `balance`. | Margin is represented as an expense in store state. | Track separately using open entry notional; do not post it to cash. |
| Reserved margin | Pending order margin is removed from paper `balance`. | Reservation changes the balance field. | Track separately; acceptance reserves, fill converts reserve to used margin, cancellation releases it. |
| Free margin | Inferred through adjusted balance. | No single formula across modes. | `freeMargin = equity - usedMargin - reservedMargin`. |
| BTC price/quantity | Tick is $0.10; market slippage is one tick. Arbitrary positive quantities and off-grid limit prices are accepted. | No quantity step and no grid admission. | Resolve all executable grid values from the attempt's frozen BTC InstrumentPolicy. |
| Open | Creates position and records entry fee as negative position realized P&L. | Cash ledger is not explicit. | Atomic fill posts fee, position, used margin, and audit facts. |
| Increase | Weighted average entry and accumulated fee. | Floats and mixed realized semantics. | Preserve weighted basis; add notional and allocated entry fee exactly. |
| Partial close | Raw kernel closes the entire position; replay wrapper manually preserves remainder. | Live/replay divergence; fee allocation is wrong for lifecycle reporting. | Challenge v1 must preserve the remainder and its basis/brackets, with pro-rata entry-fee allocation. Legacy remains untouched in Task 0. |
| Full close | Releases margin and records gross close P&L less exit fee. | Replay final balance excludes the entry fee. | Post gross P&L and exit fee to cash; close allocated entry fee belongs to lifecycle reporting. |
| Reversal | Closes existing quantity and opens the excess on the opposite side. | Raw kernel carries old SL/TP and mixed accounting fields. | Close first, allocate commission by notional, then create a fresh opposite position. |
| SL/TP | Reconcile updates trailing state, checks SL, then TP. | A test name says TP first but does not assert the chosen exit. | Outcome follows the modeled intrabar path; at one observation, protective priority is trailing update, SL, TP. |
| Trailing stop | Distance derives from entry and initial SL; best price updates; price rounds to one decimal. | No general tick-rounding contract. | Preserve semantics with explicit adverse tick rounding. |
| Manual close | Opposite market fill with one-tick slippage. | Subject to partial-close kernel defect. | Route through the challenge fill reducer and the same commission policy. |
| Gap through stop | Protective order fills at the configured stop. | Optimistic when the market opens beyond the stop. | Versioned challenge policy fills at the first observable worse price. |
| Leverage | Stored per position/order; supported UI/store values are constrained locally. | No challenge-wide admission contract. | Maximum 20x at entry/increase admission; margin uses admitted leverage. |
| Replay intrabar | Up candle is O-L-H-C; down candle is O-H-L-C. | None for BTC replay. | Preserve exactly. |
| Replay action timing | An action after a cut is evaluated against later market observations. | Contract is implicit. | Freeze explicitly. |
| Replay rewind | Rebuilds from a frozen execution dataset and accepted actions; actions beyond target are removed. | Destructive truncation is unsuitable for a future audit ledger. | Preserve deterministic rebuilding; Challenge v1 will branch rather than erase audit facts. |
| Day rules | No challenge rule engine. Existing chart helpers use UTC day buckets. | Product definitions absent. | Versioned challenge rules below. |
| Drawdowns/targets/phases | Not implemented. | Product definitions absent. | Freeze below before Task 1. |
| Rounding | JS `number`; selected prices use one decimal. | Results can depend on binary floating point and posting order. | Integer-scaled values and half-even posting. |
| Event order | Local function call order only. | No global deterministic contract. | Freeze causal order below. |

## 3. Frozen Challenge v1 domain contracts

### 3.1 Instrument and arithmetic

- Use generic domain names such as `SymbolId`, `InstrumentPolicy`, `ExecutionPolicy`, and `ChallengePolicy`.
- The only supported MVP policy is BTC with canonical symbol `BTCUSDT`.
- Money storage: signed integer USD micros, scale 6.
- BTC quantity storage: signed integer satoshis, scale 8.
- Accounting precision and executable-market grids are separate contracts.
- Every attempt freezes a versioned BTC InstrumentPolicy containing price/quantity scales, tick, step, minimum quantity, minimum notional, and command/derived rounding behavior.
- The resolved `mcs.btcusdt/1` policy uses price scale 6, quantity scale 8, USD 0.10 price tick, BTC 0.00001 executable quantity step and minimum quantity, and USD 5 minimum notional.
- User commands reject off-grid values. Derived prices normalize adversely and derived quantities normalize toward zero under the frozen policy.
- Ledger postings round half to even. Never repeatedly round an accumulated balance.

### 3.2 Accounting identities

At every stable checkpoint:

```text
cash = startingCash + settledGrossPnl - allCommissions
equity = cash + unrealizedPnl
freeMargin = equity - usedMargin - reservedMargin
usedMargin = sum(openEntryNotional / admittedLeverage)
reservedMargin = sum(acceptedUnfilledOrderNotional / admittedLeverage)
```

Margin reservation and use are collateral states, not cash expenses. A pending order changes reserved and free margin only. An entry fill releases its reservation, establishes used margin, and reduces cash only by the entry commission. A close releases proportional used margin, posts gross P&L, and posts its exit commission.

For reporting, each open lot carries its unallocated entry commission. A partial close allocates entry commission in proportion to closed quantity. This allocation does not charge cash a second time. It permits exact lifecycle net P&L:

```text
lifecycleNetPnl = grossClosePnl - allocatedEntryCommission - exitCommission
```

### 3.3 Position transitions

- **Open:** create one signed BTC exposure at the execution price; post entry commission; establish used margin.
- **Increase:** preserve side, compute weighted entry from exact entry notionals, add used margin, and accumulate unallocated entry commissions.
- **Partial close:** reduce only the closed quantity. Preserve side, entry basis, SL, TP, trailing configuration, best price, remaining entry-fee allocation, and remaining used margin.
- **Full close:** settle all gross P&L and exit commission, release all used margin, and clear protective state.
- **Reversal:** split one fill deterministically into a closing component and an opening residual. Allocate fill commission by component notional. Finish the old lifecycle before creating the new opposite position. The new position receives fresh protective state supplied with the reversal command; old brackets never cross the lifecycle boundary.

### 3.4 Execution, brackets, gaps, and leverage

- Market orders use one adverse BTC tick of slippage. Golden examples that state a fill price treat it as the post-slippage price.
- SL, TP, trailing, manual close, liquidation, and accepted working orders all use the same fill/accounting reducer.
- A trailing stop uses the initial entry-to-stop distance. Favorable extrema update `bestPrice`; the resulting stop is rounded adversely to the price tick.
- For a long protective stop, fill at `min(stopPrice, firstObservableExecutablePrice)`. For a short protective stop, use `max`. This applies only when the observable price crossed the stop between causal observations.
- Leverage is an admission constraint. BTC Challenge v1 permits at most 20x, configurable downward. Entry/increase commands that would exceed the configured maximum or available free margin are rejected. Later price movement that increases effective leverage does not itself create a separate challenge breach; equity loss rules remain authoritative.

### 3.5 Replay causality and rewind

- Up candle path: open, low, high, close.
- Down candle path: open, high, low, close.
- Degenerate sub-bars preserve that exact ordering. Therefore the fixture long with SL 98 and TP 105 exits by SL in the up candle and by TP in the down candle.
- At each modeled observation, only information at or before that observation is available.
- A user action recorded after the current replay candle is consumed cannot execute against an earlier portion of that candle. It first becomes eligible at the next causal observation.
- Rewind must reproduce byte-equivalent challenge state from the same frozen dataset, policy version, seed, and accepted command history.
- Legacy replay currently deletes future actions on rewind. Challenge v1 must retain immutable events and create a new branch from the rewind point. This is a Task 1 design requirement, not a Task 0 implementation.

### 3.6 Deterministic event order

For one timestamp or modeled substep, process facts in this order:

1. Close the prior UTC day and emit its active/profitable-day result when crossing a boundary.
2. Open the new UTC day and establish its starting-cash reference.
3. Apply the causal market observation and revalue current exposure.
4. Update high-water and trailing reference values.
5. Evaluate hard equity rules. If breached, fail immediately and cancel later execution at that observation.
6. Reconcile protective exits in the order SL, TP, liquidation, working limit orders, then working stop orders, preserving existing local priority where the modeled path reaches several triggers at one observation.
7. For each fill, atomically post gross P&L, commission, position state, and margin state. Do not expose intermediate accounting states to rules.
8. Revalue and evaluate daily/maximum loss after each atomic fill.
9. Apply admitted user commands whose causal time is this observation, then process their fills with steps 7 and 8.
10. At the stable post-event checkpoint, evaluate inactivity, day-count eligibility, and profit target. A breach always wins over a target reached at the same timestamp.

Stable sorting keys are timestamp, modeled-path index, precedence above, accepted command sequence, and event ID. IDs derive from session/branch identity and sequence; they never use wall-clock time or randomness.

## 4. Golden fixtures

The executable fixture is `lib/challenges/__fixtures__/btc-challenge-v1.golden.json`.

The required round trip begins with USD 10,000 cash, buys 10 BTC at a post-slippage fill of USD 100, sells at USD 110, and charges 0.1% on each fill. Entry notional is USD 1,000 and entry commission is USD 1. Exit notional is USD 1,100 and exit commission is USD 1.10. Gross P&L is USD 100; total commissions are USD 2.10; net P&L is USD 97.90; final cash is USD 10,097.90.

At 20x leverage, the open position uses USD 50 margin. Immediately after entry, cash and equity are USD 9,999 and free margin is USD 9,949. At mark USD 105, unrealized P&L is USD 50, equity is USD 10,049, and free margin is USD 9,999. The fixture checks both accounting identities at every state.

The partial-close fixture starts long 10 at USD 100 and closes 4 at USD 110. The survivor is long 6 at the same entry basis with SL, TP, trailing state, and best price intact. USD 0.40 of the USD 1 entry commission is allocated to the closed quantity and USD 0.60 remains with the survivor. With a USD 0.44 exit commission, closed lifecycle net P&L is USD 39.16. Cash is USD 10,038.56, equity at USD 110 is USD 10,098.56, used margin is USD 30, and free margin is USD 10,068.56.

Additional fixtures cover increase, full reversal, same-bar SL/TP, gap-through-stop, half-even rounding, day boundaries, drawdown floors, targets, and simultaneous target/breach resolution.

## 5. Rule definitions frozen for Task 1

### Challenge presets

- Internal name: **MyCryptoStack Practice Challenge**.
- One-step: 10% profit target.
- Two-step: Phase 1 target 10%; Phase 2 target 8%.
- Minimum active days: 3 per phase.
- Minimum profitable days: 3 per phase.
- Profitable-day threshold: finalized daily net realized P&L, including every commission assigned to that UTC day, must be at least 0.1% of phase starting cash.
- Inactivity: 30 consecutive elapsed UTC days without an exposure-increasing fill. Replay uses replay time, never wall-clock time.
- BTC maximum leverage: configurable, initially 20x.

### Day and drawdown rules

- A challenge day is the half-open UTC interval `[00:00:00, next 00:00:00)`. A fact exactly at midnight belongs to the new day.
- A day becomes active on its first exposure-increasing fill. Closing activity alone does not make an inactive day active.
- Daily net P&L assigns each commission and settled gross P&L to the UTC day of its fill. Opening fees therefore affect the entry day even when the trade closes later.
- A profitable day is decided only when the UTC day closes and only if it was active.
- Daily-loss allowance is 5% of phase starting cash. The daily floor is `dayStartCash - allowance`. Breach occurs when observed equity is less than or equal to the floor. The boundary observation can breach immediately.
- Maximum-loss allowance is 10% of phase starting cash. The default preset uses a static floor of `phaseStartingCash - allowance`; equality breaches.
- The generic policy supports a trailing maximum-loss floor: `max(initialFloor, peakEquity - allowance)`. This mode is not enabled in the initial preset.
- Profit targets use cash, include every commission, and require no open position or working order. Equality reaches the target.

### Phase transitions

A phase passes only at a stable checkpoint when the account is flat, no working order remains, the cash target is reached, minimum active/profitable days are finalized, no inactivity failure exists, and no drawdown breach exists. A failure at the same timestamp wins. A new phase has a fresh account based on the selected challenge capital, resets day counters and drawdown references, and carries no position or order.

## 6. Characterized defects and limitations

| ID | Observed defect or limitation | Evidence | Task 0 action |
|---|---|---|---|
| T0-01 | Shared-kernel partial close of long 10 by sell 4 returns flat instead of long 6. | New characterization test against `applyFill`. | Recorded; no fix. |
| T0-02 | Replay session balance for the exact round trip is USD 10,098.90, one entry commission too high. | New replay characterization test. | Recorded; Challenge v1 contract is USD 10,097.90; no fix. |
| T0-03 | Protective stop at USD 95 fills at USD 95 after an opening gap to USD 90. | New `reconcile` characterization test. | Recorded; Challenge v1 specifies adverse gap fill; no fix. |
| T0-04 | Raw reversal carries old SL and TP to the opposite lifecycle. | New `applyFill` characterization test. | Recorded; Challenge v1 requires fresh brackets; no fix. |
| T0-05 | BTC orders accept arbitrary fractional quantities and off-tick limit prices. | New `validateOrder` characterization test. | Recorded; Challenge v1 specifies grid rejection; no fix. |
| T0-06 | Existing same-bar test wording says TP precedes SL, while implementation checks SL before TP and the test does not assert the reason. | Source/test inspection and new reason assertions over modeled sub-bars. | Contract follows the modeled path; no legacy test edit. |
| T0-07 | Replay rewind removes future accepted actions. | Existing determinism tests and source inspection. | Preserve deterministic replay; require branch retention in Challenge v1. |
| T0-08 | Legacy accounting uses binary floating point and inconsistent local rounding. | Source inspection. | Challenge v1 uses scaled integer arithmetic. |

## 7. Tests and results

Task 0 adds `lib/challenges/task0.characterization.test.ts`. It checks:

- exact round-trip commission and final-cash arithmetic;
- cash/equity/free-margin identities at start, reservation, fill, mark, and close;
- half-even commission rounding;
- increase, partial-close, reversal, and rule-fixture consistency;
- the current partial-close defect;
- current off-grid order admission;
- current reversal bracket carry-over;
- O-L-H-C and O-H-L-C same-bar outcomes;
- current gap-through-stop price;
- current replay entry-fee omission.

The targeted legacy suites used for Task 0 are:

- `lib/paper.test.ts`
- `lib/paperStore.pendingLifecycle.test.ts`
- `lib/replay/intrabar.test.ts`
- `lib/replaySession.partialClose.test.ts`
- `lib/replaySession.determinism.test.ts`
- `lib/replayCommission.test.ts`
- `lib/challenges/task0.characterization.test.ts`

Validation result: **7 test files passed; 73 tests passed**.

## 8. Files changed

- `docs/architecture/prop-challenge-task-0-contract.md`: this Task 0 decision record and characterization report.
- `lib/challenges/__fixtures__/btc-challenge-v1.golden.json`: executable BTC Challenge v1 golden contracts.
- `lib/challenges/task0.characterization.test.ts`: characterization and fixture-consistency tests.

No production file is changed.

## 9. Legacy behavior preserved and versioned differences

Task 0 preserves all current application behavior. The tests assert defects without fixing them. Existing routes, components, stores, replay behavior, storage keys, database behavior, and Gold functionality are untouched.

Challenge v1 deliberately differs from legacy behavior in its cash ledger, entry-fee inclusion, partial-close reducer, reversal lifecycle, grid validation, scaled arithmetic, gap-stop execution, immutable rewind branches, UTC challenge days, rule evaluation, and phase transitions. These differences must live behind a versioned challenge policy/session boundary. They must not alter the legacy paper or replay paths silently.

## 10. Approved product decisions for Challenge v1

All eight decisions were approved on 11 September 2026:

1. Daily loss uses a fixed 5% allowance based on phase starting cash. The floor is day-start cash minus that allowance, resets at 00:00 UTC, and breaches when observed equity is at or below it.
2. Maximum loss uses a static 10% floor based on phase starting cash. A trailing maximum drawdown remains architecturally supported but is deferred.
3. Boundaries are inclusive without epsilon comparisons. Loss breaches at or below the floor, profit targets reach at or above the target, and a hard breach wins at a simultaneous deterministic checkpoint.
4. Accounting uses exact scaled integers, USD-micro cash, exact BTC quantities, half-even postings, fee-complete accounting, correct partial-close residuals, deterministic fee allocation, and strict Challenge command validation. Accounting precision is separate from the executable market grid. BTC tick, executable quantity step, minimum quantity, minimum notional, and rounding are resolved through a frozen, versioned `InstrumentPolicy`; attempts freeze the resolved policy and replay/future-live modes use the same snapshot.
5. A protective stop crossed normally fills at the stop. A gap beyond it fills at the first observable adverse executable price, then applies adverse grid normalization and commission to the actual fill.
6. Maximum leverage is configurable and initially 20x. It is enforced when entry, increase, or reversal residual exposure is admitted. Reductions remain permitted, and later effective-leverage growth is not itself a failure.
7. Exposure-increasing fills define active UTC days. A profitable day must be active, finalized, and have fee-complete settled P&L at least 0.1% of phase starting cash. Entry fees belong to the entry day; exit gross P&L and exit commission belong to the exit day.
8. Passing requires the profit target, active/profitable day requirements, no hard breach, a flat account, and no working orders. There is no target-triggered forced close. Two-Step Phase 2 starts with fresh configured capital, drawdown references, counters, and no positions/orders. Reversal begins a fresh opposite lifecycle without old SL/TP/trailing state.
## 11. Task 0 pass/fail

**PASS.** The BTC-only current behavior is characterized, defects are explicit, Challenge v1 contracts are concrete, golden fixtures are executable, all product decisions are approved, and no production or Gold behavior changed.

## 12. Approved Task 1 boundary

Task 1 is limited to the deterministic, framework-agnostic domain foundation behind a versioned Challenge v1 boundary:

1. Define branded identity, scaled value, status, rule, phase, template, execution-policy, instrument-policy, and frozen-definition types with only `BTCUSDT` enabled.
2. Implement USD-micro money and satoshi-scale BTC quantity codecs, exact decimal parsing, half-even ledger-posting arithmetic, and JSON-safe integer codecs.
3. Implement the resolved versioned BTC InstrumentPolicy and strict executable price/quantity/minimum validation without applying it to legacy execution.
4. Implement UTC midnight day identities and immutable boundary tables.
5. Implement closed discriminated rule/template schemas, phase-graph validation, frozen template expansion, canonical serialization, dependency hashes, and immutable snapshots.
6. Keep legacy paper/replay modules unchanged.

Accounting ledgers, execution transitions, position reducers, rule evaluation, persistence, UI, server runtime, replay adapters, production live challenges, Readiness Score work, and Gold support remain outside Task 1.