import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure logic only — no DOM/jsdom needed. Tests live next to the modules they cover, as *.test.ts.
    // The engine now lives in packages/core; its tests use relative imports, so no path alias is needed.
    environment: "node",
    include: ["packages/core/src/**/*.test.ts"],
  },
});
