// The shape the tutor page hands its client component: a recall prompt stripped of server-only
// fields (no file path). The client picks one, the learner answers, the action grades it by id.
export interface TutorPrompt {
  /** RecallPrompt.id — the key the grading action resolves back to the note. */
  id: string;
  /** The "❓ K probrání příště" question, cleaned for display. */
  question: string;
  /** Slug of the source note (shown as provenance). */
  sourceSlug: string;
  /** Area (project) key this prompt belongs to — the category filter keys off this. */
  areaKey: string;
  /** Learner-facing area label (shown on the filter chip). */
  areaLabel: string;
}

/** One toggleable category in the tutor's area filter (one per project present in the harvest). */
export interface TutorArea {
  key: string;
  label: string;
  /** How many recall prompts fall in this area (shown on the chip). */
  count: number;
  /** Whether it starts ON (niche areas like RL default OFF). */
  defaultOn: boolean;
}
