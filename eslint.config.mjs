import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ─────────────────────────────────────────────────────────────────────────────
// MDS §L — Engineering Platform
// Custom ESLint rules that enforce the design-token contracts defined in
// DESIGN.md. These rules make violations visible at author-time (IDE squiggle)
// and block CI on errors, so the "frozen" contracts are machine-checked, not
// just documented.
//
// Severity policy (DESIGN.md §L):
//   error   = contract is frozen; violation blocks CI.
//   warn    = smell to burn down; advisory in IDE, does NOT block CI.
//
// Current rule inventory:
//   no-raw-hex-class      [warn]  — raw hex in Tailwind arbitrary color utils
//   no-bare-outline-none  [warn]  — outline-none on interactive elements without
//                                   a focus-visible companion (a11y gap)
//   no-hardcoded-shadow   [warn]  — inline rgba()/shadow-[…] bypassing token layer
//   no-restricted-syntax  [error] — re-declaring a frozen MDS primitive
//   no-restricted-props   [warn]  — .toFixed()/.toLocaleString() for financial values
// ─────────────────────────────────────────────────────────────────────────────

// ── Rule 1: no raw hex in Tailwind arbitrary color utilities ─────────────────
const ARBITRARY_HEX = /-\[#[0-9a-fA-F]{3,8}\]/;

// ── Rule 2: outline-none without a focus-visible companion ───────────────────
// Detects strings like "outline-none" that are NOT accompanied by "focus-visible"
// in the same class string. Form inputs that replace outline with a border-based
// indicator AND include a focus:border-* are acceptable — only truly bare cases.
const BARE_OUTLINE_NONE = /(?<![:\w])outline-none/;
const HAS_FOCUS_VISIBLE = /focus-visible:/;
const HAS_FOCUS_BORDER  = /focus(?::|-)(?:border|ring)/;
const HAS_FOCUS_RING_CLASS = /\bfocus-ring\b/;

// ── Rule 3: hardcoded box-shadow bypassing the token layer ───────────────────
// Catches shadow-[rgba(...)], shadow-[0_...px_...] — these should use
// the MDS shadow tokens (shadow-1, shadow-2, or var(--shadow-*)).
const ARBITRARY_SHADOW = /shadow-\[(?:rgba|0_|\d)/;

const mdsPlugin = {
  rules: {
    // ── no-raw-hex-class ─────────────────────────────────────────────────────
    "no-raw-hex-class": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Use a design token instead of a raw hex in Tailwind arbitrary color utilities (DESIGN.md §L). " +
            "Use bg-surface-*, text-ink, border-line, text-bull-bright, etc.",
        },
        schema: [],
      },
      create(context) {
        const report = (node) =>
          context.report({
            node,
            message:
              "Raw hex in Tailwind class — use a token (bg-surface-*, text-ink, border-line, text-bull-bright…) or a CSS var. DESIGN.md §L.",
          });
        return {
          Literal(node) {
            if (typeof node.value === "string" && ARBITRARY_HEX.test(node.value)) report(node);
          },
          TemplateElement(node) {
            if (ARBITRARY_HEX.test(node.value.raw)) report(node);
          },
        };
      },
    },

    // ── no-bare-outline-none ─────────────────────────────────────────────────
    "no-bare-outline-none": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "outline-none removes the browser focus indicator. Always pair it with a " +
            "focus-visible:ring-* / focus-visible:outline-* / focus:border-* replacement, " +
            "or use the .focus-ring utility class instead (DESIGN.md §C, a11y).",
        },
        schema: [],
      },
      create(context) {
        const check = (node, value) => {
          if (typeof value !== "string") return;
          if (!BARE_OUTLINE_NONE.test(value)) return;
          // Exempt strings that already include a visible focus alternative
          if (
            HAS_FOCUS_VISIBLE.test(value) ||
            HAS_FOCUS_BORDER.test(value) ||
            HAS_FOCUS_RING_CLASS.test(value)
          ) return;
          context.report({
            node,
            message:
              "outline-none without a focus-visible alternative makes interactive elements " +
              "unreachable by keyboard. Add focus-visible:ring-2 focus-visible:ring-accent/50, " +
              "focus:border-accent, or use the .focus-ring utility class. DESIGN.md §C / a11y.",
          });
        };
        return {
          Literal(node) { check(node, node.value); },
          TemplateElement(node) { check(node, node.value.raw); },
        };
      },
    },

    // ── no-hardcoded-shadow ──────────────────────────────────────────────────
    "no-hardcoded-shadow": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Use the MDS shadow tokens (shadow-1, shadow-2, or var(--shadow-*)) rather than " +
            "arbitrary inline box-shadows. Inline shadows bypass the theme system and can't " +
            "adapt to theme changes (DESIGN.md §B3 elevation recipe).",
        },
        schema: [],
      },
      create(context) {
        const report = (node) =>
          context.report({
            node,
            message:
              "Hardcoded shadow value — use the MDS elevation tokens (.elev-1/.elev-2, " +
              "shadow-1/shadow-2, or var(--shadow-1)/var(--shadow-2)) instead. DESIGN.md §B3.",
          });
        return {
          Literal(node) {
            if (typeof node.value === "string" && ARBITRARY_SHADOW.test(node.value)) report(node);
          },
          TemplateElement(node) {
            if (ARBITRARY_SHADOW.test(node.value.raw)) report(node);
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Throwaway scratch scripts — not part of the app.
    "_scratch/**",
    // Storybook build output.
    "storybook-static/**",
    // IndicatorSettingsModal intentionally keeps TradingView palette (chart-embedded).
    // It is excluded from the hex rule only; other rules still apply.
    "components/trade/IndicatorSettingsModal.tsx",
  ]),

  // ── MDS design-system governance (DESIGN.md §C-FREEZE / §B5-FREEZE / §H-FREEZE) ──
  // Pages compose the shared primitives; they never re-declare a frozen primitive
  // or hand-format financial numbers. Implementation files (lib/, components/ui/)
  // are exempt — they ARE the formatting/primitive layer.
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      // Frozen primitives must come from @/components/ui, not be re-defined locally.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "FunctionDeclaration[id.name=/^(Panel|Widget|KpiCard|PositionRow|PositionCard|AICard|DataTable|ChartPanel|Button|Modal|Tabs)$/]",
          message:
            "Frozen primitive: import it from @/components/ui instead of redefining it (see DESIGN.md freezes). " +
            "Phase C added: Button, Modal, Tabs.",
        },
      ],
      // Financial numbers go through <Num.* /> or lib/format, never raw toFixed/toLocaleString.
      "no-restricted-properties": [
        "warn",
        { property: "toFixed", message: "Render financial values with <Num.* /> or lib/format (DESIGN.md §B5-FREEZE), not .toFixed()." },
        { property: "toLocaleString", message: "Render financial values with <Num.* /> or lib/format (DESIGN.md §B5-FREEZE), not .toLocaleString()." },
      ],
    },
  },

  // React Compiler advisory rules. This app does NOT compile with the React
  // Compiler, and these flag intentional, working idioms: ref-mirroring of the
  // latest props for an interval, resetting local input state when the selected
  // item changes, and live-time displays (Date.now during render). Keep them as
  // guidance, not CI blockers. `react-hooks/immutability` stays an ERROR — render
  // mutation is a real anti-pattern we fixed (donuts compute offsets functionally).
  {
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      // Pre-existing `any` in the legacy chart/indicator primitives. A quality
      // signal worth keeping visible, but not a CI blocker.
      "@typescript-eslint/no-explicit-any": "warn",
      // Honor the `_`-prefix convention for intentionally-unused params/vars
      // (e.g. shared indicator signatures that ignore their `_config`).
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },

  // ── MDS §L token-only lint ───────────────────────────────────────────────
  // Scoped to the token-consuming layer. IndicatorSettingsModal is excluded
  // from the hex rule (chart-embedded, intentionally TradingView-styled) via
  // globalIgnores above. App/craft sample pages are also exempt.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/ui/**/*.{ts,tsx}",
      "components/trade/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
    ],
    ignores: ["app/sample/**", "app/craft/**"],
    plugins: { mds: mdsPlugin },
    rules: {
      // [warn] — 30+ pre-existing violations in IndicatorSettingsModal (excluded above).
      // After that file is refactored, promote to error.
      "mds/no-raw-hex-class": "warn",

      // [warn] — catches outline-none without a focus-visible companion.
      // Will surface remaining bare outline-none in the trade components.
      "mds/no-bare-outline-none": "warn",

      // [warn] — catches hardcoded rgba() box-shadows bypassing the token layer.
      "mds/no-hardcoded-shadow": "warn",
    },
  },
]);

export default eslintConfig;
