// Pure snapshot assembly — the single place that turns parsed notes into the VaultSnapshot the app
// consumes. Both content sources call it: the fs vault reader (reader.ts) and the pack loader
// (pack/loader.ts). Keeping it here means "read a folder" and "read a compiled pack" produce a
// byte-identical model — same sort order, same aggregated harvest — so the app can't tell them apart.
import type { ConceptNote, Harvest, LearningNote, VaultSnapshot } from "./types";

/**
 * Sort + aggregate parsed notes into a VaultSnapshot.
 * @param source  A human label for where the content came from (a vault path, or `pack:<id>`).
 * @param learning  Learning notes, in any order (sorted here, newest-first by date).
 * @param concepts  Concept notes, in any order (sorted here, alphabetically by title).
 */
export function assembleSnapshot(
  source: string,
  learning: LearningNote[],
  concepts: ConceptNote[],
): VaultSnapshot {
  const sortedLearning = [...learning].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const sortedConcepts = [...concepts].sort((a, b) => a.title.localeCompare(b.title));
  const harvest: Harvest = {
    cards: sortedLearning.flatMap((n) => n.cards),
    recall: sortedLearning.flatMap((n) => n.recall),
    graph: {
      nodes: sortedConcepts.map((c) => c.title),
      edges: sortedConcepts.flatMap((c) => c.edges),
    },
  };
  return {
    vaultPath: source,
    ok: true,
    error: null,
    learning: sortedLearning,
    concepts: sortedConcepts,
    harvest,
  };
}
