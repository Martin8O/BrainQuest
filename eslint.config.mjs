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
    // Capacitor native shell (M3): a gitignored, generated project that bundles the built web assets
    // (minified JS) — never author code here, never lint it.
    "android/**",
    "ios/**",
    // `local/` is the gitignored private ops brain (CLAUDE.md §10) — never shipped, never linted.
    "local/**",
  ]),
]);

export default eslintConfig;
