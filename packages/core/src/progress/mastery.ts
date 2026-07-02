// Pure mastery + progress math — NO file system, NO clock. Mastery is DERIVED from data we already
// have (B1 cards + graph, B2 review state); we never store what we can compute. That's the whole
// point of C1: one function turns "what cards exist" + "how their reviews went" into "how much do I
// know, per concept and overall". Deterministic → trivially testable (E2), same as the B2 scheduler.
import type { Card, Harvest, LearningNote } from "../vault/types";
import type { ReviewState, ReviewStore } from "../srs/types";
import { computeGamification } from "../gamification/engine";
import type { GamificationState } from "../gamification/types";
import type {
  BucketCounts,
  CardBucket,
  ClusterProgress,
  ConceptMastery,
  MasteryLevel,
  OverallProgress,
  ProgressSummary,
} from "./types";

/**
 * Days of scheduled interval at which a card counts as fully "known" (strength 1). 21 days is the common
 * "mature" threshold (a card you still recall after three weeks is well retained). Below it, strength
 * scales linearly with the interval, so a card grows toward mastery as its successful reviews stretch the
 * interval out. The interval is the FSRS schedule (≈ stability at 90% retention) since F1; reading the
 * interval keeps strength engine-agnostic. A future refinement could read FSRS `stability` directly.
 */
const MATURE_DAYS = 21;

/** Concept-level thresholds on average card strength (kept named so they're easy to tune later). */
const YOUNG_AT = 0.5;
const MASTERED_AT = 1;

/** A single card's strength in 0..1, from its scheduled interval. Unseen / lapsed (reps 0) = 0. */
export function cardStrength(state: ReviewState | undefined): number {
  if (!state || state.reps === 0) return 0;
  return Math.min(1, state.intervalDays / MATURE_DAYS);
}

/** Which maturity bucket a card falls in, from its strength. */
export function cardBucket(state: ReviewState | undefined): CardBucket {
  const s = cardStrength(state);
  if (s <= 0) return "new";
  if (s >= 1) return "mature";
  return "learning";
}

/** Concept standing from its cards' average strength (and whether it has any cards at all). */
function masteryLevel(cardCount: number, avgStrength: number): MasteryLevel {
  if (cardCount === 0 || avgStrength <= 0) return "untouched";
  if (avgStrength >= MASTERED_AT) return "mastered";
  if (avgStrength >= YOUNG_AT) return "young";
  return "learning";
}

/** Mean of an array, or 0 for an empty array (no cards → no progress, not NaN). */
function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Tally the maturity buckets for a set of cards. */
function bucketCounts(cards: Card[], store: ReviewStore): BucketCounts {
  const counts: BucketCounts = { new: 0, learning: 0, mature: 0 };
  for (const c of cards) counts[cardBucket(store.reviews[c.id])] += 1;
  return counts;
}

/** Average strength for a set of cards. */
function avgStrength(cards: Card[], store: ReviewStore): number {
  return mean(cards.map((c) => cardStrength(store.reviews[c.id])));
}

/** How many of these cards have been reviewed at least once (same rule as OverallProgress). */
function reviewedCount(cards: Card[], store: ReviewStore): number {
  return cards.filter((c) => store.reviews[c.id]?.lastReviewedAt != null).length;
}

/**
 * Turn the harvest + review store into the full progress summary. Pure: same inputs → same output.
 * - overall: across every card.
 * - concepts: one per graph node (so concepts with zero cards still show as "untouched" — the
 *   "co mě čeká" side), mastery = average strength of the cards whose conceptLink points at it.
 * - clusters: cards grouped by their source learning note (provenance), newest note first.
 */
export function computeProgress(
  harvest: Pick<Harvest, "cards" | "graph">,
  notes: Pick<LearningNote, "slug" | "title" | "date">[],
  store: ReviewStore,
): ProgressSummary {
  const { cards, graph } = harvest;

  const overall: OverallProgress = {
    totalCards: cards.length,
    reviewedCards: reviewedCount(cards, store),
    avgStrength: avgStrength(cards, store),
    buckets: bucketCounts(cards, store),
  };

  // Cards grouped by the concept they point to. Keyed case-insensitively because Obsidian resolves
  // wikilinks case-insensitively (a card's `→ [[build step]]` points at the note titled "Build step"),
  // so a casing difference must NOT drop the card's mastery from its concept.
  const cardsByConcept = new Map<string, Card[]>();
  for (const c of cards) {
    if (!c.conceptLink) continue;
    const key = c.conceptLink.toLowerCase();
    const list = cardsByConcept.get(key);
    if (list) list.push(c);
    else cardsByConcept.set(key, [c]);
  }
  const concepts: ConceptMastery[] = [...new Set(graph.nodes)]
    .map((concept) => {
      const group = cardsByConcept.get(concept.toLowerCase()) ?? [];
      const strength = avgStrength(group, store);
      return { concept, cardCount: group.length, avgStrength: strength, level: masteryLevel(group.length, strength) };
    })
    .sort((a, b) => b.avgStrength - a.avgStrength || a.concept.localeCompare(b.concept));

  // Cards grouped by their source learning note → clusters; label/date from the note when known.
  const noteBySlug = new Map(notes.map((n) => [n.slug, n]));
  const cardsBySlug = new Map<string, Card[]>();
  for (const c of cards) {
    const list = cardsBySlug.get(c.sourceSlug);
    if (list) list.push(c);
    else cardsBySlug.set(c.sourceSlug, [c]);
  }
  const clusters: ClusterProgress[] = [...cardsBySlug.entries()]
    .map(([slug, group]) => {
      const note = noteBySlug.get(slug);
      return {
        slug,
        title: note?.title ?? slug,
        date: note?.date ?? null,
        cardCount: group.length,
        reviewedCards: reviewedCount(group, store),
        avgStrength: avgStrength(group, store),
        buckets: bucketCounts(group, store),
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.slug.localeCompare(b.slug));

  return { overall, concepts, clusters };
}

/**
 * Bridge from an already-computed ProgressSummary to the gamification state (C3): mastered concepts are
 * the XP heavyweight, so this is where "progress" feeds "motivation". Kept in ONE place (callers pass
 * the progress they already have — no extra vault read) so the mastery→XP rule can't drift across pages.
 */
export function gamificationFor(progress: ProgressSummary, store: ReviewStore, now: Date): GamificationState {
  const masteredConcepts = progress.concepts.filter((c) => c.level === "mastered").length;
  return computeGamification(store, masteredConcepts, now);
}
