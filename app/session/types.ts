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
  /** Slug of the source learning note (shown as provenance + opened by the in-app reader). */
  sourceSlug: string;
  /** Title of the source learning note (shown on the card, links to the reader). */
  sourceTitle: string;
  /** Project area of the source note (for the area filter), e.g. "brainquest". */
  areaKey: string;
  /** Learner-facing label for that area, e.g. "BrainQuest". */
  areaLabel: string;
  /** The concept this card belongs to — its fuller definition + a skill-tree jump. Null if unlinked. */
  concept: { title: string; gloss: string | null } | null;
  /** Neighbour concept titles that also have a due card — the "where to go next" choices, capped for readability. */
  related: string[];
  /** Current SRS state — drives the per-grade interval hints on the buttons. */
  state: ReviewState;
}

/** One focusable area (project) in the session's filter — mirrors the tutor's areas. */
export interface SessionArea {
  key: string;
  label: string;
  /** How many of today's due cards belong to this area. */
  count: number;
  /** Whether it's ON by default (niche areas like RL are opt-in → off). */
  defaultOn: boolean;
}
