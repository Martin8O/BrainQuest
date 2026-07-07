"use client";

// Shared loading / error states for the client pages. Every page consumes the same BrainProvider, so
// while the pack + progress load (or if the pack asset is missing) they all show this instead of their
// content. Keeps the "is the data ready?" branch out of each page body.
import { Brain, AlertTriangle } from "lucide-react";

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-24 text-zinc-500">
      <span className="level-gem halo grid h-14 w-14 animate-pulse place-items-center rounded-2xl text-white">
        <Brain className="h-7 w-7" strokeWidth={2} />
      </span>
      <p className="mt-4 text-sm font-medium">{label}</p>
    </main>
  );
}

export function PageError({ error }: { error: string | null }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
      <div className="bq-card rounded-2xl border-amber-300/70 p-6 text-amber-900 dark:border-amber-800/60 dark:text-amber-200">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30">
            <AlertTriangle className="h-5 w-5" />
          </span>
          No content loaded
        </h2>
        <p className="mt-3 text-sm">{error ?? "Something went wrong loading the content pack."}</p>
        <p className="mt-3 text-sm">
          Compile a pack into <code className="rounded bg-amber-500/15 px-1">public/</code> with{" "}
          <code className="rounded bg-amber-500/15 px-1">npm run app:data</code>, then reload.
        </p>
      </div>
    </main>
  );
}
