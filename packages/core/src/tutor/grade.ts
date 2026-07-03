// Grade one free-text answer against its source note. Pure of fs/env: the caller supplies the note text
// (from the pack) and the resolved TutorConfig, and this asks the model (via the shared transport) to
// grade the answer against it, constraining the reply to our JSON schema. Browser-safe → the client
// tutor calls it directly (no server action). Imported by the client tutor layer.
import { callTutorJson, OllamaOfflineError, ModelMissingError, TutorAuthError } from "./llm";
import { GRADE_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, isVerdict } from "./prompt";
import type { TutorConfig } from "./clientConfig";
import type { GradeResult } from "./types";

// Re-export the transport errors so callers keep importing them from here.
export { OllamaOfflineError, ModelMissingError, TutorAuthError };

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
 * Grade one free-text answer against its source note via the configured model.
 * `question` is the exact question the learner saw — D1 passes the harvested recall prompt, D2 passes
 * the chosen difficulty variation — but the NOTE (`noteText`) is always the single ground truth either way.
 * @throws OllamaOfflineError when the server is down · ModelMissingError when the model isn't pulled
 *         · TutorAuthError on a bad paid key · Error on any other request/parse failure.
 */
export async function gradeAnswer(
  args: { question: string; noteText: string; answer: string },
  cfg: TutorConfig,
): Promise<GradeResult> {
  const raw = await callTutorJson(
    {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(args.question, args.noteText, args.answer),
      schema: GRADE_SCHEMA,
    },
    cfg,
  );
  return toGradeResult(raw);
}
