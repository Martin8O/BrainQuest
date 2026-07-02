import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/core ships raw TypeScript (framework-neutral shared engine); Next transpiles it as if
  // it were app source. The tsconfig "@brainquest/core/*" path also aliases it to the source files.
  transpilePackages: ["@brainquest/core"],
};

export default nextConfig;
