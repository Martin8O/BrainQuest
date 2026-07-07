"use client";

// Daily review session (client). It assembles the queue from the client data layer (pack + IndexedDB
// review store) via the pure buildSession(), then hands a plain list to the client loop. All state is
// on-device — no server round-trip.
import { useMemo } from "react";
import { BookOpenCheck, CheckCircle2 } from "lucide-react";
import { buildSession } from "./buildQueue";
import SessionClient from "./SessionClient";
import { useBrain } from "../lib/BrainProvider";
import { PageError, PageLoading } from "../lib/PageStatus";

export default function SessionPage() {
  const { status, error, snapshot, config, store } = useBrain();

  // Freeze the session at its START: the due queue AND the walk-in XP/level baseline are a snapshot of the
  // moment the session opens. This must NOT recompute as grading mutates the store — otherwise `xpBefore`
  // would track the post-grade XP and the finish screen would always show "+0 XP" and never a level-up.
  // Snapshot + config are set once by the provider, so this memo runs once (the store is captured then).
  const built = useMemo(
    () => (snapshot && config ? buildSession(snapshot, store, config, new Date()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally capture the store once, at session start
    [snapshot, config],
  );

  if (status === "loading") return <PageLoading label="Building today’s session…" />;
  if (status === "error" || !snapshot || !config || !built) return <PageError error={error} />;

  const { queue, areas, levelBefore, xpBefore } = built;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
            <BookOpenCheck className="h-5 w-5" strokeWidth={2} />
          </span>
          Daily session
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {queue.length} due {queue.length === 1 ? "card" : "cards"} · flip, recall, grade yourself.
        </p>
      </header>

      {queue.length === 0 ? (
        <div className="bq-card rounded-2xl p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
            <CheckCircle2 className="h-7 w-7" strokeWidth={2} />
          </span>
          <h2 className="mt-4 text-xl font-semibold">Nothing due right now</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Every card is scheduled for later. Come back when the next one is due — or add notes and{" "}
            <code className="rounded bg-zinc-900/5 px-1 dark:bg-white/10">npm run app:data</code> for fresh cards.
          </p>
        </div>
      ) : (
        <SessionClient initialQueue={queue} areas={areas} levelBefore={levelBefore} xpBefore={xpBefore} />
      )}
    </main>
  );
}
