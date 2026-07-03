import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/core ships raw TypeScript (framework-neutral shared engine); Next transpiles it as if
  // it were app source. The tsconfig "@brainquest/core/*" path also aliases it to the source files.
  transpilePackages: ["@brainquest/core"],
  // M2: the app is client-only (no server components, actions, or fs at runtime) — export it as a static
  // site. This both proves the server dependency is gone and produces the static bundle the mobile shell
  // (M3, Capacitor) serves. Content + progress load in the browser (pack.json + IndexedDB).
  output: "export",
};

export default nextConfig;
