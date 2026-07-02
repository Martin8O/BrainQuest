// The compiled pack format — the distributable unit BrainQuest consumes instead of a raw Obsidian vault.
// A pack is validated, self-contained JSON: manifest + structured content (cards, concepts, graph) + each
// note's source text (`body`) so the AI tutor and in-app reader stay grounded WITHOUT the original vault.
// Strictness is enforced by the compiler (M1), never on the device — the loader trusts a well-formed pack
// and only sanity-checks its shape (validatePack). Bump PACK_FORMAT_VERSION on any breaking schema change.
import type { ConceptEdge } from "../vault/types";

/** Current pack schema version. The loader rejects packs from a newer major format it doesn't understand. */
export const PACK_FORMAT_VERSION = 1;

/** Who/what a pack is — the human- and store-facing metadata (drives the Play listing later). */
export interface PackManifest {
  /** Stable machine id, e.g. "ai-dev-literacy". Used in synthetic note paths and store keys. */
  id: string;
  /** Display name, e.g. "AI-assisted Development Literacy". */
  name: string;
  /** Content language tag, e.g. "en" or "cs" — packs are language-tagged so brains of any language coexist. */
  lang: string;
  /** Content version of THIS pack (semver-ish), independent of the schema `format`. */
  version: string;
  author: string;
  /** License of the pack content, e.g. "CC-BY-4.0" or "All rights reserved". */
  license: string;
  description: string;
}

/** A flashcard as stored in a pack. Its id/source are derived at load, so a pack stays position-based. */
export interface PackCard {
  front: string;
  back: string;
  /** The concept this card points at (`→ [[concept]]`), or null. */
  conceptLink: string | null;
}

/** An open recall prompt as stored in a pack (the derived id/source are added at load). */
export interface PackRecall {
  question: string;
}

/** A learning note in a pack: its metadata + harvested cards/recall + the source text for grounding. */
export interface PackNote {
  slug: string;
  title: string;
  /** YYYY-MM-DD, or null — drives the foundation-first ordering. */
  date: string | null;
  tags: string[];
  hub: string | null;
  /** Project tags (e.g. "project/brainquest") — drive the tutor area filter. */
  projects: string[];
  /** The note's markdown source, so the tutor/reader work off the pack alone (no vault needed). */
  body: string;
  cards: PackCard[];
  recall: PackRecall[];
}

/** A concept note in a pack: its metadata + outgoing graph edges + the source text. */
export interface PackConcept {
  slug: string;
  title: string;
  tags: string[];
  /** First definition line, or null. */
  gloss: string | null;
  /** The note's markdown source. */
  body: string;
  /** Outgoing "Related" edges (from this concept to others). */
  edges: ConceptEdge[];
}

/** A complete compiled pack — the whole content bundle the app loads. */
export interface Pack {
  /** Schema version — must be <= PACK_FORMAT_VERSION for the loader to accept it. */
  format: number;
  manifest: PackManifest;
  notes: PackNote[];
  concepts: PackConcept[];
}

/**
 * Sanity-check a parsed pack's shape and format version. This is a lightweight guard for the load path
 * (a corrupt/foreign file), NOT the compiler's job — deep content validation (missing links, cycles,
 * orphans) lives in the M1 compiler where errors can be reported helpfully at author time.
 * @throws Error with a human-readable reason when the value isn't a usable pack.
 */
export function validatePack(value: unknown): asserts value is Pack {
  const p = value as Partial<Pack> | null;
  if (!p || typeof p !== "object") throw new Error("Pack is not an object.");
  if (typeof p.format !== "number") throw new Error("Pack is missing a numeric `format` version.");
  if (p.format > PACK_FORMAT_VERSION) {
    throw new Error(`Pack format ${p.format} is newer than supported (${PACK_FORMAT_VERSION}). Update the app.`);
  }
  if (!p.manifest || typeof p.manifest.id !== "string" || !p.manifest.id) {
    throw new Error("Pack manifest is missing a non-empty `id`.");
  }
  if (!Array.isArray(p.notes)) throw new Error("Pack `notes` must be an array.");
  if (!Array.isArray(p.concepts)) throw new Error("Pack `concepts` must be an array.");
  // Per-element shape: enough that loadPack won't crash on an undefined field with a cryptic message.
  // (Deep content validation — missing links, cycles, orphans — is the M1 compiler's job, not this.)
  for (const n of p.notes) {
    if (!n || typeof n.slug !== "string") throw new Error("A pack note is missing a string `slug`.");
    if (!Array.isArray(n.cards) || !Array.isArray(n.recall)) {
      throw new Error(`Pack note "${n.slug}" is missing its \`cards\`/\`recall\` arrays.`);
    }
  }
  for (const c of p.concepts) {
    if (!c || typeof c.slug !== "string" || typeof c.title !== "string") {
      throw new Error("A pack concept is missing a string `slug`/`title`.");
    }
    if (!Array.isArray(c.edges)) throw new Error(`Pack concept "${c.slug}" is missing its \`edges\` array.`);
  }
}
