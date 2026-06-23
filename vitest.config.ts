import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirror the tsconfig "@/*" path alias so test files can `import "@/lib/..."` exactly like the app does.
// Vitest doesn't read tsconfig paths on its own, so we wire the one alias the codebase uses by hand.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "");

export default defineConfig({
  test: {
    // Pure logic only — no DOM/jsdom needed. Tests live next to the modules they cover, as *.test.ts.
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": root },
  },
});
