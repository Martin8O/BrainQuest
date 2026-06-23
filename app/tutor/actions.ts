// Server action: the tutor's one write-free entry point the client calls. "use server" means the
// client invokes gradeRecallAnswer() like a function while it runs on the server — where the local
// LLM call and the vault read are allowed to live. Never throws to the client: every failure
// becomes a typed GradeResponse so the UI can show a precise, actionable message.
"use server";

import { readVault } from "@/lib/vault/reader";
import { gradeAnswer, OllamaOfflineError, ModelMissingError } from "@/lib/tutor/grade";
import { loadTutorConfig } from "@/lib/tutor/config";
import type { GradeResponse } from "@/lib/tutor/types";

export async function gradeRecallAnswer(promptId: string, answer: string): Promise<GradeResponse> {
  const trimmed = answer.trim();
  if (!trimmed) return { ok: false, code: "empty", error: "Napiš nejdřív odpověď." };

  // Resolve the prompt server-side from its id, so the client never handles file paths.
  const vault = await readVault();
  const prompt = vault.harvest.recall.find((r) => r.id === promptId);
  if (!prompt) {
    return { ok: false, code: "not-found", error: "Tuhle otázku se nepodařilo najít. Zkus jinou." };
  }

  try {
    const result = await gradeAnswer({
      question: prompt.question,
      sourcePath: prompt.sourcePath,
      answer: trimmed,
    });
    return { ok: true, result };
  } catch (err) {
    if (err instanceof OllamaOfflineError) {
      return {
        ok: false,
        code: "offline",
        error: "Lokální AI (Ollama) neběží. Spusť ji příkazem `ollama serve` a zkus to znovu.",
      };
    }
    if (err instanceof ModelMissingError) {
      const { model } = loadTutorConfig();
      return {
        ok: false,
        code: "model",
        error: `Model „${model}" není stažený. Spusť \`ollama pull ${model}\` a zkus to znovu.`,
      };
    }
    return {
      ok: false,
      code: "api",
      error: err instanceof Error ? `Hodnocení selhalo: ${err.message}` : "Hodnocení selhalo.",
    };
  }
}
