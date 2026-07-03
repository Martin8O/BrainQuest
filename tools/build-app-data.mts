// Build the static assets the client-only app (M2) fetches at runtime, into public/:
//   • pack.json         — the configured vault compiled to a validated pack (the app's content).
//   • app-config.json   — the non-secret vault.config.json (area labels, tag scheme, harvest headings).
//   • reviews.seed.json — existing review progress, if any: a one-time seed the app imports into
//                         IndexedDB on first run so history carries over to the on-device store.
// These are build artifacts / personal data → gitignored. Re-run whenever the vault changes:
//   npm run app:data
// It reuses packages/core parsing so the pack can never drift from what the app reads. The vault stays
// READ-ONLY — this only reads .md files and writes into public/ + reports validation.
import fs from "node:fs";
import path from "node:path";
import { loadVaultConfig } from "@brainquest/core/vault/config";
import { readFolder } from "@brainquest/core/vault/folders";
import { parseConceptNote, parseLearningNote } from "@brainquest/core/vault/parse";
import { buildPack } from "@brainquest/core/pack/build";
import { packStats, summarize, validatePackContent } from "@brainquest/core/pack/validate";
import type { PackManifest } from "@brainquest/core/pack/types";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");

async function main(): Promise<void> {
  const cfg = loadVaultConfig();

  // Compile the configured vault (learning/ + concepts/) → a pack, keeping each note's body.
  const [learnFiles, conceptFiles] = await Promise.all([
    readFolder(path.join(cfg.vaultPath, cfg.folders.learning)),
    readFolder(path.join(cfg.vaultPath, cfg.folders.concepts)),
  ]);
  const bodies = new Map<string, string>();
  const learning = learnFiles.map((f) => {
    bodies.set(f.path, f.md);
    return parseLearningNote(f.slug, f.path, f.md, cfg);
  });
  const concepts = conceptFiles.map((f) => {
    bodies.set(f.path, f.md);
    return parseConceptNote(f.slug, f.path, f.md, cfg);
  });

  const manifest: PackManifest = {
    id: "brainquest",
    name: "BrainQuest",
    lang: "cs",
    version: "0.0.0-dev",
    author: "Martin",
    license: "All rights reserved",
    description: `Compiled from ${cfg.vaultPath} for the client app.`,
  };
  const pack = buildPack(manifest, learning, concepts, (n) => bodies.get(n.path) ?? "");
  const stats = packStats(pack);
  const { errors, warnings } = summarize(validatePackContent(pack));

  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC, "pack.json"), JSON.stringify(pack) + "\n", "utf8");

  // The client resolves this the same way the Node loader resolves the file (resolveVaultConfig).
  fs.writeFileSync(path.join(PUBLIC, "app-config.json"), fs.readFileSync(path.join(ROOT, "vault.config.json"), "utf8"), "utf8");

  // Optional progress seed — only if a store exists.
  let seeded = false;
  try {
    const reviews = fs.readFileSync(path.join(ROOT, "data", "reviews.json"), "utf8");
    fs.writeFileSync(path.join(PUBLIC, "reviews.seed.json"), reviews, "utf8");
    seeded = true;
  } catch {
    // no data/reviews.json → app starts with an empty store
  }

  console.log(
    `app:data → public/pack.json (${stats.notes} notes · ${stats.concepts} concepts · ${stats.cards} cards · ` +
      `${stats.recall} recall · ${stats.edges} edges) — ${errors} error(s), ${warnings} warning(s)`,
  );
  console.log(`         + public/app-config.json${seeded ? " + public/reviews.seed.json" : " (no reviews seed)"}`);
  if (errors > 0) {
    console.error(`\nContent has ${errors} error(s) — fix them, then re-run.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
