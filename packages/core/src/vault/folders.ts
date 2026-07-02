// Server-only: the single definition of "which files in a vault folder count as notes, and how a slug is
// derived from a filename". Shared by the fs vault reader (reader.ts) and the dev-pack compiler tool, so a
// compiled pack can never drift from what the app reads (same glob rule, same slug logic).
// READ-ONLY: only reads .md files.
import fs from "node:fs/promises";
import path from "node:path";
import type { VaultConfig } from "./config";

/** One raw markdown file read from a vault folder. */
export interface RawFile {
  slug: string;
  path: string;
  md: string;
}

/** Read every "*.md" in a folder (skipping "_index.md"-style helpers), with its contents. */
export async function readFolder(dir: string): Promise<RawFile[]> {
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

/** Read the configured learning + concept folders of a vault. */
export async function readVaultFolders(
  cfg: VaultConfig,
): Promise<{ learning: RawFile[]; concepts: RawFile[] }> {
  const [learning, concepts] = await Promise.all([
    readFolder(path.join(cfg.vaultPath, cfg.folders.learning)),
    readFolder(path.join(cfg.vaultPath, cfg.folders.concepts)),
  ]);
  return { learning, concepts };
}
