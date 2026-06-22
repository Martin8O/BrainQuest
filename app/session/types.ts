// The shape the session page hands to the client component: a due card's content (from the B1
// harvest) joined with its current SRS state (from B2). Contracts in one place — the server builds
// it, the client renders it, both import this type.
import type { ReviewState } from "@/lib/srs/types";

/** One card queued for review in the daily session: harvested content + its scheduling state. */
export interface SessionCard {
  /** The Card.id — the key recordReview schedules on. */
  id: string;
  /** The English term shown first (the question side). */
  front: string;
  /** The Czech gloss + definition revealed on flip (the answer side). */
  back: string;
  /** The `[[concept]]` this card belongs to, or null. */
  conceptLink: string | null;
  /** Slug of the source learning note (shown as provenance). */
  sourceSlug: string;
  /** Current SRS state — drives the per-grade interval hints on the buttons. */
  state: ReviewState;
}
