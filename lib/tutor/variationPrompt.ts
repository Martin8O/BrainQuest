// PURE prompt construction + the difficulty ladder for D2's question variation — no SDK, no fs, so the
// verify script can assert the exact text we send and the calibration math without a network call.
// variations.ts wires this to the Ollama transport; the ladder rungs and the start-rung calibration are
// the contract the UI renders against.
import { MAX_NOTE_CHARS } from "./prompt";

/**
 * The difficulty ladder: four rungs of ascending cognitive demand (a Bloom-style progression), each a
 * FRESH rephrasing of the same recall prompt that must still be answerable from the SAME note. The
 * learner climbs easy → hard; how high they START is set by their mastery (see startRungForStrength).
 * Order is the contract: index i ↔ level i+1. CZ labels are learner-facing; `guidance` steers the model.
 */
export interface Rung {
  /** 1..4 — the rung's position on the ladder (also the difficulty). */
  level: number;
  /** Learner-facing Czech label shown as the difficulty chip. */
  label: string;
  /** The Bloom band in English (vocabulary the learner is building). */
  bloom: string;
  /** Instruction to the model for how to frame this rung's question (Czech). */
  guidance: string;
}

export const RUNGS: readonly Rung[] = [
  {
    level: 1,
    label: "Připomenutí",
    bloom: "recall",
    guidance: "Holé vybavení: nech pojem pojmenovat nebo definovat. Krátká přímá otázka typu 'Co je…?' nebo 'Jak se jmenuje…?'.",
  },
  {
    level: 2,
    label: "Porozumění",
    bloom: "understand",
    guidance: "Nech vysvětlit vlastními slovy PROČ nebo JAK to funguje — ne jen co to je. Otázka typu 'Proč…?' nebo 'Jak souvisí…?'.",
  },
  {
    level: 3,
    label: "Použití",
    bloom: "apply",
    guidance: "Dej konkrétní situaci nebo scénář a zeptej se, jak by se pojem použil nebo co by se stalo (typu 'Co by se stalo, kdyby…?').",
  },
  {
    level: 4,
    label: "Propojení",
    bloom: "analyze",
    guidance: "Nech propojit, porovnat nebo zvážit kompromis mezi dvěma myšlenkami Z TÉ POZNÁMKY (vztah, důsledek, trade-off).",
  },
] as const;

/** Look up a rung by its 1..4 level (clamped), so the UI/store always get a valid label. */
export function rungAt(level: number): Rung {
  const i = Math.max(1, Math.min(RUNGS.length, Math.round(level))) - 1;
  return RUNGS[i];
}

/**
 * Calibrate the ENTRY rung from the learner's mastery of this prompt's material (C1 cluster strength
 * 0..1 — reusing the existing mastery number, not a forked notion of "level"). Beginners start at the
 * easy end; the more you already know, the higher you start, skipping the trivial rungs. Capped at 3 so
 * there is always at least one harder rung (4) left to climb to.
 */
export function startRungForStrength(strength: number): number {
  if (strength >= 0.67) return 3;
  if (strength >= 0.34) return 2;
  return 1;
}

/** The JSON Schema the model's reply is constrained to: exactly one question per rung (r1..r4). */
export const VARIATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    r1: { type: "string", description: "Rung 1 (recall) question in Czech" },
    r2: { type: "string", description: "Rung 2 (understand) question in Czech" },
    r3: { type: "string", description: "Rung 3 (apply) question in Czech" },
    r4: { type: "string", description: "Rung 4 (analyze) question in Czech" },
  },
  required: ["r1", "r2", "r3", "r4"],
} as const;

/** The keys the schema returns, in rung order — so parsing maps r1..r4 → level 1..4 deterministically. */
export const VARIATION_KEYS = ["r1", "r2", "r3", "r4"] as const;

/**
 * The generator's persona + hard rules. English instructions (code stays English), but the GENERATED
 * questions must be Czech, English-term-first — matching how Martin learns. The guardrails are the whole
 * point of "LLM as a content generator": stay answerable from the note, don't leak the answer, don't
 * invent facts the note doesn't contain.
 */
export const VARIATION_SYSTEM_PROMPT = [
  "You generate fresh REPHRASINGS of a study recall question, so reviewing it never becomes memorising one",
  "fixed string. You are given the original question and the source note it came from.",
  "",
  "You must return FOUR questions of ascending difficulty (a recall → understand → apply → analyze ladder).",
  "",
  "Hard rules:",
  "- Every question must be ANSWERABLE using ONLY the provided note. Do not require outside knowledge.",
  "- Do NOT reveal or hint at the answer inside the question. Ask, don't tell.",
  "- Each rung must genuinely differ in cognitive demand — not the same question reworded four times.",
  "- Stay on the SAME concept as the original question; vary the angle, not the topic.",
  "- Write every question in Czech, keeping technical terms in English first (e.g. \"server action\"),",
  "  because that is the vocabulary the learner is building.",
  "- Keep each question to one or two sentences.",
].join("\n");

/** Build the user turn: the original question, the grounding note, and the per-rung framing — fenced. */
export function buildVariationPrompt(originalQuestion: string, noteText: string): string {
  const note = noteText.length > MAX_NOTE_CHARS ? noteText.slice(0, MAX_NOTE_CHARS) + "\n…(zkráceno)" : noteText;
  return [
    "## Original recall question",
    originalQuestion,
    "",
    "## Source note (the only ground truth — every question must be answerable from this)",
    "<note>",
    note,
    "</note>",
    "",
    "## The four rungs to produce (ascending difficulty)",
    ...RUNGS.map((r) => `- ${VARIATION_KEYS[r.level - 1]} — ${r.label} (${r.bloom}): ${r.guidance}`),
    "",
    "Return the four questions as the structured result (r1 easiest → r4 hardest).",
  ].join("\n");
}
