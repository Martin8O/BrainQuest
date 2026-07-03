// Pure, storage-agnostic review-store logic — NO fs, NO clock inside (the clock is injected). It owns the
// review-store SHAPE, the forward migration between versions, and applying one review; the WHERE it is
// persisted (node:fs on the server, IndexedDB in the browser) is a thin adapter's job. Splitting this out
// is what lets the mobile/client build (M2) reuse the exact same migration + scheduling the Node store used.
import { localDateKey } from "../gamification/engine";
import { initDifficulty, initStability } from "./fsrs";
import { newReviewState, schedule } from "./scheduler";
import type { Grade, ReviewState, ReviewStore } from "./types";

/**
 * Current review-store schema version.
 * - v2 added the `daily` activity log for streaks/XP.
 * - v3 (F1) swapped each card's SM-2 fields (`ease`) for FSRS (`stability` + `difficulty`).
 */
export const REVIEW_STORE_VERSION = 3;

/** An empty, valid store — used when nothing is persisted yet. */
export function emptyStore(): ReviewStore {
  return { version: REVIEW_STORE_VERSION, reviews: {}, daily: {} };
}

/** A pre-FSRS (SM-2) review state — recognised by the absence of an FSRS `stability` field. */
type LegacyReviewState = Partial<ReviewState> & { ease?: number };

/** True for a stored state written before F1 (SM-2 shape: has `ease`, no `stability`). */
function isLegacyState(s: unknown): s is LegacyReviewState {
  return typeof s === "object" && s !== null && typeof (s as ReviewState).stability !== "number";
}

/**
 * Convert one SM-2 review state to FSRS (the v2→v3 migration). We seed FSRS *stability* from the card's
 * existing interval — interval ≈ stability at 90% retention, so the card keeps its current schedule — and
 * reset *difficulty* to the neutral "good" default (w4): SM-2's ease factor does not map cleanly onto
 * FSRS difficulty, so we discard it and let FSRS re-learn difficulty from the next few reviews. Reps,
 * lapses, due, and the timestamps carry over unchanged — the upgrade disturbs nothing; FSRS simply takes
 * over from the next review.
 */
function migrateLegacyState(legacy: LegacyReviewState, cardId: string): ReviewState {
  const intervalDays = typeof legacy.intervalDays === "number" ? legacy.intervalDays : 0;
  return {
    cardId,
    reps: legacy.reps ?? 0,
    lapses: legacy.lapses ?? 0,
    intervalDays,
    stability: Math.max(initStability("again"), intervalDays), // floor at the minimal (post-fail) initial stability
    difficulty: initDifficulty("good"), // neutral D0(good) seed; FSRS re-learns difficulty from the next reviews
    due: legacy.due ?? new Date(0).toISOString(), // missing due → epoch (due immediately), defensive only
    lastReviewedAt: legacy.lastReviewedAt ?? null,
    lastGrade: legacy.lastGrade ?? null,
  };
}

/**
 * Parse an untrusted persisted value into the current store shape, forward-migrating older versions.
 * v1 files have no `daily` (→ empty); v1/v2 files store SM-2 states (→ converted to FSRS, F1). The
 * streak/XP `daily` log is preserved as-is. A missing/garbage value yields an empty store rather than
 * throwing, so a corrupt persistence layer can never wedge the app.
 */
export function parseReviewStore(raw: unknown): ReviewStore {
  if (!raw || typeof raw !== "object") return emptyStore();
  const parsed = raw as Partial<ReviewStore> & { reviews?: Record<string, unknown> };
  const reviews: Record<string, ReviewState> = {};
  for (const [id, s] of Object.entries(parsed.reviews ?? {})) {
    reviews[id] = isLegacyState(s) ? migrateLegacyState(s, id) : (s as ReviewState);
  }
  return { version: REVIEW_STORE_VERSION, reviews, daily: parsed.daily ?? {} };
}

/**
 * Apply one review to a store (pure): schedule the card with FSRS and tally today's activity. Returns a
 * NEW store plus the updated card state — the caller decides how to persist it. `now` is injected so the
 * result stays deterministic/testable, exactly like the scheduler.
 */
export function applyReview(
  store: ReviewStore,
  cardId: string,
  grade: Grade,
  now: Date,
): { store: ReviewStore; state: ReviewState } {
  const prev = store.reviews[cardId] ?? newReviewState(cardId, now);
  const state = schedule(prev, grade, now);
  const day = localDateKey(now);
  const next: ReviewStore = {
    version: REVIEW_STORE_VERSION,
    reviews: { ...store.reviews, [cardId]: state },
    daily: { ...store.daily, [day]: (store.daily[day] ?? 0) + 1 },
  };
  return { store: next, state };
}
