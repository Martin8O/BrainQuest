"use client";

// Pack library (M4.3). The on-device catalogue of installed content packs: import a compiled pack.json
// from device storage, switch which pack the app plays, and remove imported ones. Each pack keeps its own
// review progress (namespaced per pack), so switching never mixes what you've learned. The built-in
// bundled pack is always present and can't be removed. All actions go through BrainProvider (IndexedDB).
import { useRef, useState } from "react";
import {
  Library,
  Upload,
  Package,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Layers,
  Lightbulb,
  FileText,
  Loader2,
  Star,
} from "lucide-react";
import type { InstalledPack } from "@brainquest/core/pack/registry";
import { useBrain } from "../lib/BrainProvider";
import { PageError, PageLoading } from "../lib/PageStatus";

export default function PacksPage() {
  const { status, error, registry, importPack, switchPack, removePack } = useBrain();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null); // an id/action currently running
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // The provider may still be loading on first mount; but a failed activation (e.g. a removed active pack)
  // shows the error page. We keep rendering the library even mid-switch so the buttons stay reachable.
  if (status === "loading" && registry.packs.length === 0) return <PageLoading label="Loading your packs…" />;
  if (status === "error" && registry.packs.length === 0) return <PageError error={error} />;

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same filename later
    if (!file) return;
    setNotice(null);
    setBusy("import");
    try {
      await importPack(file);
      setNotice({ kind: "ok", text: `Imported "${file.name}" and switched to it.` });
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setBusy(null);
    }
  }

  async function onSwitch(id: string) {
    setNotice(null);
    setBusy(id);
    try {
      await switchPack(id);
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Could not switch pack." });
    } finally {
      setBusy(null);
    }
  }

  async function onRemove(pack: InstalledPack) {
    if (!confirm(`Remove "${pack.name}" and its progress from this device?`)) return;
    setNotice(null);
    setBusy(pack.id);
    try {
      await removePack(pack.id);
      setNotice({ kind: "ok", text: `Removed "${pack.name}".` });
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Could not remove pack." });
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy !== null;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Library className="h-6 w-6 text-zinc-400" strokeWidth={2} /> Packs
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Import a compiled <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">pack.json</code> from your
          device, then switch between packs. Each pack keeps its own progress.
        </p>
      </header>

      {/* Import */}
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={onPickFile} className="hidden" />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={anyBusy}
        className="mb-4 inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Import a pack…
      </button>

      {notice && (
        <p
          className={`mb-4 flex items-start gap-2 text-sm ${
            notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"
          }`}
        >
          {notice.kind === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {notice.text}
        </p>
      )}

      {/* Installed packs */}
      <ul className="space-y-3">
        {registry.packs.map((pack) => {
          const active = pack.id === registry.activeId;
          const rowBusy = busy === pack.id;
          return (
            <li
              key={pack.id}
              className={`rounded-2xl border p-4 transition ${
                active
                  ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-500/70 dark:bg-indigo-950/30"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{pack.name}</span>
                    {active && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        <Star className="h-3 w-3" /> Active
                      </span>
                    )}
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                        pack.source === "builtin"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {pack.source === "builtin" ? "Built-in" : "Imported"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="font-mono">{pack.id}</span>
                    <span className="uppercase">{pack.lang}</span>
                    {pack.version && <span>v{pack.version}</span>}
                    {pack.author && <span>· {pack.author}</span>}
                  </div>
                </div>
                <Package className="h-5 w-5 shrink-0 text-zinc-300 dark:text-zinc-600" strokeWidth={2} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1" title="learning notes">
                  <FileText className="h-3.5 w-3.5" /> {pack.notes} notes
                </span>
                <span className="inline-flex items-center gap-1" title="concepts">
                  <Lightbulb className="h-3.5 w-3.5" /> {pack.concepts} concepts
                </span>
                <span className="inline-flex items-center gap-1" title="cards">
                  <Layers className="h-3.5 w-3.5" /> {pack.cards} cards
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {!active && (
                  <button
                    type="button"
                    onClick={() => onSwitch(pack.id)}
                    disabled={anyBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:bg-transparent dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                  >
                    {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Switch to this pack
                  </button>
                )}
                {pack.source === "imported" && (
                  <button
                    type="button"
                    onClick={() => onRemove(pack)}
                    disabled={anyBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-500 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-red-800 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-xs text-zinc-500">
        Packs are compiled with <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm run pack:build</code>.
        The built-in pack is the one bundled with the app; imported packs are stored only in this browser.
      </p>
    </main>
  );
}
