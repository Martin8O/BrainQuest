// Pure pack-registry logic (M4.3) — the on-device catalogue of installed content packs and which one is
// active. NO IndexedDB, NO fetch, NO clock inside: this owns the registry SHAPE, its tolerant parsing, and
// the pure add/switch/remove operations; the browser adapter (app/lib/packStore.ts) does the actual
// persistence + pack-blob storage. Split out like the review store so the correctness-sensitive bits
// (which pack is active, how progress is namespaced per pack) are unit-testable without a browser.
import type { Pack } from "./types";

/** Where an installed pack's content lives: the bundled asset (`/pack.json`) vs one imported from device. */
export type PackSource = "builtin" | "imported";

/** One entry in the on-device catalogue — enough to LIST packs without loading every pack blob. */
export interface InstalledPack {
  /** Stable machine id (manifest.id) — also the key for its stored blob + its review namespace. */
  id: string;
  name: string;
  lang: string;
  version: string;
  author: string;
  source: PackSource;
  /** ISO timestamp when the pack was imported; null for the built-in bundled pack. */
  addedAt: string | null;
  /** Content sizes captured at install, so the list renders without re-parsing each pack. */
  notes: number;
  concepts: number;
  cards: number;
}

/** The whole on-device catalogue: the installed packs + which one the app currently shows. */
export interface PackRegistry {
  /** manifest.id of the active pack, or "" when nothing is installed yet. */
  activeId: string;
  packs: InstalledPack[];
}

/** IndexedDB key under which a pack's review store is namespaced, so packs never share progress. */
export function reviewsKeyFor(packId: string): string {
  return `reviews:${packId}`;
}

/** An empty catalogue — nothing installed, nothing active. */
export function emptyRegistry(): PackRegistry {
  return { activeId: "", packs: [] };
}

/** Sum the cards across a pack's notes (for the list display). */
function cardCount(pack: Pack): number {
  return pack.notes.reduce((sum, n) => sum + n.cards.length, 0);
}

/** Derive a catalogue entry from a loaded pack. `addedAt` is null for the built-in, an ISO string else. */
export function installedFromPack(pack: Pack, source: PackSource, addedAt: string | null): InstalledPack {
  const m = pack.manifest;
  return {
    id: m.id,
    name: m.name,
    lang: m.lang,
    version: m.version,
    author: m.author,
    source,
    addedAt,
    notes: pack.notes.length,
    concepts: pack.concepts.length,
    cards: cardCount(pack),
  };
}

/** True for a value that is a usable InstalledPack entry (defensive parse of untrusted persisted data). */
function isInstalledPack(v: unknown): v is InstalledPack {
  const e = v as Partial<InstalledPack> | null;
  return (
    !!e &&
    typeof e === "object" &&
    typeof e.id === "string" &&
    e.id.length > 0 &&
    (e.source === "builtin" || e.source === "imported")
  );
}

/** Coerce a persisted entry to the current shape, defaulting any missing display fields. */
function normalizeEntry(e: InstalledPack): InstalledPack {
  return {
    id: e.id,
    name: typeof e.name === "string" && e.name ? e.name : e.id,
    lang: typeof e.lang === "string" ? e.lang : "",
    version: typeof e.version === "string" ? e.version : "",
    author: typeof e.author === "string" ? e.author : "",
    source: e.source,
    addedAt: typeof e.addedAt === "string" ? e.addedAt : null,
    notes: Number.isFinite(e.notes) ? e.notes : 0,
    concepts: Number.isFinite(e.concepts) ? e.concepts : 0,
    cards: Number.isFinite(e.cards) ? e.cards : 0,
  };
}

/**
 * Parse an untrusted persisted value into a registry, dropping malformed entries and de-duplicating by id
 * (last wins). `activeId` is repaired to point at a real entry (or the first pack, or "") so a corrupt
 * store can never leave the app pointed at a pack that isn't there.
 */
export function parseRegistry(raw: unknown): PackRegistry {
  if (!raw || typeof raw !== "object") return emptyRegistry();
  const r = raw as Partial<PackRegistry>;
  const byId = new Map<string, InstalledPack>();
  for (const entry of Array.isArray(r.packs) ? r.packs : []) {
    if (isInstalledPack(entry)) byId.set(entry.id, normalizeEntry(entry));
  }
  const packs = [...byId.values()];
  let activeId = typeof r.activeId === "string" ? r.activeId : "";
  if (!packs.some((p) => p.id === activeId)) activeId = packs[0]?.id ?? "";
  return { activeId, packs };
}

/** Add a pack (or replace an existing entry with the same id), keeping the current active selection. */
export function upsertPack(reg: PackRegistry, entry: InstalledPack): PackRegistry {
  const packs = reg.packs.some((p) => p.id === entry.id)
    ? reg.packs.map((p) => (p.id === entry.id ? entry : p))
    : [...reg.packs, entry];
  const activeId = reg.activeId || entry.id; // first pack ever installed becomes active
  return { activeId, packs };
}

/** Make `id` the active pack (no-op if that pack isn't installed). */
export function setActive(reg: PackRegistry, id: string): PackRegistry {
  if (!reg.packs.some((p) => p.id === id)) return reg;
  return { ...reg, activeId: id };
}

/**
 * Remove a pack. If it was the active one, the active selection falls back to the first remaining pack
 * (or "" when the catalogue is now empty). Callers enforce that the built-in cannot be removed.
 */
export function removePack(reg: PackRegistry, id: string): PackRegistry {
  const packs = reg.packs.filter((p) => p.id !== id);
  const activeId = reg.activeId === id ? (packs[0]?.id ?? "") : reg.activeId;
  return { activeId, packs };
}
