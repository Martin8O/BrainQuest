// SRS (spaced-repetition system) contracts — the single shape the scheduler produces and
// persistence stores. Contracts in one place: change the review model here, never ad hoc.

/** How well a card was recalled. The 4-button scale the daily session (B3) will show. */
export type Grade = "again" | "hard" | "good" | "easy";

/** Per-card scheduling state, evolved by the FSRS step on each review (F1; was SM-2 through E2). */
export interface ReviewState {
  /** The Card.id this state schedules (e.g. "2026-06-22-b1-...#c0"). */
  cardId: string;
  /**
   * Successful repetitions in a row; reset to 0 on a lapse. Kept as a derived counter for the mastery
   * "new" gate and the UI — FSRS itself does not use it (its memory lives in stability + difficulty).
   */
  reps: number;
  /** How many times the card has been failed ("again") — diagnostics, not used by the FSRS math. */
  lapses: number;
  /** Current interval in whole days: the FSRS-scheduled gap from the last review to the next. */
  intervalDays: number;
  /**
   * FSRS stability: the number of days until recall probability decays to ~90%. 0 until the first
   * review; grows with each successful recall. The card's "how durable is this memory" number.
   */
  stability: number;
  /** FSRS difficulty (1..10): how intrinsically hard the card is. 0 until the first review. */
  difficulty: number;
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
  /**
   * Lifetime activity log: local calendar day (YYYY-MM-DD) → reviews graded that day. Added in v2 to
   * feed the streak + XP (gamification): a streak needs to know *which days* you studied, and per-card
   * state can't tell us — `lastReviewedAt` is overwritten each review, losing the history. This is the
   * one thing the motivation layer genuinely must store rather than derive.
   */
  daily: Record<string, number>;
}
