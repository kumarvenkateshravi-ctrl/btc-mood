# Phase 5 — Canonical category intelligence

Phase 5 completes the official analysis path:

    closed raw candles / Phase 3 primitives / Phase 4 derived structure
      -> Standard category intelligence
      -> canonical M8 market intelligence
      -> canonical M9 decision
      -> immutable StandardMtfSnapshot

There is no category-to-decision shortcut. The Board remains the sole official
direction authority, M8 owns market condition and tradeability context, and M9
remains the only actionable decision authority.

## Categories and correlated-evidence controls

| Category | Inputs | Bounded groups / control |
| --- | --- | --- |
| Trend | EMA, SMA, SuperTrend, Phase 4 VWAP structure, ADX | EMA/SMA/SuperTrend are one 70% price-alignment group; VWAP structure is one 30% derived group; ADX only affects strength/confidence. |
| Momentum | RSI, ROC, MACD, Stoch RSI, Williams %R, CCI | RSI/ROC direction and MACD/Stoch acceleration are two groups. Williams/CCI/RSI extremes are warnings only, never reversal votes. |
| Volume | Volume SMA, spike, OBV, CMF | Activity/spike is one intensity group; OBV/CMF is one flow group. No taker-flow data is used. |
| Volatility | ATR, BB, Keltner, Donchian, standard deviation, squeeze | One range-volatility group plus squeeze state. Score remains neutral (50); state is non-directional. |
| Market Structure | Existing SMC | One SMC authority: swing regime, latest confirmed break, and context are diagnostics, not independent votes. |
| Volume Profile | Phase 4 POC structure and period POC diagnostics | POC structure is the only directional summary; 4H/daily/weekly POCs remain diagnostics. |
| Order Flow | Valid taker-side delta | One validated taker-flow group. Absorption is explicitly unavailable. |
| Confluence | Phase 4 FVG intelligence, squeeze context | One FVG summary; counts/nearest gaps are not repeated votes. Squeeze is warning context. Fibonacci remains deferred. |

Category scores use the existing M2 CategoryResult concepts: score, verdict,
confidence, strength, state, contributors, diagnostics, signals, and warnings.
The Standard boundary widens only the category identifiers needed for Structure,
Profile, Order Flow, and Confluence.

## Weights and hierarchy

No M2 or pre-existing M8 component weights changed. New category composition has
only two explicit blends: Trend price alignment/VWAP structure (70/30), and
Momentum direction/acceleration (55/45). They bound correlated evidence rather
than tune outcomes. The established Board timeframe hierarchy remains unchanged.

M8 receives the completed execution-timeframe category set after the Board
selects its execution timeframe. It can apply only bounded non-directional
context:

- mixed POC range: quality -12, opportunity -18, risk +10;
- compressed squeeze: quality -8, opportunity -16, risk +5;
- expanding volatility: quality -3, opportunity -4, risk +8;
- trend/SMC structural conflict: quality -12, opportunity -15, risk +12;
- mixed FVG confluence: quality -5, opportunity -7, risk +4.

These adjustments never alter M8 headline bias or the Board’s direction. When a
previously-ready environment falls to poor opportunity/quality, M8 becomes
wait; M9 still applies its existing gates and setup logic.

## Confidence, availability, and evidence

Category confidence reflects populated groups and evidence quality, not vote
count. Snapshot confidence starts with canonical M3 confidence, then applies a
bounded reliability adjustment for supported-category coverage, mixed POC range,
trend/structure conflict, and mixed FVG context. Unavailable Order Flow is
excluded from coverage. In particular, XAUUSD Order Flow is unavailable until a
compatible taker-side provider exists; it is neither neutral nor bearish and
does not trigger an M8 penalty.

Supporting/opposing snapshot evidence is derived from at most one concise signal
or warning per category, preserving category provenance and avoiding repeats of
the same underlying indicator stack. Missing or insufficient categories publish
null score/verdict fields and are not used as evidence.

## Versioning and intentional regression change

The Standard snapshot schema is now 3 and methodology is standard-mtf/1.2.0.
Cache identity includes the new category methodology parameters. The intentional
regression change is that BTC fixtures now expose Market Structure, Volume
Profile, Order Flow, and Confluence as supported categories instead of
unavailable placeholders. M8/M9 golden fixtures without an explicitly supplied
Standard category context are unchanged.

## Deferred or unavailable

- Fibonacci remains deferred pending an approved deterministic anchor policy.
- Absorption remains unavailable without order-book/trade-at-price evidence.
- XAU order flow remains unavailable without a compatible provider.
- No setup lifecycle or UI behavior is changed in this phase.
