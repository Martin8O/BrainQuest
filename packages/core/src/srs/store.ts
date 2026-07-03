// Node/fs persistence for review state — reads/writes data/reviews.json with node:fs. The SHAPE, the
// forward migration, and applying a review are all pure and live in ./reviewStore.ts; this file is only
// the disk adapter (the browser build uses an IndexedDB adapter over the same pure core). data/ is
// committed app state, never secrets. READ/WRITE FENCE: touches only data/ — never the read-only vault.
import fs from "node:fs/promises";
import path from "node:path";
import { applyReview, emptyStore, parseReviewStore, REVIEW_STORE_VERSION } from "./reviewStore";
import type { Grade, ReviewState, ReviewStore } from "./types";

// Re-export so existing importers (tests) keep their entry points.
export { emptyStore, REVIEW_STORE_VERSION };

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
    return parseReviewStore(JSON.parse(raw));
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
 * Record one review: load → apply (pure FSRS schedule + activity tally) → save, returning the updated
 * state. `now` defaults to the real clock but can be injected for reproducibility/testing.
 */
export async function recordReview(
  cardId: string,
  grade: Grade,
  now: Date = new Date(),
): Promise<ReviewState> {
  const { store, state } = applyReview(await loadReviewStore(), cardId, grade, now);
  await saveReviewStore(store);
  return state;
}
