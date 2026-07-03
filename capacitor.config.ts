import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor (M3) wraps the app's static web build in a native Android shell. The app is client-only
// (Next `output: "export"` → out/), so the native app just serves those assets in a WebView — content is
// the bundled pack.json + IndexedDB progress, no server. `webDir` is that export; `npm run cap:sync`
// rebuilds it and copies it into the native project. The native project (android/) is generated
// per-machine with `npx cap add android` and is gitignored — see docs/mobile-build.md.
const config: CapacitorConfig = {
  appId: "com.brainquest.app",
  appName: "BrainQuest",
  webDir: "out",
};

export default config;
