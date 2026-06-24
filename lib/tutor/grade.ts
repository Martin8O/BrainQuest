// Server-only: grade one free-text answer against its source note. It reads the source note (READ-ONLY —
// never writes the vault) and asks the local model (via the shared Ollama transport) to grade the
// learner's answer against it, constraining the reply to our JSON schema. No API key, no network beyond
// localhost. Imported only by the "use server" tutor action.
import fs from "node:fs/promises";
import { callTutorJson, OllamaOfflineError, ModelMissingError, TutorAuthError } from "./llm";
import { GRADE_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, isVerdict } from "./prompt";
import type { GradeResult } from "./types";

// Re-export the transport errors so existing callers (the tutor action) keep importing them from here.
export { OllamaOfflineError, ModelMissingError, TutorAuthError };

/** Read a learning note from disk (read-only). Bubbles up if the path is gone. */
async function readNote(sourcePath: string): Promise<string> {
  return fs.readFile(sourcePath, "utf8");
}

/** Validate the model's JSON into a GradeResult, clamping score and defaulting arrays. */
function toGradeResult(raw: unknown): GradeResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const verdict = isVerdict(o.verdict) ? o.verdict : "partial";
  const scoreNum = typeof o.score === "number" ? o.score : Number(o.score);
  const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : 0;
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    verdict,
    score,
    summary: typeof o.summary === "string" ? o.summary : "",
    gotRight: asStrings(o.gotRight),
    missed: asStrings(o.missed),
    modelAnswer: typeof o.modelAnswer === "string" ? o.modelAnswer : "",
  };
}

/**
 * Grade one free-text answer against its source note via the local model.
 * `question` is the exact question the learner saw — D1 passes the harvested recall prompt, D2 passes
 * the chosen difficulty variation — but the NOTE is always the single ground truth either way.
 * @throws OllamaOfflineError when the server is down · ModelMissingError when the model isn't pulled
 *         · Error on any other request/parse failure.
 */
export async function gradeAnswer(args: {
  question: string;
  sourcePath: string;
  answer: string;
}): Promise<GradeResult> {
  const noteText = await readNote(args.sourcePath);
  const raw = await callTutorJson({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(args.question, noteText, args.answer),
    schema: GRADE_SCHEMA,
  });
  return toGradeResult(raw);
}
