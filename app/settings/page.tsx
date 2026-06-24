// Settings page (server component). Shows where BrainQuest currently reads the vault from and lets you
// switch it — the realistic "point at another brain" flow for a server-side app (the browser can't hand
// the server an OS folder path, so it's enter + validate + save, not a native picker). force-dynamic so
// it always reflects the live config. Only vault.config.json is ever written; the vault stays read-only.
import fs from "node:fs";
import path from "node:path";
import { Settings as SettingsIcon, FolderTree, ShieldCheck } from "lucide-react";
import { loadVaultConfig } from "@/lib/vault/config";
import { hasTutorApiKey } from "@/lib/tutor/config";
import SettingsClient from "./SettingsClient";
import TutorSettingsClient from "./TutorSettingsClient";

export const dynamic = "force-dynamic";

/** Read the vaultPath actually written in the file (vs. the effective one, which an env var can override). */
function fileVaultPath(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vault.config.json"), "utf8"));
    return typeof raw.vaultPath === "string" ? raw.vaultPath : null;
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const cfg = loadVaultConfig();
  const envPath = process.env.BRAINQUEST_VAULT_PATH ?? null;
  const inFile = fileVaultPath();
  const tutorKeyPresent = hasTutorApiKey();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <SettingsIcon className="h-6 w-6 text-zinc-400" strokeWidth={2} /> Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Point BrainQuest at a different Obsidian brain. The vault is only ever <span className="font-medium">read</span>;
          switching just updates <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">vault.config.json</code>.
        </p>
      </header>

      {/* Current source */}
      <section className="mb-8 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <FolderTree className="h-4 w-4 text-zinc-400" strokeWidth={2} /> Current vault
        </h2>
        <p className="break-all font-mono text-sm">{cfg.vaultPath}</p>
        <div className="mt-2 text-xs text-zinc-500">
          {envPath ? (
            <>
              Source: <span className="font-medium text-amber-600 dark:text-amber-400">BRAINQUEST_VAULT_PATH</span> env var
              {" "}(overrides the config file). The file still reads{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{inFile ?? "—"}</code>.
            </>
          ) : (
            <>
              Source: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">vault.config.json</code>. Reads{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{cfg.folders.learning}/</code> and{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{cfg.folders.concepts}/</code>.
            </>
          )}
        </div>
      </section>

      <SettingsClient currentPath={inFile ?? cfg.vaultPath} envOverride={!!envPath} />

      <TutorSettingsClient current={cfg.tutor} keyPresent={tutorKeyPresent} />

      <p className="mt-6 flex items-start gap-2 text-xs text-zinc-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2} />
        <span>
          Your review progress in <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">data/</code> is untouched by a
          switch, and the vault is never modified. API keys for a paid tutor backend belong in{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">local/.env</code> — never committed.
        </span>
      </p>
    </main>
  );
}
