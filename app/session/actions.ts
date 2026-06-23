// Server action: the one write path the daily session calls from the client. Marking the file
// "use server" lets the client component call gradeCard() like a function while it actually runs on
// the server — that's where node:fs (and recordReview) is allowed to live.
"use server";

import { recordReview, loadReviewStore } from "@/lib/srs/store";
import { readVault } from "@/lib/vault/reader";
import { computeProgress, gamificationFor } from "@/lib/progress/mastery";
import type { Grade, ReviewState } from "@/lib/srs/types";
import type { GamificationState } from "@/lib/gamification/types";

/**
 * Record one review and return the updated SRS state.
 * Persists via the B2 store (load → pure SM-2 schedule → atomic save). Uses the real clock here —
 * the daily session is live use; the scheduler itself stays deterministic (now is injected for it).
 */
export async function gradeCard(cardId: string, grade: Grade): Promise<ReviewState> {
  return recordReview(cardId, grade);
}

/**
 * Recompute the live gamification state (XP, level, streak) from the freshly-persisted store + mastery.
 * The session calls this when the queue is finished — by then every grade is saved, so the celebration
 * shows accurate, post-session numbers and can detect a level-up versus where the learner started.
 */
export async function getGamification(): Promise<GamificationState> {
  const now = new Date();
  const vault = await readVault();
  const store = await loadReviewStore();
  const progress = computeProgress(vault.harvest, vault.learning, store);
  return gamificationFor(progress, store, now);
}
