# Product

## Register

product

## Users

**Primary — the active crypto trader.** Watching BTC/USDT (and ETH/SOL) across six
timeframes in focused, often high-adrenaline sessions. Usually on a large monitor,
sometimes mobile. Their job: read the market's mood across all timeframes in under a
second, catch the moment a signal flips, and act. They value speed, density, and
trust over hand-holding. The current dashboard already leans toward them.

**Secondary — the analyst.** Same data, slower cadence. Wants context: multi-timeframe
confluence, backtests, regime/volatility framing, and annotations that explain *why*
the mood is what it is. Exports and shareable state matter.

**Tertiary — the casual viewer.** Arrives asking "what's Bitcoin doing right now?"
Needs the mood narrated and explained, with beauty and clarity ahead of density.

The product personalizes toward whichever intent is active, but the **active trader is
the default** — the surface optimizes for them first and morphs outward.

## Product Purpose

BTC Market Mood reads the *mood* of Bitcoin by combining EMA/RSI/ATR signals across six
timeframes into a single timeframe-weighted verdict, then presents it with cinematic
clarity and pro-terminal precision. It exists because reading multi-timeframe confluence
on existing tools is either ugly-utilitarian (TradingView) or dumbed-down. Success is a
trader who trusts it at a glance and reaches for it *over* TradingView for a mood and
confluence read.

## Brand Personality

Precise. Cinematic. Trustworthy. The voice is the expert who is calm in volatility,
never hype, never a casino barker. Confidence is the product: the user should feel
sharp, informed, and in control of their money. Premium reads through restraint and
craft, not through noise.

## Anti-references

- **Neon-on-black crypto-bro aesthetic.** Garish acid greens and purples, everything
  glowing, casino energy. The single biggest trap for this category. Reject it.
- **Generic SaaS dashboard.** Hero-metric template (big number + small label + gradient),
  identical icon-heading-text card grids, gradient text. Slop.
- **TradingView's soul-less density.** We keep the information richness; we reject the
  utilitarian flatness. Density *with* composure and depth.
- **Glassmorphism everywhere and fake 3D gimmicks** that decorate without encoding data
  or that hurt legibility.

## Design Principles

1. **Density with composure.** Pro-grade information richness that never reads as
   clutter. Every element earns trust; nothing is there to look busy.
2. **Depth serves data.** Volumetric, cinematic, and motion effects must encode real
   signal (volume, volatility regime, momentum, a flip). Decoration that carries no
   information gets cut.
3. **Confidence at a glance.** The mood verdict and per-timeframe signal state must be
   legible in under one second, before any detail is read.
4. **Motion with intent.** Animation exists to reveal change (a signal flip, a new bar,
   a regime shift), never as ambient sparkle. Every motion has a clean reduced-motion
   equivalent that snaps to the same end state.
5. **Adapt to intent, stay one product.** The surface reshapes for trader / analyst /
   casual viewer without fracturing into three different apps or three visual languages.

## Accessibility & Inclusion

- Target WCAG 2.1 AA: contrast on all text and signal indicators, visible focus states,
  full keyboard operability (existing 1-6 / H / C / R / F shortcuts preserved and
  extended).
- `prefers-reduced-motion` is fully honored: every animation degrades to its instant end
  state, no information lost.
- Direction is never encoded by red/green hue alone. Pair color with shape, icon,
  position, or label so colorblind users read bullish/bearish correctly.
- 60fps motion budget; cinematic effects degrade gracefully on low-power devices rather
  than dropping frames.
