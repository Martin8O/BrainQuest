// Daily review session (server component). It assembles the queue on the server — read the harvest
// (B1), load the review store (B2), figure out which cards are due now — then hands a plain list to
// the client loop. force-dynamic because "due" depends on the current time and the live store.
import { BookOpenCheck, CheckCircle2 } from "lucide-react";
import { readVault } from "@/lib/vault/reader";
import { loadReviewStore } from "@/lib/srs/store";
import { ensureStates, selectDue } from "@/lib/srs/scheduler";
import { computeProgress, gamificationFor } from "@/lib/progress/mastery";
import { loadVaultConfig } from "@/lib/vault/config";
import { areaForProjects } from "@/lib/tutor/area";
import { interleaveBySource } from "./order";
import SessionClient from "./SessionClient";
import type { SessionArea, SessionCard } from "./types";

export const dynamic = "force-dynamic";

export default async function SessionPage() {
  const now = new Date();
  const vault = await readVault();
  const cards = vault.harvest.cards;
  const byId = new Map(cards.map((c) => [c.id, c]));

  // Map each source note to its project area (same scheme as the tutor) so cards can be filtered by topic.
  const cfg = loadVaultConfig();
  const projectsBySlug = new Map(vault.learning.map((n) => [n.slug, n.projects]));
  const areaForSlug = (slug: string) => areaForProjects(projectsBySlug.get(slug) ?? [], cfg);
  // Note date (YYYY-MM-DD from the filename) per source — used to introduce foundational material first.
  // Undated notes sort last so they don't jump ahead of the dated learning sequence.
  const dateBySlug = new Map(vault.learning.map((n) => [n.slug, n.date ?? "9999-99-99"]));
  const noteDate = (slug: string) => dateBySlug.get(slug) ?? "9999-99-99";
  const titleBySlug = new Map(vault.learning.map((n) => [n.slug, n.title]));

  // Concept lookups for the "doorway to depth": a card's concept carries a fuller gloss, and the concept
  // graph gives its neighbourhood (where you can steer next). Keyed case-insensitively, like Obsidian.
  const conceptByTitle = new Map(vault.concepts.map((c) => [c.title.toLowerCase(), c]));
  const canonical = (title: string) => conceptByTitle.get(title.toLowerCase())?.title ?? title;
  const neighbours = new Map<string, Set<string>>(); // lowercased concept → neighbour canonical titles
  const link = (a: string, b: string) => {
    const key = a.toLowerCase();
    (neighbours.get(key) ?? neighbours.set(key, new Set()).get(key)!).add(canonical(b));
  };
  for (const e of vault.harvest.graph.edges) {
    link(e.from, e.to);
    link(e.to, e.from); // undirected: a neighbourhood is symmetric for "what's related"
  }

  // Join each due review state back to its card content; brand-new cards get fresh state (due now).
  const store = await loadReviewStore();
  const states = ensureStates(
    store,
    cards.map((c) => c.id),
    now,
  );
  const due: SessionCard[] = selectDue(states, now)
    .map((state) => {
      const c = byId.get(state.cardId);
      if (!c) return null;
      const area = areaForSlug(c.sourceSlug);
      const conceptNote = c.conceptLink ? conceptByTitle.get(c.conceptLink.toLowerCase()) : undefined;
      return {
        id: c.id,
        front: c.front,
        back: c.back,
        conceptLink: c.conceptLink,
        sourceSlug: c.sourceSlug,
        sourceTitle: titleBySlug.get(c.sourceSlug) ?? c.sourceSlug,
        areaKey: area.key,
        areaLabel: area.label,
        concept: c.conceptLink
          ? { title: canonical(c.conceptLink), gloss: conceptNote?.gloss ?? null }
          : null,
        related: [] as string[], // filled below, once we know which concepts have a due card
        state,
      };
    })
    .filter((x): x is SessionCard => x !== null);

  // Order the queue:
  //  1. Already-reviewed (overdue) cards first, soonest-due first — SRS priority (selectDue gave this).
  //  2. Then brand-new cards introduced FOUNDATION-FIRST: sort by source-note date ascending (older notes
  //     are the basics learned earlier), then round-robin across notes so a session samples breadth instead
  //     of dumping every card from one note (which made the queue feel like "the same note over and over").
  const reviewed = due.filter((c) => c.state.reps > 0);
  const newByAge = due
    .filter((c) => c.state.reps === 0)
    .sort((a, b) => noteDate(a.sourceSlug).localeCompare(noteDate(b.sourceSlug))); // stable: same-note order kept
  const fresh = interleaveBySource(newByAge);
  const queue = [...reviewed, ...fresh];

  // "Where to go next": for each card, its concept's neighbours that ALSO have a due card today, so a click
  // actually leads somewhere. Capped at 5 for readability; the client steers the next card toward the pick.
  const RELATED_CAP = 5;
  const dueConceptTitles = new Set(
    queue.map((c) => c.concept?.title.toLowerCase()).filter((t): t is string => !!t),
  );
  for (const c of queue) {
    if (!c.concept) continue;
    c.related = [...(neighbours.get(c.concept.title.toLowerCase()) ?? [])]
      .filter((n) => dueConceptTitles.has(n.toLowerCase()) && n.toLowerCase() !== c.concept!.title.toLowerCase())
      .slice(0, RELATED_CAP);
  }

  // One area chip per project present among today's due cards, biggest first.
  const areaMap = new Map<string, SessionArea>();
  for (const c of queue) {
    const cur = areaMap.get(c.areaKey);
    if (cur) cur.count += 1;
    else
      areaMap.set(c.areaKey, {
        key: c.areaKey,
        label: c.areaLabel,
        count: 1,
        defaultOn: areaForSlug(c.sourceSlug).defaultOn,
      });
  }
  const areas: SessionArea[] = [...areaMap.values()].sort((a, b) => b.count - a.count);

  // The XP/level the learner walks in on — the session compares against these to fire a "level up!"
  // moment and to show the true XP gained (gamification.xp − xpBefore), mastery bonus included.
  const progress = computeProgress(vault.harvest, vault.learning, store);
  const before = gamificationFor(progress, store, now);
  const levelBefore = before.level.level;
  const xpBefore = before.xp;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <BookOpenCheck className="h-6 w-6 text-indigo-500" strokeWidth={2} /> Daily session
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {queue.length} due {queue.length === 1 ? "card" : "cards"} · flip, recall, grade yourself.
        </p>
      </header>

      {!vault.ok ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Could not read the vault. {vault.error}
        </div>
      ) : queue.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" strokeWidth={1.75} />
          <h2 className="mt-3 text-xl font-semibold">Nothing due right now</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Every card is scheduled for later. Come back when the next one is due — or add notes to{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">vault</code> for fresh cards.
          </p>
        </div>
      ) : (
        <SessionClient initialQueue={queue} areas={areas} levelBefore={levelBefore} xpBefore={xpBefore} />
      )}
    </main>
  );
}
