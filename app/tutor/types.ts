// The shape the tutor page hands its client component: a recall prompt stripped of server-only
// fields (no file path). The client picks one, the learner answers, the action grades it by id.
export interface TutorPrompt {
  /** RecallPrompt.id — the key the grading action resolves back to the note. */
  id: string;
  /** The "❓ K probrání příště" question, cleaned for display. */
  question: string;
  /** Slug of the source note (shown as provenance). */
  sourceSlug: string;
}
