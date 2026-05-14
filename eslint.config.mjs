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
    // Workflow SDK auto-generated route handlers — bundled JS with
    // a vestigial `/* eslint-disable */` comment that ESLint warns
    // about as "unused". Source of truth is src/workflows/*.workflow.ts.
    "src/app/.well-known/workflow/**",
  ]),
  // Vendored shadcn / Vercel AI Elements components are installed via
  // registry CLIs and get overwritten on update. Fixing React Compiler
  // rule violations in-place would regress on the next `shadcn add` /
  // `ai-elements` upgrade — the Vercel team has reviewed these patterns
  // and considers them intentional (e.g. Rive state-machine input
  // mutation, module-cached motion components, sync-with-props ref
  // writes, streaming-error fallback ref reads). We silence the
  // compiler rules for these directories only.
  {
    files: [
      "src/components/ai-elements/**/*.{ts,tsx}",
      "src/components/ui/**/*.{ts,tsx}",
    ],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
      "@next/next/no-img-element": "off",
      "jsx-a11y/role-has-required-aria-props": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
