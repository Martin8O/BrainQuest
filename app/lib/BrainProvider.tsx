"use client";

// The client-only data layer (M2, multi-pack in M4.3). One provider loads the pack CATALOGUE (which packs
// are installed + which is active), resolves the active pack's content + presentation config, and its
// per-pack review progress (IndexedDB) — then exposes it all to every page via context. All state lives on
// the device. Grading a card updates the in-memory store and persists it under the ACTIVE pack's namespaced
// key, so switching packs keeps each pack's progress separate. Import a pack.json from device storage,
// switch between installed packs, or remove an imported one — the app re-renders around the new active pack.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { loadAppConfig, loadPack } from "./content";
import {
  activeEntry,
  importPackText,
  loadActivePack,
  loadRegistry,
  loadReviewStoreFor,
  removeImportedPack,
  saveRegistry,
  saveReviewStoreFor,
} from "./packStore";
import { applyReview, emptyStore } from "@brainquest/core/srs/reviewStore";
import { findPackBody } from "@brainquest/core/pack/loader";
import { emptyRegistry, setActive, type PackRegistry } from "@brainquest/core/pack/registry";
import type { Pack, PackManifest } from "@brainquest/core/pack/types";
import type { VaultConfig } from "@brainquest/core/vault/configTypes";
import type { VaultSnapshot } from "@brainquest/core/vault/types";
import type { Grade, ReviewState, ReviewStore } from "@brainquest/core/srs/types";

type Status = "loading" | "ready" | "error";

interface BrainContextValue {
  status: Status;
  error: string | null;
  /** The content model (assembled from the active pack) — cards, recall, graph, notes, concepts. */
  snapshot: VaultSnapshot | null;
  /** Presentation config: area labels, tag scheme, harvest headings, tutor defaults. */
  config: VaultConfig | null;
  /** The active pack's manifest (name, author, version, lang) — for headers/labels. */
  manifest: PackManifest | null;
  /** The on-device pack catalogue: installed packs + which is active. */
  registry: PackRegistry;
  /** Review state for the ACTIVE pack, in memory (persisted to IndexedDB on every change). */
  store: ReviewStore;
  /** Grade one card: schedule it (pure FSRS), persist under the active pack, return the new state. */
  gradeCard: (cardId: string, grade: Grade) => Promise<ReviewState>;
  /** A note's markdown source text from the active pack (for the reader + the tutor), or null. */
  noteBody: (sourcePath: string) => string | null;
  /** Import a pack.json picked from device storage → install it and switch to it. */
  importPack: (file: File) => Promise<void>;
  /** Switch the active pack to an installed one (no-op if already active). */
  switchPack: (id: string) => Promise<void>;
  /** Remove an imported pack (its content + its progress). The built-in cannot be removed. */
  removePack: (id: string) => Promise<void>;
}

const BrainContext = createContext<BrainContextValue | null>(null);

export function BrainProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [registry, setRegistry] = useState<PackRegistry>(() => emptyRegistry());
  const [store, setStore] = useState<ReviewStore>(() => emptyStore());
  const pointerRef = useRef<Pack | null>(null); // the loaded active pack, for note-body lookups
  // Mirror the store + active id in refs so gradeCard always writes the latest state under the pack it
  // belongs to, even if a stale handler (captured in an earlier render) fires. Written only where they
  // change (activation + gradeCard), never during render.
  const storeRef = useRef<ReviewStore>(store);
  const activeIdRef = useRef<string>("");
  // Guards against a slow activation resolving after a newer one (fast pack switching): only the latest
  // activation is allowed to commit its results to state.
  const loadSeq = useRef(0);

  /** Resolve + commit one registry's active pack: content + config(once) + that pack's review store. */
  async function activate(reg: PackRegistry, cfg: VaultConfig): Promise<void> {
    const seq = ++loadSeq.current;
    setStatus("loading");
    const entry = activeEntry(reg);
    const pack = await loadActivePack(reg); // throws if unresolvable
    const snap = loadPack(pack);
    const rev = await loadReviewStoreFor(reg.activeId, entry?.source === "builtin");
    if (seq !== loadSeq.current) return; // superseded by a newer activation
    pointerRef.current = pack;
    storeRef.current = rev;
    activeIdRef.current = reg.activeId;
    setManifest(pack.manifest);
    setSnapshot(snap);
    setConfig(cfg);
    setRegistry(reg);
    setStore(rev);
    setStatus("ready");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await loadAppConfig();
        const { registry: reg } = await loadRegistry();
        if (cancelled) return;
        try {
          await activate(reg, cfg);
        } catch (activateErr) {
          // The persisted active pack won't load (e.g. an imported blob was evicted/corrupted). Rather than
          // wedge on the error screen, fall back to the built-in — which is always fetchable from /pack.json.
          const builtin = reg.packs.find((p) => p.source === "builtin");
          if (!builtin || reg.activeId === builtin.id) throw activateErr;
          const fixed = setActive(reg, builtin.id);
          await activate(fixed, cfg);
          await saveRegistry(fixed);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function gradeCard(cardId: string, grade: Grade): Promise<ReviewState> {
    const { store: next, state } = applyReview(storeRef.current, cardId, grade, new Date());
    storeRef.current = next;
    setStore(next);
    await saveReviewStoreFor(activeIdRef.current, next);
    return state;
  }

  function noteBody(sourcePath: string): string | null {
    return pointerRef.current ? findPackBody(pointerRef.current, sourcePath) : null;
  }

  /**
   * Load `candidate`'s active pack, and persist the registry ONLY if it loads. On failure the previous pack
   * is still fully in state, so we just restore `status` to "ready" and re-throw for the caller (the Packs
   * page) to show an error — the app is never left half-switched or stuck on a spinner.
   */
  async function activateAndPersist(candidate: PackRegistry): Promise<void> {
    const cfg = config ?? (await loadAppConfig());
    try {
      await activate(candidate, cfg);
    } catch (err) {
      setStatus("ready"); // the previously-active pack remains loaded and valid
      throw err;
    }
    await saveRegistry(candidate);
  }

  async function importPack(file: File): Promise<void> {
    const text = await file.text();
    const { registry: candidate } = await importPackText(registry, text, new Date());
    await activateAndPersist(candidate);
  }

  async function switchPack(id: string): Promise<void> {
    if (id === registry.activeId) return;
    await activateAndPersist(setActive(registry, id));
  }

  async function removePack(id: string): Promise<void> {
    const wasActive = id === registry.activeId;
    // removeImportedPack persists the trimmed registry; its fallback active is the built-in, which always
    // loads from /pack.json, so re-activating after removing the active pack cannot wedge the app.
    const next = await removeImportedPack(registry, id);
    if (wasActive) {
      const cfg = config ?? (await loadAppConfig());
      await activate(next, cfg);
    } else {
      setRegistry(next); // active pack unchanged — just update the list
    }
  }

  return (
    <BrainContext.Provider
      value={{
        status,
        error,
        snapshot,
        config,
        manifest,
        registry,
        store,
        gradeCard,
        noteBody,
        importPack,
        switchPack,
        removePack,
      }}
    >
      {children}
    </BrainContext.Provider>
  );
}

/** Access the client data layer. Throws if used outside <BrainProvider>. */
export function useBrain(): BrainContextValue {
  const ctx = useContext(BrainContext);
  if (!ctx) throw new Error("useBrain must be used within <BrainProvider>.");
  return ctx;
}
