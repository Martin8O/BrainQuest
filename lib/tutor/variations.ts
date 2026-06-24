// Server-only: generate (or reuse) a difficulty ladder of fresh question variations for one recall
// prompt. It reads the source note (READ-ONLY — never writes the vault), checks the cache, and only on a
// miss asks the local model (via the shared Ollama transport) to produce the four rungs, constrained to
// our schema. Imported only by the "use server" tutor action. Reproducible: the transport pins seed +
// temperature, so the same note yields the same ladder — which is also why caching it is safe.
import fs from "node:fs/promises";
import { callTutorJson } from "./llm";
import { loadTutorConfig } from "./config";
import {
  RUNGS,
  VARIATION_KEYS,
  VARIATION_SCHEMA,
  VARIATION_SYSTEM_PROMPT,
  buildVariationPrompt,
} from "./variationPrompt";
import {
  getCachedVariations,
  hashNote,
  loadVariationCache,
  saveVariationCache,
} from "./variationStore";
import type { Variation } from "./types";

/** Read a learning note from disk (read-only). Bubbles up if the path is gone. */
async function readNote(sourcePath: string): Promise<string> {
  return fs.readFile(sourcePath, "utf8");
}

/**
 * Validate the model's raw JSON (keys r1..r4) into the four ordered rungs. Each rung's label/bloom come
 * from our fixed ladder (RUNGS) — never the model — so a flaky reply can't mislabel difficulty. A missing
 * or non-string question falls back to the original so the ladder is always complete and renderable.
 */
function toVariations(raw: unknown, fallbackQuestion: string): Variation[] {
  const o = (raw ?? {}) as Record<string, unknown>;
  return RUNGS.map((rung) => {
    const q = o[VARIATION_KEYS[rung.level - 1]];
    const question = typeof q === "string" && q.trim() ? q.trim() : fallbackQuestion;
    return { level: rung.level, label: rung.label, bloom: rung.bloom, question };
  });
}

/** Result of asking for a ladder — `cached` tells the caller (and UI) whether generation actually ran. */
export interface GeneratedLadder {
  variations: Variation[];
  cached: boolean;
}

/**
 * Get the four-rung ladder for a recall prompt: cache hit (same note + model) → instant; miss → generate,
 * persist, return. On generation failure the transport errors (OllamaOfflineError / ModelMissingError /
 * Error) propagate so the action can map them to a typed response.
 */
export async function getLadder(args: {
  promptId: string;
  question: string;
  sourcePath: string;
}): Promise<GeneratedLadder> {
  const { model } = loadTutorConfig();
  const noteText = await readNote(args.sourcePath);
  const noteHash = hashNote(noteText);

  const cache = await loadVariationCache();
  const hit = getCachedVariations(cache, args.promptId, noteHash, model);
  if (hit) return { variations: hit, cached: true };

  const raw = await callTutorJson({
    system: VARIATION_SYSTEM_PROMPT,
    user: buildVariationPrompt(args.question, noteText),
    schema: VARIATION_SCHEMA,
  });
  const variations = toVariations(raw, args.question);

  cache.entries[args.promptId] = {
    noteHash,
    model,
    generatedAt: new Date().toISOString(),
    variations,
  };
  await saveVariationCache(cache);

  return { variations, cached: false };
}
