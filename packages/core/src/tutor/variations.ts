// Generate a difficulty ladder of fresh question variations for one recall prompt. Pure of fs/env: the
// caller supplies the note text (from the pack) and the resolved TutorConfig; caching is the caller's job
// (the client persists ladders in IndexedDB). It asks the model (via the shared transport) to produce the
// four rungs, constrained to our schema. Reproducible: the transport pins seed + temperature, so the same
// note yields the same ladder — which is why caching it is safe.
import { callTutorJson } from "./llm";
import {
  RUNGS,
  VARIATION_KEYS,
  VARIATION_SCHEMA,
  VARIATION_SYSTEM_PROMPT,
  buildVariationPrompt,
  rungAt,
} from "./variationPrompt";
import type { TutorConfig } from "./clientConfig";
import type { Variation } from "./types";

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

/**
 * Re-stamp each rung's label + bloom from the code's ladder (RUNGS), keyed by level. label/bloom are
 * DERIVED from the rung, not the model — so a cached entry generated before the labels changed can never
 * resurface stale text. Only the `question` is ever trusted from the cache.
 */
export function withCurrentLabels(variations: Variation[]): Variation[] {
  return variations.map((v) => {
    const rung = rungAt(v.level);
    return { ...v, label: rung.label, bloom: rung.bloom };
  });
}

/**
 * Generate the four-rung ladder for a recall prompt from its source note. On failure the transport errors
 * (OllamaOfflineError / ModelMissingError / TutorAuthError / Error) propagate so the caller can map them
 * to a typed response. Caching (cache hit → skip this call) is the caller's responsibility.
 */
export async function generateLadder(
  args: { question: string; noteText: string },
  cfg: TutorConfig,
): Promise<Variation[]> {
  const raw = await callTutorJson(
    {
      system: VARIATION_SYSTEM_PROMPT,
      user: buildVariationPrompt(args.question, args.noteText),
      schema: VARIATION_SCHEMA,
    },
    cfg,
  );
  return toVariations(raw, args.question);
}
