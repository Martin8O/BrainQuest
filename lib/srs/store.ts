// Server-only persistence for review state — reads/writes data/reviews.json with node:fs.
// The scheduler stays pure; ALL disk I/O lives here. data/ is committed app state, never secrets.
// READ/WRITE FENCE: this touches only the repo's data/ dir — never the read-only vault vault.
import fs from "node:fs/promises";
import path from "node:path";
import { localDateKey } from "@/lib/gamification/engine";
import { initDifficulty, initStability } from "./fsrs";
import { newReviewState, schedule } from "./scheduler";
import type { Grade, ReviewState, ReviewStore } from "./types";

/**
 * Current data/reviews.json schema version.
 * - v2 added the `daily` activity log for streaks/XP.
 * - v3 (F1) swapped each card's SM-2 fields (`ease`) for FSRS (`stability` + `difficulty`).
 */
export const REVIEW_STORE_VERSION = 3;

/** An empty, valid store — used when the file does not exist yet. */
export function emptyStore(): ReviewStore {
  return { version: REVIEW_STORE_VERSION, reviews: {}, daily: {} };
}

/** The data/ directory — overridable via BRAINQUEST_DATA_DIR so other machines/tests can redirect it. */
function dataDir(): string {
  return process.env.BRAINQUEST_DATA_DIR ?? path.join(process.cwd(), "data");
}

/** Absolute path of the review store file. */
export function reviewsPath(): string {
  return path.join(dataDir(), "reviews.json");
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

/** Load the review store, returning an empty store if the file is absent. */
export async function loadReviewStore(): Promise<ReviewStore> {
  try {
    const raw = await fs.readFile(reviewsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ReviewStore> & { reviews?: Record<string, unknown> };
    // Forward-migrate to the current shape: v1 files have no `daily` (→ empty), and v1/v2 files store
    // SM-2 states (→ converted to FSRS, F1). We stamp the current version so the next save writes the
    // up-to-date format; the streak/XP `daily` log is preserved as-is.
    const reviews: Record<string, ReviewState> = {};
    for (const [id, s] of Object.entries(parsed.reviews ?? {})) {
      reviews[id] = isLegacyState(s) ? migrateLegacyState(s, id) : (s as ReviewState);
    }
    return { version: REVIEW_STORE_VERSION, reviews, daily: parsed.daily ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw err;
  }
}

/** Persist the store atomically (write a temp file, then rename) so a crash can't truncate it. */
export async function saveReviewStore(store: ReviewStore): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const file = reviewsPath();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

/**
 * Record one review: load → schedule (pure FSRS) → save, returning the updated state.
 * The single write path the daily session (B3) will call. `now` defaults to the real clock
 * but can be injected for reproducibility/testing.
 */
export async function recordReview(
  cardId: string,
  grade: Grade,
  now: Date = new Date(),
): Promise<ReviewState> {
  const store = await loadReviewStore();
  const prev = store.reviews[cardId] ?? newReviewState(cardId, now);
  const next = schedule(prev, grade, now);
  store.reviews[cardId] = next;
  // Tally today's activity (local day) — the streak/XP read this lifetime log, not per-card state.
  const day = localDateKey(now);
  store.daily[day] = (store.daily[day] ?? 0) + 1;
  await saveReviewStore(store);
  return next;
}
