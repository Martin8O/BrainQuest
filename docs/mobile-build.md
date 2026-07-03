# Building the Android app (Capacitor)

BrainQuest ships as a **client-only** web app (Next `output: "export"` → `out/`). Capacitor (M3) wraps that
static bundle in a native Android **WebView** shell: the app runs entirely on-device — the content pack and
your progress are bundled/stored locally, no server. This is the runbook for turning the web build into an
installable app and, eventually, a Play Store bundle (AAB).

> **Why this is a manual step:** building a native Android package needs the Android toolchain (JDK + Android
> SDK + Gradle) and, to install, a physical device. Those live on your machine, not in this repo. Everything
> up to the native build is automated by the npm scripts below.

## One-time setup

1. **Install Android Studio** — <https://developer.android.com/studio>. It bundles a compatible **JDK** and
   lets you install the **Android SDK** (accept the SDK licences on first launch). This is the whole toolchain.
2. Let Android Studio install: an **SDK Platform** (latest stable API level) + **Android SDK Build-Tools** +
   **Platform-Tools** (gives you `adb`).
3. (Optional, for command-line builds) set env vars so the CLI finds the SDK:
   - `ANDROID_HOME` → e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`
   - add `%ANDROID_HOME%\platform-tools` to `PATH` (for `adb`).

## Generate the native project (once per machine)

The `android/` folder is **gitignored** — it's regenerated from `capacitor.config.ts` + the web build, like
`node_modules`. Create it once:

```powershell
npm install            # ensure @capacitor/* are installed
npm run cap:sync       # app:data → next build (out/) → cap sync
npx cap add android    # scaffolds android/ and copies the web assets in
```

`npx cap add android` works without the SDK (it only scaffolds); the **build** below is what needs it.

## Rebuild + run after any change

```powershell
npm run cap:sync       # rebuild the web bundle and copy it into android/
npm run cap:open       # open the project in Android Studio
```

Then in Android Studio: **Run ▶** on a connected device/emulator, or **Build → Generate Signed App Bundle**
for a release **AAB**. Command-line equivalents (from `android/`):

```powershell
npx cap run android                        # build + install on a plugged-in phone (USB debugging on)
cd android; .\gradlew.bat bundleRelease    # produce a release .aab (needs a signing keystore)
```

## Run on your phone (debug)

1. On the phone: **Settings → About → tap Build number 7×** to unlock Developer options, then enable
   **USB debugging**.
2. Plug in via USB, accept the debugging prompt.
3. `npx cap run android` (or Run ▶ in Android Studio) → the app installs and launches.

## Notes

- **App id:** `com.brainquest.app` · **App name:** BrainQuest (set in `capacitor.config.ts`).
- **Offline:** the content pack (`pack.json`) is baked into the app assets by `cap:sync`; progress lives in
  the on-device IndexedDB. No network needed to study.
- **AI tutor** is opt-in and **OFF by default** (needs the user's own key / a reachable Ollama) — irrelevant
  to a basic install.
- **Signing keys are secrets** — a release keystore (`*.jks` / `*.keystore`) is gitignored; never commit it.
- **Play Store** publishing (billing, data-safety form, listing, closed testing) is a later phase (M5).
