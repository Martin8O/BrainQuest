// Client-side AI tutor (M2). The tutor now runs entirely in the browser: the backend choice + the user's
// own API key live in device storage (localStorage), and grading/variation calls go straight from the
// page to the chosen LLM (local Ollama or a paid API) — no server action. It is OPT-IN and OFF by default
// (`enabled: false`): nothing is sent anywhere until the user turns it on in Settings and picks a backend.
// Generated question ladders are cached in IndexedDB (slow local generation → generate once, reuse).
import {
  gradeAnswer,
  OllamaOfflineError,
  ModelMissingError,
  TutorAuthError,
} from "@brainquest/core/tutor/grade";
import { generateLadder, withCurrentLabels } from "@brainquest/core/tutor/variations";
import { startRungForStrength } from "@brainquest/core/tutor/variationPrompt";
import { hashNoteText } from "@brainquest/core/tutor/hash";
import {
  DEFAULT_MODEL,
  DEFAULT_OLLAMA_BASE,
  type TutorConfig,
  type TutorProvider,
} from "@brainquest/core/tutor/clientConfig";
import type { GradeResponse, Variation, VariationResponse } from "@brainquest/core/tutor/types";
import { idbGet, idbSet, VARIATIONS_STORE } from "./idb";

/** The device-stored tutor settings: the injected TutorConfig plus the opt-in flag. */
export interface TutorClientConfig extends TutorConfig {
  /** Master switch — the tutor stays OFF (no calls, no key needed) until the user enables it. */
  enabled: boolean;
}

const CONFIG_KEY = "bq.tutor.config";

/** The accepted backends — a tampered/corrupt stored `provider` is coerced back to a known one. */
const VALID_PROVIDERS: readonly TutorProvider[] = ["ollama", "anthropic", "openai"];

/** Off-by-default settings: local Ollama, no key. Nothing leaves the device until `enabled` is set. */
export function defaultTutorConfig(): TutorClientConfig {
  return { enabled: false, provider: "ollama", model: DEFAULT_MODEL.ollama, baseUrl: DEFAULT_OLLAMA_BASE, apiKey: "" };
}

/** Load the device tutor settings (merged over defaults), tolerating missing/blocked/corrupt storage. */
export function loadTutorConfig(): TutorClientConfig {
  if (typeof localStorage === "undefined") return defaultTutorConfig();
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultTutorConfig();
    const merged = { ...defaultTutorConfig(), ...(JSON.parse(raw) as Partial<TutorClientConfig>) };
    if (!VALID_PROVIDERS.includes(merged.provider)) merged.provider = "ollama";
    return merged;
  } catch {
    return defaultTutorConfig();
  }
}

/** Persist the device tutor settings. Best-effort (blocked storage is non-fatal). */
export function saveTutorConfig(cfg: TutorClientConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // ignore — persistence is best-effort
  }
}

/** Strip the opt-in flag to the plain TutorConfig the transport consumes. */
function toTutorConfig(c: TutorClientConfig): TutorConfig {
  return { provider: c.provider, baseUrl: c.baseUrl, model: c.model, apiKey: c.apiKey || undefined };
}

/** A short, precise message per backend failure — shared by grading and variation calls. */
function providerError(err: unknown, provider: TutorProvider): { code: "offline" | "model" | "api"; error: string } {
  if (err instanceof OllamaOfflineError) {
    return {
      code: "offline",
      error: "The local AI (Ollama) isn't reachable. Start it (`ollama serve`) and allow this app's origin via OLLAMA_ORIGINS.",
    };
  }
  if (err instanceof ModelMissingError) {
    return { code: "model", error: "The configured model isn't pulled. Pull it in Ollama and try again." };
  }
  if (err instanceof TutorAuthError) {
    return { code: "api", error: "The API key is missing or invalid — check it in Settings." };
  }
  const base = provider === "ollama" ? "the local model" : "the API";
  return { code: "api", error: err instanceof Error ? `Request to ${base} failed: ${err.message}` : "Request failed." };
}

/** Grade one free-text answer against its source note text via the device-configured backend. */
export async function gradeRecallAnswerClient(
  args: { question: string; noteText: string; answer: string },
  cfg: TutorClientConfig,
): Promise<GradeResponse> {
  const trimmed = args.answer.trim();
  if (!trimmed) return { ok: false, code: "empty", error: "Write an answer first." };
  if (!cfg.enabled) return { ok: false, code: "api", error: "Enable the AI tutor in Settings first." };
  try {
    const result = await gradeAnswer({ question: args.question, noteText: args.noteText, answer: trimmed }, toTutorConfig(cfg));
    return { ok: true, result };
  } catch (err) {
    const { code, error } = providerError(err, cfg.provider);
    return { ok: false, code, error };
  }
}

/** One cached ladder in IndexedDB: the questions + the fingerprint that decides if it's still valid. */
interface CachedLadder {
  noteHash: string;
  model: string;
  /** The backend that produced it — a different provider writes different questions even at the same model tag. */
  provider: TutorProvider;
  variations: Variation[];
}

/**
 * Build the difficulty ladder for a recall prompt, calibrated to the learner's mastery (`strength`). A
 * cache hit (same note + model) is instant; a miss generates once and persists. Never throws — failures
 * become a typed response carrying the original question so the UI can still show something.
 */
export async function getVariationsClient(
  args: { promptId: string; question: string; noteText: string; strength: number },
  cfg: TutorClientConfig,
): Promise<VariationResponse> {
  const startLevel = startRungForStrength(args.strength);
  if (!cfg.enabled) {
    return { ok: false, code: "api", error: "Enable the AI tutor in Settings for difficulty variations.", baseQuestion: args.question };
  }

  const noteHash = await hashNoteText(args.noteText);
  const cached = await idbGet<CachedLadder>(VARIATIONS_STORE, args.promptId).catch(() => undefined);
  if (cached && cached.noteHash === noteHash && cached.model === cfg.model && cached.provider === cfg.provider) {
    return buildLadder(args, withCurrentLabels(cached.variations), startLevel, true);
  }

  try {
    const variations = await generateLadder({ question: args.question, noteText: args.noteText }, toTutorConfig(cfg));
    await idbSet(VARIATIONS_STORE, args.promptId, { noteHash, model: cfg.model, provider: cfg.provider, variations } satisfies CachedLadder);
    return buildLadder(args, variations, startLevel, false);
  } catch (err) {
    const { code, error } = providerError(err, cfg.provider);
    return { ok: false, code, error: `${error} — showing the original question.`, baseQuestion: args.question };
  }
}

function buildLadder(
  args: { promptId: string; question: string; strength: number },
  variations: Variation[],
  startLevel: number,
  cached: boolean,
): VariationResponse {
  return {
    ok: true,
    ladder: { promptId: args.promptId, baseQuestion: args.question, startLevel, strength: args.strength, variations, cached },
  };
}

/** Reply shape for the session's on-demand "Explain more". */
export type ExplainResponse = { ok: true; text: string } | { ok: false; error: string };

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: { explanation: { type: "string", description: "A fuller explanation, in Czech (English terms stay English)" } },
  required: ["explanation"],
} as const;

/** Elaborate on one card's term, grounded in its source note, via the device-configured backend. */
export async function explainTermClient(
  args: { front: string; back: string; noteText: string },
  cfg: TutorClientConfig,
): Promise<ExplainResponse> {
  if (!cfg.enabled) return { ok: false, error: "Enable the AI tutor in Settings to explain terms." };
  // Imported lazily so the grade/variation paths don't pull the transport unless the tutor is used.
  const { callTutorJson } = await import("@brainquest/core/tutor/llm");
  try {
    const raw = (await callTutorJson(
      {
        system:
          "Jsi učitel. Vysvětli zadaný pojem podrobněji a srozumitelně v češtině (anglický termín nech anglicky), 2–4 věty, výhradně na základě poznámky a definice. Nevymýšlej si nic, co tam není.",
        user: `Pojem: ${args.front}\nStručná definice: ${args.back}\n\nKontext (poznámka):\n${args.noteText.slice(0, 6000)}\n\nVysvětli ten pojem podrobněji než stručná definice.`,
        schema: EXPLAIN_SCHEMA,
      },
      toTutorConfig(cfg),
    )) as { explanation?: unknown };
    const text = typeof raw.explanation === "string" ? raw.explanation.trim() : "";
    if (!text) return { ok: false, error: "No explanation returned — try again." };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: providerError(err, cfg.provider).error };
  }
}
