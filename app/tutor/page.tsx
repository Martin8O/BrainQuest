// AI tutor (server component). It reads the B1 harvest, surfaces the recall prompts (which were
// harvested back in B1 but unused until now), and hands a path-free list to the client loop. The
// grading itself happens in a "use server" action → the Claude API. force-dynamic because the
// vault grows as Martin learns. READ-ONLY: this page never writes the vault.
import Link from "next/link";
import { readVault } from "@/lib/vault/reader";
import { areaForProjects } from "@/lib/tutor/area";
import TutorClient from "./TutorClient";
import type { TutorArea, TutorPrompt } from "./types";

export const dynamic = "force-dynamic";

export default async function TutorPage() {
  const vault = await readVault();

  // Tag each recall prompt with its area (the project its source note belongs to), so the client can
  // filter by category. The vault is cross-project; this is what lets the learner skip the niche.
  const projectsBySlug = new Map(vault.learning.map((n) => [n.slug, n.projects]));
  const prompts: TutorPrompt[] = vault.harvest.recall.map((r) => {
    const area = areaForProjects(projectsBySlug.get(r.sourceSlug) ?? []);
    return { id: r.id, question: r.question, sourceSlug: r.sourceSlug, areaKey: area.key, areaLabel: area.label };
  });

  // One toggle per area present in the harvest, with its prompt count, biggest first.
  const areaMap = new Map<string, TutorArea>();
  for (const p of prompts) {
    const cur = areaMap.get(p.areaKey);
    if (cur) cur.count += 1;
    else areaMap.set(p.areaKey, { key: p.areaKey, label: p.areaLabel, count: 1, defaultOn: areaForProjects([`project/${p.areaKey}`]).defaultOn });
  }
  const areas: TutorArea[] = [...areaMap.values()].sort((a, b) => b.count - a.count);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">🎓 AI tutor</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Answer a recall question in your own words — a local AI varies it by difficulty (calibrated to your level),
            grades it against your note, and shows what you missed.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-zinc-500 underline hover:text-zinc-700">
          Overview
        </Link>
      </header>

      {!vault.ok ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Could not read the vault. {vault.error}
        </div>
      ) : prompts.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-4xl">🤔</div>
          <h2 className="mt-3 text-xl font-semibold">No recall prompts yet</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Add a “❓ K probrání příště” section to a note in{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">vault</code> and they’ll show up here.
          </p>
        </div>
      ) : (
        <TutorClient prompts={prompts} areas={areas} />
      )}
    </main>
  );
}
