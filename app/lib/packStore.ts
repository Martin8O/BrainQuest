// Browser adapter for the pack catalogue (M4.3) — ties the pure registry logic (@brainquest/core) to
// IndexedDB + the bundled static assets. Responsibilities:
//   • load/persist the registry (which packs are installed + which is active)
//   • resolve the active pack's actual content (built-in → /pack.json fresh; imported → IndexedDB blob)
//   • import a pack.json picked from device storage → validate → store → register → make active
//   • remove an imported pack (its blob + its per-pack review progress)
//   • load/save each pack's review store under its OWN namespaced key, so packs never share progress
// The built-in bundled pack is never stored in IDB — it is fetched fresh each load so a rebuild (npm run
// app:data) is picked up. Progress for the built-in is migrated once from the pre-M4.3 global key.
import { validatePack, type Pack } from "@brainquest/core/pack/types";
import { emptyStore, parseReviewStore } from "@brainquest/core/srs/reviewStore";
import type { ReviewStore } from "@brainquest/core/srs/types";
import {
  installedFromPack,
  parseRegistry,
  removePack as removeFromRegistry,
  reviewsKeyFor,
  setActive,
  upsertPack,
  type InstalledPack,
  type PackRegistry,
} from "@brainquest/core/pack/registry";
import { fetchBuiltinPack, loadReviewSeed } from "./content";
import {
  idbDelete,
  idbGet,
  idbSet,
  KV_STORE,
  LEGACY_REVIEWS_KEY,
  PACKS_STORE,
  REGISTRY_KEY,
} from "./idb";

/** Persist the registry to IndexedDB (kv store). Callers persist the ACTIVE-selection change only AFTER the
 *  new active pack has loaded, so a broken pack can never leave IDB pointing at content that won't load. */
export async function saveRegistry(reg: PackRegistry): Promise<void> {
  await idbSet(KV_STORE, REGISTRY_KEY, reg);
}

/**
 * Load the pack catalogue, reconciling it with the bundled built-in asset:
 *   • always ensure a built-in entry exists/refreshed when /pack.json is present (so a rebuilt bundle's
 *     new counts/name show up), keeping the built-in's fixed id;
 *   • on the very first run (no persisted registry) point active at the built-in and migrate pre-M4.3
 *     progress from the legacy global key into the built-in's namespaced key.
 * Returns the registry plus the built-in id (or null if no bundle is present).
 */
export async function loadRegistry(): Promise<{ registry: PackRegistry; builtinId: string | null }> {
  const persistedRaw = await idbGet<unknown>(KV_STORE, REGISTRY_KEY).catch(() => undefined);
  const hadRegistry = persistedRaw !== undefined;
  let reg = parseRegistry(persistedRaw);

  const builtin = await fetchBuiltinPack().catch(() => null);
  let builtinId: string | null = null;
  if (builtin) {
    builtinId = builtin.manifest.id;
    reg = upsertPack(reg, installedFromPack(builtin, "builtin", null));
    // First ever load: make the built-in active and migrate legacy global progress into its namespace.
    if (!hadRegistry) {
      reg = setActive(reg, builtinId);
      await migrateLegacyReviews(builtinId);
    }
  }

  await saveRegistry(reg);
  return { registry: reg, builtinId };
}

/** One-time move of the pre-M4.3 global review store into the built-in pack's namespaced key. */
async function migrateLegacyReviews(builtinId: string): Promise<void> {
  const target = reviewsKeyFor(builtinId);
  const already = await idbGet<unknown>(KV_STORE, target).catch(() => undefined);
  if (already !== undefined) return; // already migrated
  const legacy = await idbGet<unknown>(KV_STORE, LEGACY_REVIEWS_KEY).catch(() => undefined);
  if (legacy === undefined) return; // nothing to migrate
  await idbSet(KV_STORE, target, parseReviewStore(legacy));
  await idbDelete(KV_STORE, LEGACY_REVIEWS_KEY);
}

/** The entry the registry says is active (or null when nothing is installed). */
export function activeEntry(reg: PackRegistry): InstalledPack | null {
  return reg.packs.find((p) => p.id === reg.activeId) ?? null;
}

/**
 * Resolve the active pack's content. A built-in entry is fetched fresh from /pack.json; an imported entry
 * is read from its IndexedDB blob. Throws a helpful error when the active pack can't be resolved.
 */
export async function loadActivePack(reg: PackRegistry): Promise<Pack> {
  const entry = activeEntry(reg);
  if (!entry) {
    throw new Error("No content pack is installed. Import a pack, or run `npm run app:data` to bundle one.");
  }
  if (entry.source === "builtin") {
    const builtin = await fetchBuiltinPack();
    if (!builtin) throw new Error("The bundled pack (public/pack.json) is missing. Run `npm run app:data`.");
    return builtin;
  }
  const stored = await idbGet<unknown>(PACKS_STORE, entry.id);
  if (stored === undefined) throw new Error(`Imported pack "${entry.name}" is missing from storage.`);
  validatePack(stored);
  return stored;
}

/** Result of importing a pack file. */
export interface ImportResult {
  registry: PackRegistry;
  pack: Pack;
  /** True when an existing pack with the same id was replaced rather than newly added. */
  replaced: boolean;
}

/**
 * Import a pack.json file's TEXT: parse + validate, store the blob, and return the registry with it added
 * (imported) and selected active — WITHOUT persisting the registry. The caller activates the new pack and
 * only then persists (saveRegistry), so a pack that somehow won't load can't strand the registry. Throws a
 * friendly Error on malformed JSON or an invalid pack shape. `now` is injected for the addedAt timestamp.
 */
export async function importPackText(reg: PackRegistry, text: string, now: Date): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON — pick a compiled pack.json.");
  }
  validatePack(raw); // throws a human-readable reason for a non-pack file
  const pack = raw;
  const id = pack.manifest.id;

  const replaced = reg.packs.some((p) => p.id === id);
  await idbSet(PACKS_STORE, id, pack);
  const next = setActive(upsertPack(reg, installedFromPack(pack, "imported", now.toISOString())), id);
  return { registry: next, pack, replaced };
}

/**
 * Remove an imported pack: its blob, its per-pack review progress, and its registry entry. The built-in
 * cannot be removed (it is re-added from the bundled asset on every load). Returns the updated registry.
 */
export async function removeImportedPack(reg: PackRegistry, id: string): Promise<PackRegistry> {
  const entry = reg.packs.find((p) => p.id === id);
  if (entry && entry.source === "builtin") {
    throw new Error("The built-in pack can't be removed.");
  }
  await idbDelete(PACKS_STORE, id);
  await idbDelete(KV_STORE, reviewsKeyFor(id));
  const next = removeFromRegistry(reg, id);
  await saveRegistry(next);
  return next;
}

/**
 * Load a pack's review store from its namespaced key. On a first-ever load of the built-in with nothing
 * persisted, seed once from /reviews.seed.json (existing progress carried over). Imported packs and any
 * pack with no seed start empty.
 */
export async function loadReviewStoreFor(packId: string, isBuiltin: boolean): Promise<ReviewStore> {
  const key = reviewsKeyFor(packId);
  const persisted = await idbGet<unknown>(KV_STORE, key).catch(() => undefined);
  if (persisted !== undefined) return parseReviewStore(persisted);
  if (isBuiltin) {
    const seed = await loadReviewSeed();
    if (seed) {
      await idbSet(KV_STORE, key, seed); // persist so the seed imports only once
      return seed;
    }
  }
  return emptyStore();
}

/** Persist a pack's review store under its namespaced key. */
export async function saveReviewStoreFor(packId: string, store: ReviewStore): Promise<void> {
  await idbSet(KV_STORE, reviewsKeyFor(packId), store);
}
