// Server-only persistence for review state — reads/writes data/reviews.json with node:fs.
// The scheduler stays pure; ALL disk I/O lives here. data/ is committed app state, never secrets.
// READ/WRITE FENCE: this touches only the repo's data/ dir — never the read-only vault vault.
import fs from "node:fs/promises";
import path from "node:path";
import { newReviewState, schedule } from "./scheduler";
import type { Grade, ReviewState, ReviewStore } from "./types";

/** Current data/reviews.json schema version. */
export const REVIEW_STORE_VERSION = 1;

/** An empty, valid store — used when the file does not exist yet. */
export function emptyStore(): ReviewStore {
  return { version: REVIEW_STORE_VERSION, reviews: {} };
}

/** The data/ directory — overridable via BRAINQUEST_DATA_DIR so other machines/tests can redirect it. */
function dataDir(): string {
  return process.env.BRAINQUEST_DATA_DIR ?? path.join(process.cwd(), "data");
}

/** Absolute path of the review store file. */
export function reviewsPath(): string {
  return path.join(dataDir(), "reviews.json");
}

/** Load the review store, returning an empty store if the file is absent. */
export async function loadReviewStore(): Promise<ReviewStore> {
  try {
    const raw = await fs.readFile(reviewsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ReviewStore>;
    // Be lenient about a missing field; normalize to the current shape.
    return { version: parsed.version ?? REVIEW_STORE_VERSION, reviews: parsed.reviews ?? {} };
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
 * Record one review: load → schedule (pure SM-2) → save, returning the updated state.
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
  await saveReviewStore(store);
  return next;
}
