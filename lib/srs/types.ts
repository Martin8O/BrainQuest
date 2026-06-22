// SRS (spaced-repetition system) contracts — the single shape the scheduler produces and
// persistence stores. Contracts in one place: change the review model here, never ad hoc.

/** How well a card was recalled. The 4-button scale the daily session (B3) will show. */
export type Grade = "again" | "hard" | "good" | "easy";

/** Per-card scheduling state, evolved by the SM-2 step on each review. */
export interface ReviewState {
  /** The Card.id this state schedules (e.g. "2026-06-22-b1-...#c0"). */
  cardId: string;
  /** Successful repetitions in a row (SM-2 "n"); reset to 0 on a lapse. */
  reps: number;
  /** How many times the card has been failed ("again") — diagnostics, not used by the SM-2 math. */
  lapses: number;
  /** Current inter-repetition interval in whole days (SM-2 "I"). */
  intervalDays: number;
  /** Ease factor (SM-2 "EF"); starts at 2.5, never drops below 1.3. */
  ease: number;
  /** When the card next becomes due, as an ISO-8601 timestamp. */
  due: string;
  /** When it was last reviewed (ISO-8601), or null if never. */
  lastReviewedAt: string | null;
  /** The grade given at the last review, or null if never. */
  lastGrade: Grade | null;
}

/** The persisted file shape (data/reviews.json). Versioned so the format can evolve later. */
export interface ReviewStore {
  /** Schema version of this file. */
  version: number;
  /** Review state keyed by Card.id. */
  reviews: Record<string, ReviewState>;
}
