// Daily review session (server component). It assembles the queue on the server — read the harvest
// (B1), load the review store (B2), figure out which cards are due now — then hands a plain list to
// the client loop. force-dynamic because "due" depends on the current time and the live store.
import Link from "next/link";
import { readVault } from "@/lib/vault/reader";
import { loadReviewStore } from "@/lib/srs/store";
import { ensureStates, selectDue } from "@/lib/srs/scheduler";
import { computeProgress, gamificationFor } from "@/lib/progress/mastery";
import SessionClient from "./SessionClient";
import type { SessionCard } from "./types";

export const dynamic = "force-dynamic";

export default async function SessionPage() {
  const now = new Date();
  const vault = await readVault();
  const cards = vault.harvest.cards;
  const byId = new Map(cards.map((c) => [c.id, c]));

  // Join each due review state back to its card content; brand-new cards get fresh state (due now).
  const store = await loadReviewStore();
  const states = ensureStates(
    store,
    cards.map((c) => c.id),
    now,
  );
  const queue: SessionCard[] = selectDue(states, now)
    .map((state) => {
      const c = byId.get(state.cardId);
      return c
        ? { id: c.id, front: c.front, back: c.back, conceptLink: c.conceptLink, sourceSlug: c.sourceSlug, state }
        : null;
    })
    .filter((x): x is SessionCard => x !== null);

  // The XP/level the learner walks in on — the session compares against these to fire a "level up!"
  // moment and to show the true XP gained (gamification.xp − xpBefore), mastery bonus included.
  const progress = computeProgress(vault.harvest, vault.learning, store);
  const before = gamificationFor(progress, store, now);
  const levelBefore = before.level.level;
  const xpBefore = before.xp;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">📚 Daily session</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {queue.length} due {queue.length === 1 ? "card" : "cards"} · flip, recall, grade yourself.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-zinc-500 underline hover:text-zinc-700">
          Overview
        </Link>
      </header>

      {!vault.ok ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Could not read the vault. {vault.error}
        </div>
      ) : queue.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-4xl">✅</div>
          <h2 className="mt-3 text-xl font-semibold">Nothing due right now</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Every card is scheduled for later. Come back when the next one is due — or add notes to{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">vault</code> for fresh cards.
          </p>
        </div>
      ) : (
        <SessionClient initialQueue={queue} levelBefore={levelBefore} xpBefore={xpBefore} />
      )}
    </main>
  );
}
