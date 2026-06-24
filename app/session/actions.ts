// Server action: the one write path the daily session calls from the client. Marking the file
// "use server" lets the client component call gradeCard() like a function while it actually runs on
// the server — that's where node:fs (and recordReview) is allowed to live.
"use server";

import fs from "node:fs/promises";
import { recordReview, loadReviewStore } from "@/lib/srs/store";
import { readVault } from "@/lib/vault/reader";
import { computeProgress, gamificationFor } from "@/lib/progress/mastery";
import { callTutorJson, OllamaOfflineError, ModelMissingError, TutorAuthError } from "@/lib/tutor/llm";
import type { Grade, ReviewState } from "@/lib/srs/types";
import type { GamificationState } from "@/lib/gamification/types";

/**
 * Record one review and return the updated SRS state.
 * Persists via the B2 store (load → pure FSRS schedule → atomic save). Uses the real clock here —
 * the daily session is live use; the scheduler itself stays deterministic (now is injected for it).
 */
export async function gradeCard(cardId: string, grade: Grade): Promise<ReviewState> {
  return recordReview(cardId, grade);
}

/**
 * Recompute the live gamification state (XP, level, streak) from the freshly-persisted store + mastery.
 * The session calls this when the queue is finished — by then every grade is saved, so the celebration
 * shows accurate, post-session numbers and can detect a level-up versus where the learner started.
 */
export async function getGamification(): Promise<GamificationState> {
  const now = new Date();
  const vault = await readVault();
  const store = await loadReviewStore();
  const progress = computeProgress(vault.harvest, vault.learning, store);
  return gamificationFor(progress, store, now);
}

/** Reply shape for the on-demand "Explain more" — the LLM elaborates on a card's term, or a soft error. */
export type ExplainResponse = { ok: true; text: string } | { ok: false; error: string };

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: { explanation: { type: "string", description: "A fuller explanation, in Czech (English terms stay English)" } },
  required: ["explanation"],
} as const;

/**
 * Ask the configured tutor LLM to elaborate on one card's term, grounded in its source note. Content stays
 * in the vault's language (Czech here); errors are surfaced as a short English message. Never throws.
 */
export async function explainTerm(cardId: string): Promise<ExplainResponse> {
  const vault = await readVault();
  const card = vault.harvest.cards.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "Card not found." };

  let note = "";
  try {
    note = await fs.readFile(card.sourcePath, "utf8");
  } catch {
    // The note may be gone; fall back to just the card's own gloss as context.
  }

  try {
    const raw = (await callTutorJson({
      system:
        "Jsi učitel. Vysvětli zadaný pojem podrobněji a srozumitelně v češtině (anglický termín nech anglicky), 2–4 věty, výhradně na základě poznámky a definice. Nevymýšlej si nic, co tam není.",
      user: `Pojem: ${card.front}\nStručná definice: ${card.back}\n\nKontext (poznámka):\n${note.slice(0, 6000)}\n\nVysvětli ten pojem podrobněji než stručná definice.`,
      schema: EXPLAIN_SCHEMA,
    })) as { explanation?: unknown };
    const text = typeof raw.explanation === "string" ? raw.explanation.trim() : "";
    if (!text) return { ok: false, error: "No explanation returned — try again." };
    return { ok: true, text };
  } catch (err) {
    if (err instanceof OllamaOfflineError) return { ok: false, error: "Local AI (Ollama) isn't running." };
    if (err instanceof ModelMissingError) return { ok: false, error: "The configured model isn't pulled." };
    if (err instanceof TutorAuthError) return { ok: false, error: "Missing API key — set TUTOR_API_KEY in local/.env." };
    return { ok: false, error: "Couldn't generate an explanation right now." };
  }
}
