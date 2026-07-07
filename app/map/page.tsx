"use client";

// Skill-tree map page (client). Reads the harvest + review store from the client data layer, derives
// mastery with computeProgress (C1), lays the concept graph out with the pure buildSkillMap (C2), and
// hands the positioned map + a concept→cards index to the client renderer. `?focus=` (a query param, not
// a dynamic route) opens on a concept when arriving from a session card — static-export friendly for M3.
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Network } from "lucide-react";
import { computeProgress } from "@brainquest/core/progress/mastery";
import { buildSkillMap } from "@brainquest/core/graph/layout";
import type { PanelCard } from "@brainquest/core/graph/types";
import MapClient from "./MapClient";
import { useBrain } from "../lib/BrainProvider";
import { PageError, PageLoading } from "../lib/PageStatus";

function MapView() {
  const { status, error, snapshot, store } = useBrain();
  const focus = useSearchParams().get("focus");

  if (status === "loading") return <PageLoading label="Laying out the skill tree…" />;
  if (status === "error" || !snapshot) return <PageError error={error} />;

  const { concepts } = computeProgress(snapshot.harvest, snapshot.learning, store);
  const map = buildSkillMap(snapshot.harvest.graph, concepts);

  // Index this concept's cards for the detail panel. Keyed case-insensitively, the same way C1 matches
  // a card's `→ [[concept]]` link to its concept node (Obsidian resolves wikilinks case-insensitively).
  const cardsByConcept: Record<string, PanelCard[]> = {};
  for (const c of snapshot.harvest.cards) {
    if (!c.conceptLink) continue;
    const key = c.conceptLink.toLowerCase();
    (cardsByConcept[key] ??= []).push({ id: c.id, front: c.front, back: c.back, sourceSlug: c.sourceSlug });
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      {/* Only when arriving from a session card (a focus is set) — gives a way back to the review loop. */}
      {focus && (
        <Link
          href="/session"
          className="btn-primary mb-6 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold"
        >
          <ArrowLeft className="h-4 w-4" /> Back to session
        </Link>
      )}

      <header className="mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md shadow-violet-500/30">
            <Network className="h-5 w-5" strokeWidth={2} />
          </span>
          Skill tree
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every concept and how it connects — where you are vs. everything ahead.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-500">
        <span>
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{map.nodes.length}</span> concepts
        </span>
        <span>
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{map.edges.length}</span> links
        </span>
        <span>
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{map.unlockedCount}</span> unlocked
        </span>
        <span>
          <span className="font-semibold text-zinc-500">{map.lockedCount}</span> locked
        </span>
      </div>

      <MapClient map={map} cardsByConcept={cardsByConcept} initialFocus={focus} />
    </main>
  );
}

export default function MapPage() {
  // useSearchParams needs a Suspense boundary under static export.
  return (
    <Suspense fallback={<PageLoading label="Laying out the skill tree…" />}>
      <MapView />
    </Suspense>
  );
}
