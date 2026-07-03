// Pure builder for the daily-session queue — the data-prep that used to live in the server component,
// now framework-neutral so the client page can run it off the in-memory snapshot + store. Given the
// content + review state + config + the clock, it produces the ordered due queue, the area chips, and
// the walk-in XP/level baseline the finish screen compares against. No fs, no React — just data → data.
import { ensureStates, selectDue } from "@brainquest/core/srs/scheduler";
import { interleaveBySource } from "@brainquest/core/srs/order";
import { computeProgress, gamificationFor } from "@brainquest/core/progress/mastery";
import { areaForProjects } from "@brainquest/core/tutor/area";
import type { VaultConfig } from "@brainquest/core/vault/configTypes";
import type { VaultSnapshot } from "@brainquest/core/vault/types";
import type { ReviewStore } from "@brainquest/core/srs/types";
import type { SessionArea, SessionCard } from "./types";

export interface BuiltSession {
  queue: SessionCard[];
  areas: SessionArea[];
  levelBefore: number;
  xpBefore: number;
}

/** Assemble the ordered due queue + area chips + XP baseline for a session at time `now`. */
export function buildSession(
  vault: VaultSnapshot,
  store: ReviewStore,
  cfg: VaultConfig,
  now: Date,
): BuiltSession {
  const cards = vault.harvest.cards;
  const byId = new Map(cards.map((c) => [c.id, c]));

  // Map each source note to its project area (same scheme as the tutor) so cards can be filtered by topic.
  const projectsBySlug = new Map(vault.learning.map((n) => [n.slug, n.projects]));
  const areaForSlug = (slug: string) => areaForProjects(projectsBySlug.get(slug) ?? [], cfg);
  // Note date (YYYY-MM-DD from the filename) per source — used to introduce foundational material first.
  const dateBySlug = new Map(vault.learning.map((n) => [n.slug, n.date ?? "9999-99-99"]));
  const noteDate = (slug: string) => dateBySlug.get(slug) ?? "9999-99-99";
  const titleBySlug = new Map(vault.learning.map((n) => [n.slug, n.title]));

  // Concept lookups for the "doorway to depth": a card's concept carries a fuller gloss, and the concept
  // graph gives its neighbourhood (where you can steer next). Keyed case-insensitively, like Obsidian.
  const conceptByTitle = new Map(vault.concepts.map((c) => [c.title.toLowerCase(), c]));
  const canonical = (title: string) => conceptByTitle.get(title.toLowerCase())?.title ?? title;
  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const key = a.toLowerCase();
    (neighbours.get(key) ?? neighbours.set(key, new Set()).get(key)!).add(canonical(b));
  };
  for (const e of vault.harvest.graph.edges) {
    link(e.from, e.to);
    link(e.to, e.from); // undirected: a neighbourhood is symmetric for "what's related"
  }

  // Join each due review state back to its card content; brand-new cards get fresh state (due now).
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
        related: [] as string[],
        state,
      };
    })
    .filter((x): x is SessionCard => x !== null);

  // Order the queue: overdue reviews first (SRS priority), then new cards foundation-first + round-robin.
  const reviewed = due.filter((c) => c.state.reps > 0);
  const newByAge = due
    .filter((c) => c.state.reps === 0)
    .sort((a, b) => noteDate(a.sourceSlug).localeCompare(noteDate(b.sourceSlug)));
  const fresh = interleaveBySource(newByAge);
  const queue = [...reviewed, ...fresh];

  // "Where to go next": for each card, its concept's neighbours that ALSO have a due card today.
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

  // The XP/level the learner walks in on — the finish screen compares against these for a "level up!" moment.
  const progress = computeProgress(vault.harvest, vault.learning, store);
  const before = gamificationFor(progress, store, now);

  return { queue, areas, levelBefore: before.level.level, xpBefore: before.xp };
}
