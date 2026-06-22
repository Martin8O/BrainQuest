// Pure SM-2 spaced-repetition scheduler — NO file system, NO Date.now() inside, so it stays
// deterministic and unit-testable (E2). The clock ("now") is always passed in by the caller:
// the explicit-clock/seed rule for any time-dependent path — same inputs always give the same output.
//
// SM-2 (SuperMemo 2) in one breath: each card carries an interval and an "ease factor". A good
// recall multiplies the interval (it grows: 1 day → 6 → ~15 → …); a failure restarts it. Ease drifts
// up for easy cards, down for hard ones. Simple, well-understood; FSRS can replace it later.
import type { Grade, ReviewState, ReviewStore } from "./types";

/** SM-2 starting ease factor and its hard floor. */
const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Map the 4-button grade onto SM-2's 0–5 quality scale.
 * "again" (< 3) is a lapse; hard/good/easy are increasing passes. The pass values only steer
 * the ease nudge in {@link nextEase} — kept simple and well-spread across the scale.
 */
const QUALITY: Record<Grade, number> = { again: 1, hard: 3, good: 4, easy: 5 };

/** Fresh state for a card that has never been reviewed — due immediately (a "new" card). */
export function newReviewState(cardId: string, now: Date): ReviewState {
  return {
    cardId,
    reps: 0,
    lapses: 0,
    intervalDays: 0,
    ease: INITIAL_EASE,
    due: now.toISOString(),
    lastReviewedAt: null,
    lastGrade: null,
  };
}

/** Add whole days to a timestamp, returning an ISO-8601 string. */
function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/** SM-2 ease-factor update for a given quality, clamped at the floor. */
function nextEase(ease: number, quality: number): number {
  const updated = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return Math.max(MIN_EASE, updated);
}

/**
 * The SM-2 step: given the previous state, a grade, and the current time, return the next state.
 * Pure — returns a new object, never mutates the input.
 */
export function schedule(state: ReviewState, grade: Grade, now: Date): ReviewState {
  const quality = QUALITY[grade];
  const ease = nextEase(state.ease, quality);

  // A lapse ("again"): restart the repetition count and re-show the card the same day.
  if (quality < 3) {
    return {
      ...state,
      reps: 0,
      lapses: state.lapses + 1,
      intervalDays: 0,
      ease,
      due: now.toISOString(),
      lastReviewedAt: now.toISOString(),
      lastGrade: grade,
    };
  }

  // A pass: classic SM-2 interval schedule (1 day, then 6, then previous interval × ease).
  let intervalDays: number;
  if (state.reps === 0) intervalDays = 1;
  else if (state.reps === 1) intervalDays = 6;
  else intervalDays = Math.round(state.intervalDays * ease);

  return {
    ...state,
    reps: state.reps + 1,
    intervalDays,
    ease,
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
