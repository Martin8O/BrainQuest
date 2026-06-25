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

/** One rephrasing of a recall prompt at a fixed difficulty rung (D2). */
export interface Variation {
  /** 1..4 — the difficulty rung (1 = recall … 4 = analyze). */
  level: number;
  /** Learner-facing difficulty label, English UI ("Recall" … "Analyze"). */
  label: string;
  /** The Bloom band in English (vocabulary the learner is building). */
  bloom: string;
  /** The generated Czech question for this rung. */
  question: string;
}

/**
 * A full difficulty ladder for one recall prompt: the four rungs plus where THIS learner should start,
 * calibrated to their mastery of the prompt's material. The client renders rungs easy → hard and opens
 * at `startLevel`.
 */
export interface VariationLadder {
  /** RecallPrompt.id this ladder belongs to. */
  promptId: string;
  /** The original harvested question — the anchor + the fallback if generation is unavailable. */
  baseQuestion: string;
  /** Calibrated entry rung (1..3): where the learner starts given their mastery. */
  startLevel: number;
  /** The C1 cluster mastery 0..1 that produced startLevel (shown subtly as the "your level" signal). */
  strength: number;
  /** Four rungs, level 1..4 ascending. */
  variations: Variation[];
  /** True when served from the cache (no fresh generation was needed). */
  cached: boolean;
}

/** Why a ladder could not be produced — mirrors GradeErrorCode so the UI handles both the same way. */
export type VariationErrorCode = "offline" | "model" | "not-found" | "api";

/** Discriminated result of the variation action — never throws to the client. */
export type VariationResponse =
  | { ok: true; ladder: VariationLadder }
  // baseQuestion lets the UI fall back to the original question when generation is unavailable.
  | { ok: false; code: VariationErrorCode; error: string; baseQuestion: string | null };

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
