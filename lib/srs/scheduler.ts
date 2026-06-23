// Pure SM-2 spaced-repetition scheduler — NO file system, NO Date.now() inside, so it stays
// deterministic and unit-testable (E2). The clock ("now") is always passed in by the caller:
// the explicit-clock/seed rule for any time-dependent path — same inputs always give the same output.
//
// SM-2 (SuperMemo 2) in one breath: each card carries an interval and an "ease factor". A pass
// multiplies the interval (it grows); a failure restarts it. Ease drifts up for easy cards, down for
// hard ones. Simple, well-understood; FSRS can replace it later.
//
// One deliberate change from textbook SM-2: the four grade buttons must MEAN something on every
// review, including a brand-new card. Plain SM-2 gives every passing grade interval=1 on the first
// review (grade only nudged ease, which doesn't bite until rep 3), so Hard/Good/Easy all read "1d"
// and the buttons feel pointless. Instead, grades drive the interval directly: a new card graduates
// on a per-grade ramp (Hard 1d · Good 3d · Easy 7d), and an established card grows by a grade-specific
// factor of its current interval (Hard slow, Good × ease, Easy × ease with a bonus).
import type { Grade, ReviewState, ReviewStore } from "./types";

/** SM-2 starting ease factor and its hard floor. */
const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** First-pass ("graduating") interval in days, per grade — what a brand-new card jumps to. */
const GRADUATING_DAYS: Record<Exclude<Grade, "again">, number> = { hard: 1, good: 3, easy: 7 };
/** Hard grows the interval slowly (instead of by ease); never less than +1 day so it still advances. */
const HARD_MULT = 1.2;
/** Easy gets a bonus on top of ease, so "I really know this" pushes the interval out faster. */
const EASY_BONUS = 1.3;

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

  // A pass: grade-aware interval. A new card (reps 0) graduates on the fixed per-grade ramp; an
  // established card grows by a grade-specific factor of its current interval. (See the file header.)
  const pass = grade as Exclude<Grade, "again">;
  let intervalDays: number;
  if (state.reps === 0) {
    intervalDays = GRADUATING_DAYS[pass];
  } else {
    const grown =
      pass === "hard"
        ? Math.max(state.intervalDays + 1, Math.round(state.intervalDays * HARD_MULT))
        : pass === "good"
          ? Math.round(state.intervalDays * ease)
          : Math.round(state.intervalDays * ease * EASY_BONUS);
    intervalDays = Math.max(1, grown);
  }

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
