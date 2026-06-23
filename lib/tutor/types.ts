// Shared tutor contracts — the shape the grading route produces and the tutor UI consumes.
// (Contracts in one place: the server builds GradeResult, the client renders it, both import this.)

/** How well the free-text answer matched the note — drives the verdict badge + colour. */
export type Verdict = "correct" | "partial" | "incorrect";

/**
 * Claude's grade of one free-text answer to a "❓ K probrání příště" recall prompt.
 * Every field is in Czech (technical terms English-first) — it's shown to the learner.
 * The misses + model answer are grounded in the source note's own text (D1's whole point).
 */
export interface GradeResult {
  /** correct / partial / incorrect — the headline judgement. */
  verdict: Verdict;
  /** 0–100 self-assessment of how complete the answer was (informative, not a hard gate). */
  score: number;
  /** One-sentence Czech verdict the learner reads first. */
  summary: string;
  /** What the answer got right (each a short Czech bullet); empty when nothing landed. */
  gotRight: string[];
  /** Key points missed or wrong, each drawn from the note (the teaching payload). */
  missed: string[];
  /** A concise ideal answer assembled from the note — the "this is what it should say". */
  modelAnswer: string;
}

/** What the client sends the grading action: which recall prompt + the learner's words. */
export interface GradeInput {
  /** RecallPrompt.id, e.g. "2026-06-22-b3-daily-session-ui#r1" — looked up server-side. */
  promptId: string;
  /** The learner's free-text answer (raw, untrimmed — the action trims). */
  answer: string;
}

/** Why a grade could not be produced — lets the UI show a precise, actionable message. */
export type GradeErrorCode =
  | "offline" // the local Ollama server isn't reachable (not running)
  | "model" // Ollama is up but the configured model isn't pulled
  | "not-found" // promptId didn't match any harvested recall prompt
  | "empty" // the learner submitted a blank answer
  | "api"; // any other request / parsing failure

/** Discriminated result of the grading action — never throws to the client. */
export type GradeResponse =
  | { ok: true; result: GradeResult }
  | { ok: false; code: GradeErrorCode; error: string };
