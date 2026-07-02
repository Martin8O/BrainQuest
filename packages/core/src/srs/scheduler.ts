// Pure spaced-repetition scheduler — NO file system, NO Date.now() inside, so it stays deterministic
// and unit-testable (E2). The clock ("now") is always passed in by the caller: the explicit-clock rule
// for any time-dependent path — same inputs always give the same output.
//
// As of F1 the engine is FSRS-4.5 (a probabilistic memory model: stability + difficulty + retrievability)
// instead of SM-2. The math lives in ./fsrs.ts; this file is the thin state machine that turns "previous
// state + grade + now" into "next state" and answers the daily-queue questions. The public API is
// unchanged from the SM-2 version (newReviewState / schedule / isDue / ensureStates / selectDue), so the
// store, the session UI, and the mastery model did not have to change.
//
// FSRS is grade-aware by construction: a new card's opening grade sets its initial stability directly
// (Again≈0.5d · Hard≈1d · Good≈4d · Easy≈14d), so the four buttons mean something on every review without
// the per-grade ramp SM-2 needed (C3). See ./fsrs.ts for the model itself.
import {
  initDifficulty,
  initStability,
  intervalFromStability,
  nextDifficulty,
  nextLapseStability,
  nextRecallStability,
  retrievability,
} from "./fsrs";
import type { Grade, ReviewState, ReviewStore } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fresh state for a card that has never been reviewed — due immediately, with no FSRS memory yet. */
export function newReviewState(cardId: string, now: Date): ReviewState {
  return {
    cardId,
    reps: 0,
    lapses: 0,
    intervalDays: 0,
    stability: 0, // set on the first review (initStability)
    difficulty: 0, // set on the first review (initDifficulty)
    due: now.toISOString(),
    lastReviewedAt: null,
    lastGrade: null,
  };
}

/** Add whole days to a timestamp, returning an ISO-8601 string. */
function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/** Days elapsed since the last review (fractional). 0 if the card was never reviewed or the clock skews. */
function elapsedDays(state: ReviewState, now: Date): number {
  if (!state.lastReviewedAt) return 0;
  return Math.max(0, (now.getTime() - new Date(state.lastReviewedAt).getTime()) / DAY_MS);
}

/**
 * The FSRS step: given the previous state, a grade, and the current time, return the next state.
 * Pure — returns a new object, never mutates the input.
 *
 * A brand-new card (never reviewed → lastReviewedAt null) seeds its memory from the opening grade. An
 * established card updates stability/difficulty from how retrievable it was at review time. Note a card
 * is "new" by `lastReviewedAt`, not by `reps`: a lapse resets reps to 0 but the card keeps its FSRS
 * memory, so a relapse still grows from the reduced post-lapse stability.
 */
export function schedule(state: ReviewState, grade: Grade, now: Date): ReviewState {
  const isNew = state.lastReviewedAt === null;

  let stability: number;
  let difficulty: number;
  if (isNew) {
    stability = initStability(grade);
    difficulty = initDifficulty(grade);
  } else {
    const r = retrievability(elapsedDays(state, now), state.stability);
    stability =
      grade === "again"
        ? nextLapseStability(state.difficulty, state.stability, r)
        : nextRecallStability(state.difficulty, state.stability, r, grade);
    difficulty = nextDifficulty(state.difficulty, grade);
  }

  // A lapse ("again") restarts the rep streak and re-shows the card the same day (lightweight relearning);
  // the reduced stability above is what the next successful interval will grow from.
  if (grade === "again") {
    return {
      ...state,
      reps: 0,
      lapses: state.lapses + 1,
      intervalDays: 0,
      stability,
      difficulty,
      due: now.toISOString(),
      lastReviewedAt: now.toISOString(),
      lastGrade: grade,
    };
  }

  const intervalDays = intervalFromStability(stability);
  return {
    ...state,
    reps: state.reps + 1,
    intervalDays,
    stability,
    difficulty,
    due: addDays(now, intervalDays),
    lastReviewedAt: now.toISOString(),
    lastGrade: grade,
  };
}

/** Is this card due at the given time? */
export function isDue(state: ReviewState, now: Date): boolean {
  return new Date(state.due).getTime() <= now.getTime();
}

/**
 * Return the review state for every given card id, creating fresh "new" state for unseen cards.
 * Bridges the harvested cards (B1) to their schedule without mutating the stored data.
 */
export function ensureStates(store: ReviewStore, cardIds: string[], now: Date): ReviewState[] {
  return cardIds.map((id) => store.reviews[id] ?? newReviewState(id, now));
}

/** The due subset, soonest-due first — the queue the daily session (B3) will walk. */
export function selectDue(states: ReviewState[], now: Date): ReviewState[] {
  return states.filter((s) => isDue(s, now)).sort((a, b) => a.due.localeCompare(b.due));
}
