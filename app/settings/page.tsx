"use client";

// Settings (client). In the client-only build there's no server vault to switch — content is a compiled
// pack loaded on the device. So this shows which pack is loaded and lets you configure the AI tutor
// backend, which now runs entirely in the browser (your key stays on this device). Pack import from device
// storage is the mobile shell's job (M3).
import { Settings as SettingsIcon, Package, ShieldCheck } from "lucide-react";
import TutorSettingsClient from "./TutorSettingsClient";
import { useBrain } from "../lib/BrainProvider";
import { PageError, PageLoading } from "../lib/PageStatus";

export default function SettingsPage() {
  const { status, error, snapshot, config } = useBrain();
  if (status === "loading") return <PageLoading label="Loading settings…" />;
  if (status === "error" || !snapshot || !config) return <PageError error={error} />;

  const { learning, concepts, harvest } = snapshot;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <SettingsIcon className="h-6 w-6 text-zinc-400" strokeWidth={2} /> Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          BrainQuest runs entirely on your device — content is a compiled pack, progress lives locally.
        </p>
      </header>

      {/* Loaded content */}
      <section className="mb-8 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4 text-zinc-400" strokeWidth={2} /> Loaded pack
        </h2>
        <p className="break-all font-mono text-sm">{snapshot.vaultPath}</p>
        <div className="mt-2 text-xs text-zinc-500">
          {learning.length} learning notes · {concepts.length} concepts · {harvest.cards.length} cards ·{" "}
          {harvest.recall.length} recall prompts.
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Rebuild it after editing your vault with{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm run app:data</code>.
        </p>
      </section>

      <TutorSettingsClient />

      <p className="mt-6 flex items-start gap-2 text-xs text-zinc-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2} />
        <span>
          Your review progress is stored in this browser (IndexedDB). Any AI-tutor API key you enter stays in this
          browser’s local storage and is sent only to the backend you choose — never to us.
        </span>
      </p>
    </main>
  );
}
