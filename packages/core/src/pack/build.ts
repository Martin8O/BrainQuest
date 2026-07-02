// Pure pack builder — turn parsed notes (+ their source text) into a compiled Pack. The inverse of
// loadPack: buildPack → Pack → loadPack round-trips to the same VaultSnapshot. Framework-neutral and fs-free
// (the caller supplies bodies), so it's unit-testable and reused by both the M0 dev-pack tool and the M1
// compiler. It does NOT validate content — that's the compiler's job; this just reshapes.
import type { ConceptNote, LearningNote } from "../vault/types";
import { PACK_FORMAT_VERSION, type Pack, type PackConcept, type PackManifest, type PackNote } from "./types";

/**
 * Assemble a Pack from parsed learning + concept notes.
 * @param bodyOf  Returns a note's markdown source (keyed by its unique `path`), stored so a pack is
 *                self-contained. Return "" when a body isn't available.
 */
export function buildPack(
  manifest: PackManifest,
  learning: LearningNote[],
  concepts: ConceptNote[],
  bodyOf: (note: { path: string }) => string,
): Pack {
  const notes: PackNote[] = learning.map((n) => ({
    slug: n.slug,
    title: n.title,
    date: n.date,
    tags: n.tags,
    hub: n.hub,
    projects: n.projects,
    body: bodyOf(n),
    cards: n.cards.map((c) => ({ front: c.front, back: c.back, conceptLink: c.conceptLink })),
    recall: n.recall.map((r) => ({ question: r.question })),
  }));

  const packConcepts: PackConcept[] = concepts.map((c) => ({
    slug: c.slug,
    title: c.title,
    tags: c.tags,
    gloss: c.gloss,
    body: bodyOf(c),
    edges: c.edges,
  }));

  return { format: PACK_FORMAT_VERSION, manifest, notes, concepts: packConcepts };
}
