// Server-only vault reader. Uses node:fs and is imported only by server components.
// READ-ONLY FENCE: this module never writes to the vault — it only reads .md files.
import fs from "node:fs/promises";
import path from "node:path";
import { loadVaultConfig } from "./config";
import { parseConceptNote, parseLearningNote } from "./parse";
import type { VaultSnapshot } from "./types";

interface RawFile {
  slug: string;
  path: string;
  md: string;
}

/** Read every "*.md" in a folder (skipping "_index.md"-style helpers), with its contents. */
async function readFolder(dir: string): Promise<RawFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries.filter(
    (e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("_"),
  );
  return Promise.all(
    files.map(async (e) => {
      const full = path.join(dir, e.name);
      return { slug: e.name.replace(/\.md$/, ""), path: full, md: await fs.readFile(full, "utf8") };
    }),
  );
}

/** Read the configured vault folders and return a parsed snapshot for the overview page. */
export async function readVault(): Promise<VaultSnapshot> {
  let vaultPath = "(unresolved)";
  try {
    const cfg = loadVaultConfig();
    vaultPath = cfg.vaultPath;
    const [learnFiles, conceptFiles] = await Promise.all([
      readFolder(path.join(cfg.vaultPath, cfg.folders.learning)),
      readFolder(path.join(cfg.vaultPath, cfg.folders.concepts)),
    ]);
    const learning = learnFiles
      .map((f) => parseLearningNote(f.slug, f.path, f.md, cfg))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")); // newest first
    const concepts = conceptFiles
      .map((f) => parseConceptNote(f.slug, f.path, f.md, cfg))
      .sort((a, b) => a.title.localeCompare(b.title));
    return { vaultPath, ok: true, error: null, learning, concepts };
  } catch (err) {
    return {
      vaultPath,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      learning: [],
      concepts: [],
    };
  }
}
