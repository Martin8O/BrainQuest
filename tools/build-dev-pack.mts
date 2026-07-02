// M0 dev-pack builder — compile the configured Obsidian vault into a single pack.json, so the app can be
// run off a compiled pack (BRAINQUEST_PACK) and prove the pack path end-to-end. This is the minimal seed
// of the M1 compiler (which adds validation, more input formats, and a real CLI); for now it reuses
// packages/core's parser + buildPack and just does the fs glue.
//
//   npm run pack:build                 → writes local/dev-pack.json (gitignored)
//   npm run pack:build -- <out.json>   → writes to a custom path
//
// Then:  BRAINQUEST_PACK=local/dev-pack.json npm run dev
import fs from "node:fs";
import path from "node:path";
import { loadVaultConfig } from "@brainquest/core/vault/config";
import { readVaultFolders } from "@brainquest/core/vault/folders";
import { parseConceptNote, parseLearningNote } from "@brainquest/core/vault/parse";
import { buildPack } from "@brainquest/core/pack/build";
import type { PackManifest } from "@brainquest/core/pack/types";
import type { ConceptNote, LearningNote } from "@brainquest/core/vault/types";

async function main(): Promise<void> {
  const outPath = process.argv[2] ?? path.join("local", "dev-pack.json");
  const cfg = loadVaultConfig();

  // Reuse core's folder reader so the pack can't drift from what the app reads (same glob + slug rule).
  const { learning: learnFiles, concepts: conceptFiles } = await readVaultFolders(cfg);

  const learning: LearningNote[] = learnFiles.map((f) => parseLearningNote(f.slug, f.path, f.md, cfg));
  const concepts: ConceptNote[] = conceptFiles.map((f) => parseConceptNote(f.slug, f.path, f.md, cfg));

  // Bodies keyed by the note's unique file path, so the pack is self-contained (tutor/reader work off it).
  const bodies = new Map<string, string>();
  for (const f of [...learnFiles, ...conceptFiles]) bodies.set(f.path, f.md);

  const manifest: PackManifest = {
    id: "brainquest-dev",
    name: "BrainQuest Dev Pack",
    lang: "cs",
    version: "0.0.0-dev",
    author: "Martin",
    license: "All rights reserved",
    description: `Dev pack compiled from ${cfg.vaultPath} for the M0 pack-runtime proof.`,
  };

  const pack = buildPack(manifest, learning, concepts, (n) => bodies.get(n.path) ?? "");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2) + "\n", "utf8");

  const cardCount = pack.notes.reduce((s, n) => s + n.cards.length, 0);
  const recallCount = pack.notes.reduce((s, n) => s + n.recall.length, 0);
  const edgeCount = pack.concepts.reduce((s, c) => s + c.edges.length, 0);
  console.log(`Wrote ${outPath}`);
  console.log(
    `  ${pack.notes.length} notes · ${pack.concepts.length} concepts · ` +
      `${cardCount} cards · ${recallCount} recall · ${edgeCount} edges`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

