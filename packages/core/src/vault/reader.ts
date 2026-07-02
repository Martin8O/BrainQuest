// Server-only content reader. Uses node:fs and is imported only by server components/actions.
// READ-ONLY FENCE: this module never writes the vault — it only reads .md files (or a compiled pack).
//
// Two content sources, one output shape (VaultSnapshot, assembled by assembleSnapshot):
//   • default        → read the configured Obsidian vault folders from disk.
//   • BRAINQUEST_PACK → read a compiled pack.json instead (the dev flag that proves the app runs off a
//                       pack — the path to mobile, where there is no vault). Set it to a pack file path.
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { loadVaultConfig } from "./config";
import { readVaultFolders } from "./folders";
import { parseConceptNote, parseLearningNote } from "./parse";
import { assembleSnapshot } from "./assemble";
import type { Harvest, VaultSnapshot } from "./types";
import { findPackBody, isPackPath, loadPack } from "../pack/loader";
import { validatePack, type Pack } from "../pack/types";

/** Empty harvest used when the content source can't be read. */
const EMPTY_HARVEST: Harvest = { cards: [], recall: [], graph: { nodes: [], edges: [] } };

/** A failed-read snapshot with a human-readable reason. */
function errorSnapshot(source: string, err: unknown): VaultSnapshot {
  return {
    vaultPath: source,
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    learning: [],
    concepts: [],
    harvest: EMPTY_HARVEST,
  };
}

// --- Pack source (dev flag) ------------------------------------------------------------------------

/** The pack file path from BRAINQUEST_PACK, or null when running off the real vault. */
function packPathFromEnv(): string | null {
  const p = process.env.BRAINQUEST_PACK;
  return p && p.trim() ? p.trim() : null;
}

// Cache the parsed pack per process so readVault + readNoteBody share one read. Keyed by path AND mtime,
// so rebuilding the pack in place (npm run pack:build over a running dev server) is picked up on the next
// read instead of serving stale content until a restart.
let packCache: { path: string; mtimeMs: number; pack: Pack } | null = null;

/** Read + validate the pack file at `packPath`, cached per process (invalidated when the file changes). */
function loadPackFile(packPath: string): Pack {
  const mtimeMs = fsSync.statSync(packPath).mtimeMs;
  if (packCache && packCache.path === packPath && packCache.mtimeMs === mtimeMs) return packCache.pack;
  const raw: unknown = JSON.parse(fsSync.readFileSync(packPath, "utf8"));
  validatePack(raw);
  packCache = { path: packPath, mtimeMs, pack: raw };
  return raw;
}

// --- Public API ------------------------------------------------------------------------------------

/** Read the configured content source (vault folders, or a pack when BRAINQUEST_PACK is set). */
export async function readVault(): Promise<VaultSnapshot> {
  const packPath = packPathFromEnv();
  if (packPath) {
    try {
      return loadPack(loadPackFile(packPath));
    } catch (err) {
      return errorSnapshot(`pack:${packPath}`, err);
    }
  }

  let vaultPath = "(unresolved)";
  try {
    const cfg = loadVaultConfig();
    vaultPath = cfg.vaultPath;
    const { learning: learnFiles, concepts: conceptFiles } = await readVaultFolders(cfg);
    const learning = learnFiles.map((f) => parseLearningNote(f.slug, f.path, f.md, cfg));
    const concepts = conceptFiles.map((f) => parseConceptNote(f.slug, f.path, f.md, cfg));
    // Sorting + harvest aggregation live in assembleSnapshot so a pack loads to an identical model.
    return assembleSnapshot(vaultPath, learning, concepts);
  } catch (err) {
    return errorSnapshot(vaultPath, err);
  }
}

/**
 * Read one note's markdown source (READ-ONLY), whichever content source is active. A real vault note
 * comes off disk; a pack note (a `pack:` path) comes from the pack's stored `body`. This is the single
 * body-read path shared by the in-app reader and the AI tutor, so both work under a pack too.
 * @throws when a pack path is given without BRAINQUEST_PACK set, or the note isn't in the pack/on disk.
 */
export async function readNoteBody(sourcePath: string): Promise<string> {
  if (isPackPath(sourcePath)) {
    const packPath = packPathFromEnv();
    if (!packPath) throw new Error("Pack note path given but BRAINQUEST_PACK is not set.");
    const body = findPackBody(loadPackFile(packPath), sourcePath);
    if (body == null) throw new Error(`No body stored in pack for ${sourcePath}.`);
    return body;
  }
  return fs.readFile(sourcePath, "utf8");
}
