// PURE prompt construction for the tutor — no SDK, no fs, so the verify script can assert the
// exact text we send to Claude without a network call. grade.ts wires this to the API.
import type { Verdict } from "./types";

/** Keep the grounding note bounded so one giant note can't blow the token budget. */
export const MAX_NOTE_CHARS = 8000;

/** The JSON Schema the model's answer is constrained to (structured outputs). */
export const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
    score: { type: "integer", description: "0–100, how complete the answer was" },
    summary: { type: "string", description: "One-sentence Czech verdict the learner reads first" },
    gotRight: {
      type: "array",
      items: { type: "string" },
      description: "Short Czech bullets the answer got right; empty array if nothing landed",
    },
    missed: {
      type: "array",
      items: { type: "string" },
      description: "Key points missed or wrong, each grounded in the note text",
    },
    modelAnswer: {
      type: "string",
      description: "A concise ideal answer assembled from the note",
    },
  },
  required: ["verdict", "score", "summary", "gotRight", "missed", "modelAnswer"],
} as const;

/** Narrowing guard for the model's raw JSON before we trust it as a GradeResult. */
export function isVerdict(v: unknown): v is Verdict {
  return v === "correct" || v === "partial" || v === "incorrect";
}

/**
 * The tutor's persona + rules. English instructions (code stays English), but the GRADED OUTPUT
 * must be Czech, English-term-first — matching how Martin learns. The hard rule that makes D1 a
 * tutor and not a quiz: every miss and the model answer are grounded ONLY in the note's own text.
 */
export const SYSTEM_PROMPT = [
  "You are a patient, encouraging tutor. The learner answers a recall question about a concept",
  "from their own study notes, in their own words. You grade how well their answer matches the note.",
  "",
  "Rules:",
  "- Ground your judgement ONLY in the provided note text. Do not introduce facts that are not in it.",
  "- If the note doesn't cover something, don't penalise the learner for omitting it.",
  "- Be honest but kind: name what they got right before what they missed.",
  "- Write ALL output in Czech. Keep technical terms in English first, then a short Czech gloss",
  "  (e.g. \"server action (serverová akce)\"). This is how the learner builds the vocabulary.",
  "- `missed` and `modelAnswer` must paraphrase the note — that is the whole point of the feedback.",
  "- `score` is 0–100 for how complete the answer was. `verdict`: correct (≥80), partial, incorrect (≤25).",
].join("\n");

/** Build the user turn: the question, the grounding note, and the learner's answer — clearly fenced. */
export function buildUserPrompt(question: string, noteText: string, answer: string): string {
  const note = noteText.length > MAX_NOTE_CHARS ? noteText.slice(0, MAX_NOTE_CHARS) + "\n…(zkráceno)" : noteText;
  return [
    "## Recall question",
    question,
    "",
    "## Source note (the only ground truth — base your feedback on this)",
    "<note>",
    note,
    "</note>",
    "",
    "## The learner's answer",
    "<answer>",
    answer,
    "</answer>",
    "",
    "Grade the answer against the note and return the structured result.",
  ].join("\n");
}
