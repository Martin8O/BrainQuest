"use client";

// Shared loading / error states for the client pages. Every page consumes the same BrainProvider, so
// while the pack + progress load (or if the pack asset is missing) they all show this instead of their
// content. Keeps the "is the data ready?" branch out of each page body.
import { Loader2, AlertTriangle } from "lucide-react";

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-24 text-zinc-500">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      <p className="mt-3 text-sm">{label}</p>
    </main>
  );
}

export function PageError({ error }: { error: string | null }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <AlertTriangle className="h-5 w-5" /> No content loaded
        </h2>
        <p className="mt-2 text-sm">{error ?? "Something went wrong loading the content pack."}</p>
        <p className="mt-3 text-sm">
          Compile a pack into <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/60">public/</code> with{" "}
          <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/60">npm run app:data</code>, then reload.
        </p>
      </div>
    </main>
  );
}
