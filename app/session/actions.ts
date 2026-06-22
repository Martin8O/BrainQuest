// Server action: the one write path the daily session calls from the client. Marking the file
// "use server" lets the client component call gradeCard() like a function while it actually runs on
// the server — that's where node:fs (and recordReview) is allowed to live.
"use server";

import { recordReview } from "@/lib/srs/store";
import type { Grade, ReviewState } from "@/lib/srs/types";

/**
 * Record one review and return the updated SRS state.
 * Persists via the B2 store (load → pure SM-2 schedule → atomic save). Uses the real clock here —
 * the daily session is live use; the scheduler itself stays deterministic (now is injected for it).
 */
export async function gradeCard(cardId: string, grade: Grade): Promise<ReviewState> {
  return recordReview(cardId, grade);
}
