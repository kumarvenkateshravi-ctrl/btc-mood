import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
            "FunctionDeclaration[id.name=/^(Panel|Widget|KpiCard|PositionRow|PositionCard|AICard|DataTable|ChartPanel)$/]",
          message:
            "Frozen primitive: import it from @/components/ui instead of redefining it (see DESIGN.md freezes).",
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
]);

export default eslintConfig;
