// Pure pack → VaultSnapshot loader. No fs, no env — give it a parsed Pack, get back the exact same model
// the fs vault reader produces (via the shared assembleSnapshot), so every page renders a pack identically
// to a real vault. Card/recall ids match the reader's scheme (`slug#cN` / `slug#rN`) so SRS review state
// carries across the vault↔pack boundary for the same content. Note file paths become synthetic `pack:`
// URIs; readNoteBody (reader.ts) resolves those back to the pack's stored `body`.
import { assembleSnapshot } from "../vault/assemble";
import type { Card, ConceptNote, LearningNote, RecallPrompt, VaultSnapshot } from "../vault/types";
import type { Pack } from "./types";

/** Marker prefix for a note path that lives inside a pack rather than on disk. */
export const PACK_PATH_PREFIX = "pack:";

/** Synthetic, on-disk-free path for a pack note, e.g. `pack:learning/2026-06-24-f1`. */
export function packNotePath(kind: "learning" | "concept", slug: string): string {
  return `${PACK_PATH_PREFIX}${kind}/${slug}`;
}

/** True when a note path points into a pack (not a real file). */
export function isPackPath(path: string): boolean {
  return path.startsWith(PACK_PATH_PREFIX);
}

/** Build the app's VaultSnapshot from a compiled pack. */
export function loadPack(pack: Pack): VaultSnapshot {
  const learning: LearningNote[] = pack.notes.map((n) => {
    const path = packNotePath("learning", n.slug);
    const cards: Card[] = n.cards.map((c, i) => ({
      id: `${n.slug}#c${i}`,
      front: c.front,
      back: c.back,
      conceptLink: c.conceptLink,
      sourceSlug: n.slug,
      sourcePath: path,
    }));
    const recall: RecallPrompt[] = n.recall.map((r, i) => ({
      id: `${n.slug}#r${i}`,
      question: r.question,
      sourceSlug: n.slug,
      sourcePath: path,
    }));
    return {
      kind: "learning",
      slug: n.slug,
      path,
      title: n.title,
      tags: n.tags,
      date: n.date,
      hub: n.hub,
      projects: n.projects,
      cards,
      recall,
    };
  });

  const concepts: ConceptNote[] = pack.concepts.map((c) => ({
    kind: "concept",
    slug: c.slug,
    path: packNotePath("concept", c.slug),
    title: c.title,
    tags: c.tags,
    gloss: c.gloss,
    edges: c.edges,
  }));

  return assembleSnapshot(`${PACK_PATH_PREFIX}${pack.manifest.id}`, learning, concepts);
}

/**
 * Resolve a synthetic `pack:` note path to that note's stored source text, or null if absent.
 * Used by readNoteBody so the tutor + in-app reader work off a pack the same way they read a vault file.
 */
export function findPackBody(pack: Pack, sourcePath: string): string | null {
  const rest = sourcePath.slice(PACK_PATH_PREFIX.length); // "learning/<slug>" | "concept/<slug>"
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const kind = rest.slice(0, slash);
  const slug = rest.slice(slash + 1);
  if (kind === "learning") return pack.notes.find((n) => n.slug === slug)?.body ?? null;
  if (kind === "concept") return pack.concepts.find((c) => c.slug === slug)?.body ?? null;
  return null;
}
