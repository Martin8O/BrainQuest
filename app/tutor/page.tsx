"use client";

// AI tutor (client). Surfaces the harvested recall prompts, tags each with its project area (so the
// learner can filter), and hands a path-free list to the client loop. Grading + variation generation now
// happen client-side against the user's chosen backend (see lib/tutorClient) — no server action. The
// vault is never touched; note text comes from the loaded pack.
import { Suspense } from "react";
import { GraduationCap } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { areaForProjects } from "@brainquest/core/tutor/area";
import TutorClient from "./TutorClient";
import { useBrain } from "../lib/BrainProvider";
import { PageError, PageLoading } from "../lib/PageStatus";
import type { TutorArea, TutorPrompt } from "./types";

function TutorView() {
  const { status, error, snapshot, config } = useBrain();
  const sp = useSearchParams();

  if (status === "loading") return <PageLoading label="Loading the tutor…" />;
  if (status === "error" || !snapshot || !config) return <PageError error={error} />;

  const fromSession = sp.get("from") === "session";
  const source = sp.get("source") ?? undefined;

  // Tag each recall prompt with its area (the project its source note belongs to), so the client can
  // filter by category. The vault is cross-project; this is what lets the learner skip the niche.
  const projectsBySlug = new Map(snapshot.learning.map((n) => [n.slug, n.projects]));
  const prompts: TutorPrompt[] = snapshot.harvest.recall.map((r) => {
    const area = areaForProjects(projectsBySlug.get(r.sourceSlug) ?? [], config);
    return { id: r.id, question: r.question, sourceSlug: r.sourceSlug, areaKey: area.key, areaLabel: area.label };
  });

  // One toggle per area present in the harvest, with its prompt count, biggest first.
  const areaMap = new Map<string, TutorArea>();
  for (const p of prompts) {
    const cur = areaMap.get(p.areaKey);
    if (cur) cur.count += 1;
    else
      areaMap.set(p.areaKey, {
        key: p.areaKey,
        label: p.areaLabel,
        count: 1,
        defaultOn: areaForProjects([`${config.tags.projectTagPrefix}${p.areaKey}`], config).defaultOn,
      });
  }
  const areas: TutorArea[] = [...areaMap.values()].sort((a, b) => b.count - a.count);

  // Forwarded from a session card ("Practice in the tutor"): open on a recall prompt from the SAME source
  // note, so the tutor stays on the card's topic instead of jumping to a random prompt in another project.
  const initialPromptId = source ? prompts.find((p) => p.sourceSlug === source)?.id : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <GraduationCap className="h-6 w-6 text-fuchsia-500" strokeWidth={2} /> AI tutor
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Answer a recall question in your own words — the AI varies it by difficulty (calibrated to your level),
          grades it against your note, and shows what you missed.
        </p>
      </header>

      {prompts.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-4xl">🤔</div>
          <h2 className="mt-3 text-xl font-semibold">No recall prompts yet</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Add a recall-prompt section to a note and rebuild the pack
            (<code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm run app:data</code>).
          </p>
        </div>
      ) : (
        <TutorClient prompts={prompts} areas={areas} fromSession={fromSession} initialPromptId={initialPromptId} />
      )}
    </main>
  );
}

export default function TutorPage() {
  // useSearchParams needs a Suspense boundary under static export.
  return (
    <Suspense fallback={<PageLoading label="Loading the tutor…" />}>
      <TutorView />
    </Suspense>
  );
}
