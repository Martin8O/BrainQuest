// Progress + mastery contracts — the derived shape the progress page renders. This layer computes,
// it never stores: everything here is a pure function of the harvest (B1) + review store (B2). Keep
// the shapes in one place so the page and (later) the skill tree (C2) read the same model.

/** A card's review maturity, derived from its SM-2 interval — never persisted. */
export type CardBucket = "new" | "learning" | "mature";

/** A concept's overall standing, derived from the average strength of the cards pointing to it. */
export type MasteryLevel = "untouched" | "learning" | "young" | "mastered";

/** How many cards sit in each maturity bucket (the stacked-bar breakdown). */
export interface BucketCounts {
  new: number;
  learning: number;
  mature: number;
}

/** Top-line progress across every card. */
export interface OverallProgress {
  totalCards: number;
  /** Cards that have been reviewed at least once (have a stored lastReviewedAt). */
  reviewedCards: number;
  /** Mean card strength 0..1 — the headline "how much do I know" number. */
  avgStrength: number;
  buckets: BucketCounts;
}

/** Mastery of one concept node (a graph node from B1), including untouched ones with no cards yet. */
export interface ConceptMastery {
  concept: string;
  cardCount: number;
  avgStrength: number;
  level: MasteryLevel;
}

/** Progress for one cluster = one source learning note (cards grouped by where they came from). */
export interface ClusterProgress {
  slug: string;
  title: string;
  date: string | null;
  cardCount: number;
  avgStrength: number;
  buckets: BucketCounts;
}

/** Everything the progress page needs, all derived from harvest + review store. */
export interface ProgressSummary {
  overall: OverallProgress;
  /** One entry per concept graph node — the "umím vs. co mě čeká" universe. */
  concepts: ConceptMastery[];
  /** One entry per source learning note. */
  clusters: ClusterProgress[];
}
