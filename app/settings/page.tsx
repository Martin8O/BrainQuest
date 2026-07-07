"use client";

// Settings (client). In the client-only build there's no server vault to switch — content is a compiled
// pack loaded on the device. So this shows which pack is active and lets you configure the AI tutor
// backend, which now runs entirely in the browser (your key stays on this device). Importing and switching
// packs lives on the Packs page (M4.3).
import Link from "next/link";
import { Settings as SettingsIcon, Package, ShieldCheck, Library } from "lucide-react";
import TutorSettingsClient from "./TutorSettingsClient";
import { useBrain } from "../lib/BrainProvider";
import { PageError, PageLoading } from "../lib/PageStatus";

export default function SettingsPage() {
  const { status, error, snapshot, config, manifest } = useBrain();
  if (status === "loading") return <PageLoading label="Loading settings…" />;
  if (status === "error" || !snapshot || !config) return <PageError error={error} />;

  const { learning, concepts, harvest } = snapshot;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-500 to-zinc-600 text-white shadow-md shadow-slate-500/30">
            <SettingsIcon className="h-5 w-5" strokeWidth={2} />
          </span>
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          BrainQuest runs entirely on your device — content is a compiled pack, progress lives locally.
        </p>
      </header>

      {/* Active pack */}
      <section className="bq-card mb-8 rounded-2xl p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4 text-zinc-400" strokeWidth={2} /> Active pack
        </h2>
        <p className="font-medium">{manifest?.name ?? snapshot.vaultPath}</p>
        <div className="mt-2 text-xs text-zinc-500">
          {learning.length} learning notes · {concepts.length} concepts · {harvest.cards.length} cards ·{" "}
          {harvest.recall.length} recall prompts.
        </div>
        <Link
          href="/packs"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          <Library className="h-4 w-4" /> Import or switch packs
        </Link>
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
