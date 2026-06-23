// Server-only persistence for generated question ladders (D2's cache). Local generation on CPU is slow
// (tens of seconds), so we generate a prompt's ladder once and reuse it — this is the "caching to control
// cost" the plan asks for. The cache lives in data/variations.json (committed, synced app state, never
// secrets). READ/WRITE FENCE: touches only the repo's data/ dir — never the read-only vault vault.
//
// A cache entry is keyed by the recall prompt id and stamped with a hash of the note text it was made
// from + the model that made it, so it SELF-INVALIDATES: edit the note (or switch TUTOR_MODEL) and the
// stale ladder is ignored and regenerated. (Generation is deterministic — fixed seed + temp 0 — so the
// cache is a pure speed-up, never a source of drift.)
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Variation } from "./types";

/** data/variations.json schema version (bump if the entry shape changes). */
export const VARIATION_STORE_VERSION = 1;

/** One cached ladder: the four rungs plus the fingerprint that decides if it is still valid. */
export interface VariationCacheEntry {
  /** Short hash of the source note text at generation time — mismatch ⇒ the note changed ⇒ regenerate. */
  noteHash: string;
  /** Model tag that produced it — mismatch ⇒ regenerate (a different model writes different questions). */
  model: string;
  /** When it was generated (ISO-8601) — diagnostics only. */
  generatedAt: string;
  /** The four rungs, level 1..4. */
  variations: Variation[];
}

/** The persisted file shape (data/variations.json). */
export interface VariationCache {
  version: number;
  /** Cached ladders keyed by RecallPrompt.id. */
  entries: Record<string, VariationCacheEntry>;
}

/** A short, stable fingerprint of a note's text (first 16 hex of SHA-1) — enough to detect any edit. */
export function hashNote(noteText: string): string {
  return crypto.createHash("sha1").update(noteText).digest("hex").slice(0, 16);
}

/** An empty, valid cache — used when the file does not exist yet. */
export function emptyVariationCache(): VariationCache {
  return { version: VARIATION_STORE_VERSION, entries: {} };
}

/** The data/ directory — same override hook as the review store so other machines/tests can redirect it. */
function dataDir(): string {
  return process.env.BRAINQUEST_DATA_DIR ?? path.join(process.cwd(), "data");
}

/** Absolute path of the variation cache file. */
export function variationsPath(): string {
  return path.join(dataDir(), "variations.json");
}

/** Load the cache, returning an empty one if the file is absent or unreadable. */
export async function loadVariationCache(): Promise<VariationCache> {
  try {
    const raw = await fs.readFile(variationsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<VariationCache>;
    return { version: VARIATION_STORE_VERSION, entries: parsed.entries ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyVariationCache();
    // A corrupt cache must never break the tutor — start fresh rather than throw.
    return emptyVariationCache();
  }
}

/** Persist the cache atomically (temp file, then rename) so a crash can't truncate it. */
export async function saveVariationCache(cache: VariationCache): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const file = variationsPath();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

/** A cache hit only when the entry exists AND was made from this exact note text by this exact model. */
export function getCachedVariations(
  cache: VariationCache,
  promptId: string,
  noteHash: string,
  model: string,
): Variation[] | null {
  const entry = cache.entries[promptId];
  if (!entry || entry.noteHash !== noteHash || entry.model !== model) return null;
  return entry.variations;
}
