// Server actions: the tutor's write-free entry points the client calls. "use server" means the client
// invokes these like functions while they run on the server — where the local LLM call, the vault read,
// and the C1 mastery computation are allowed to live. Neither throws to the client: every failure becomes
// a typed response so the UI can show a precise, actionable message.
"use server";

import { readVault } from "@brainquest/core/vault/reader";
import { computeProgress } from "@brainquest/core/progress/mastery";
import { loadReviewStore } from "@brainquest/core/srs/store";
import { gradeAnswer, OllamaOfflineError, ModelMissingError, TutorAuthError } from "@brainquest/core/tutor/grade";
import { getLadder } from "@brainquest/core/tutor/variations";
import { startRungForStrength } from "@brainquest/core/tutor/variationPrompt";
import { loadTutorConfig } from "@brainquest/core/tutor/config";
import type { GradeResponse, VariationResponse } from "@brainquest/core/tutor/types";

export async function gradeRecallAnswer(
  promptId: string,
  answer: string,
  // The exact question the learner saw — D2 passes the chosen difficulty variation; omitted (D1) means
  // grade the original harvested prompt. The NOTE is always resolved from promptId, so it stays the
  // single ground truth either way.
  shownQuestion?: string,
): Promise<GradeResponse> {
  const trimmed = answer.trim();
  if (!trimmed) return { ok: false, code: "empty", error: "Write an answer first." };

  // Resolve the prompt server-side from its id, so the client never handles file paths.
  const vault = await readVault();
  const prompt = vault.harvest.recall.find((r) => r.id === promptId);
  if (!prompt) {
    return { ok: false, code: "not-found", error: "Couldn't find this question. Try another." };
  }

  try {
    const result = await gradeAnswer({
      question: shownQuestion?.trim() || prompt.question,
      sourcePath: prompt.sourcePath,
      answer: trimmed,
    });
    return { ok: true, result };
  } catch (err) {
    if (err instanceof OllamaOfflineError) {
      return {
        ok: false,
        code: "offline",
        error: "The local AI (Ollama) isn't running. Start it with `ollama serve` and try again.",
      };
    }
    if (err instanceof ModelMissingError) {
      const { model } = loadTutorConfig();
      return {
        ok: false,
        code: "model",
        error: `Model “${model}” isn't pulled. Run \`ollama pull ${model}\` and try again.`,
      };
    }
    if (err instanceof TutorAuthError) {
      return {
        ok: false,
        code: "api",
        error: "The paid tutor's API key is missing or invalid. Add `TUTOR_API_KEY` to `local/.env`.",
      };
    }
    return {
      ok: false,
      code: "api",
      error: err instanceof Error ? `Grading failed: ${err.message}` : "Grading failed.",
    };
  }
}

/**
 * Build the difficulty ladder for one recall prompt and calibrate where the learner starts on it.
 * The start rung comes from the learner's C1 mastery of THIS prompt's material (the source note's cluster
 * strength) — reusing the existing mastery number, not a forked notion of "level". Cache hit → instant;
 * miss → one local generation. Never throws: maps generation failures to a typed response that carries
 * the original question so the UI can still show something.
 */
export async function getVariations(promptId: string): Promise<VariationResponse> {
  const vault = await readVault();
  const prompt = vault.harvest.recall.find((r) => r.id === promptId);
  if (!prompt) {
    return { ok: false, code: "not-found", error: "Couldn't find this question. Try another.", baseQuestion: null };
  }

  // Calibrate the entry rung from how well the learner knows this prompt's source note (C1 cluster mastery).
  const store = await loadReviewStore();
  const progress = computeProgress(vault.harvest, vault.learning, store);
  const cluster = progress.clusters.find((c) => c.slug === prompt.sourceSlug);
  const strength = cluster?.avgStrength ?? 0;
  const startLevel = startRungForStrength(strength);

  try {
    const { variations, cached } = await getLadder({
      promptId,
      question: prompt.question,
      sourcePath: prompt.sourcePath,
    });
    return {
      ok: true,
      ladder: { promptId, baseQuestion: prompt.question, startLevel, strength, variations, cached },
    };
  } catch (err) {
    if (err instanceof OllamaOfflineError) {
      return {
        ok: false,
        code: "offline",
        error: "The local AI (Ollama) isn't running — showing the original question. Start `ollama serve` for variations.",
        baseQuestion: prompt.question,
      };
    }
    if (err instanceof ModelMissingError) {
      const { model } = loadTutorConfig();
      return {
        ok: false,
        code: "model",
        error: `Model “${model}” isn't pulled — showing the original question. Run \`ollama pull ${model}\`.`,
        baseQuestion: prompt.question,
      };
    }
    if (err instanceof TutorAuthError) {
      return {
        ok: false,
        code: "api",
        error: "Missing paid-tutor API key (`TUTOR_API_KEY` in `local/.env`) — showing the original question.",
        baseQuestion: prompt.question,
      };
    }
    return {
      ok: false,
      code: "api",
      error: "Couldn't generate variations — showing the original question.",
      baseQuestion: prompt.question,
    };
  }
}
