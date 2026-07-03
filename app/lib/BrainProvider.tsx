"use client";

// The client-only data layer (M2). One provider loads the compiled pack + config (static assets) and the
// review store (IndexedDB), then exposes them to every page via context — replacing the server components
// that used to read the vault + data/ from disk. All state lives on the device: grading a card updates the
// in-memory store and persists it to IndexedDB, no server round-trip. First run seeds progress from the
// optional /reviews.seed.json so existing review history carries over.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { loadContent, loadReviewSeed } from "./content";
import { idbGet, idbSet, KV_STORE, REVIEWS_KEY } from "./idb";
import { applyReview, emptyStore, parseReviewStore } from "@brainquest/core/srs/reviewStore";
import { findPackBody } from "@brainquest/core/pack/loader";
import type { Pack } from "@brainquest/core/pack/types";
import type { VaultConfig } from "@brainquest/core/vault/configTypes";
import type { VaultSnapshot } from "@brainquest/core/vault/types";
import type { Grade, ReviewState, ReviewStore } from "@brainquest/core/srs/types";

type Status = "loading" | "ready" | "error";

interface BrainContextValue {
  status: Status;
  error: string | null;
  /** The content model (assembled from the pack) — cards, recall, graph, notes, concepts. */
  snapshot: VaultSnapshot | null;
  /** Presentation config: area labels, tag scheme, harvest headings, tutor defaults. */
  config: VaultConfig | null;
  /** Review state for every card, in memory (persisted to IndexedDB on every change). */
  store: ReviewStore;
  /** Grade one card: schedule it (pure FSRS), persist, and return the new state. */
  gradeCard: (cardId: string, grade: Grade) => Promise<ReviewState>;
  /** A note's markdown source text from the pack (for the reader + the tutor), or null. */
  noteBody: (sourcePath: string) => string | null;
}

const BrainContext = createContext<BrainContextValue | null>(null);

export function BrainProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [pack, setPack] = useState<Pack | null>(null);
  const [store, setStore] = useState<ReviewStore>(() => emptyStore());
  // Mirror the store in a ref so gradeCard always applies onto the latest state even if a stale handler
  // (captured in an earlier render) invokes it — the store is a read-modify-write, so this matters. The
  // ref is written only where the store changes (the load effect + gradeCard), never during render.
  const storeRef = useRef<ReviewStore>(store);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const content = await loadContent();
        // Load persisted progress; on an empty device, seed once from the shipped snapshot (if any).
        const persisted = await idbGet<unknown>(KV_STORE, REVIEWS_KEY);
        let initial: ReviewStore;
        if (persisted !== undefined) {
          initial = parseReviewStore(persisted);
        } else {
          const seed = await loadReviewSeed();
          initial = seed ?? emptyStore();
          if (seed) await idbSet(KV_STORE, REVIEWS_KEY, seed); // persist the seed so it imports only once
        }
        if (cancelled) return;
        storeRef.current = initial;
        setSnapshot(content.snapshot);
        setConfig(content.config);
        setPack(content.pack);
        setStore(initial);
        setStatus("ready");
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
    await idbSet(KV_STORE, REVIEWS_KEY, next);
    return state;
  }

  function noteBody(sourcePath: string): string | null {
    return pack ? findPackBody(pack, sourcePath) : null;
  }

  return (
    <BrainContext.Provider value={{ status, error, snapshot, config, store, gradeCard, noteBody }}>
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
