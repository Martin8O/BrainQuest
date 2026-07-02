// AI tutor (server component). It reads the B1 harvest, surfaces the recall prompts (which were
// harvested back in B1 but unused until now), and hands a path-free list to the client loop. The
// grading happens in a "use server" action → the configured LLM backend (local Ollama or a paid API).
// force-dynamic because the vault grows as Martin learns. READ-ONLY: this page never writes the vault.
import { GraduationCap } from "lucide-react";
import { readVault } from "@brainquest/core/vault/reader";
import { loadVaultConfig, primaryHeading } from "@brainquest/core/vault/config";
import { areaForProjects } from "@brainquest/core/tutor/area";
import TutorClient from "./TutorClient";
import type { TutorArea, TutorPrompt } from "./types";

export const dynamic = "force-dynamic";

export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const fromSession = sp.from === "session";
  const vault = await readVault();
  const cfg = loadVaultConfig();

  // Tag each recall prompt with its area (the project its source note belongs to), so the client can
  // filter by category. The vault is cross-project; this is what lets the learner skip the niche.
  const projectsBySlug = new Map(vault.learning.map((n) => [n.slug, n.projects]));
  const prompts: TutorPrompt[] = vault.harvest.recall.map((r) => {
    const area = areaForProjects(projectsBySlug.get(r.sourceSlug) ?? [], cfg);
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
        defaultOn: areaForProjects([`${cfg.tags.projectTagPrefix}${p.areaKey}`], cfg).defaultOn,
      });
  }
  const areas: TutorArea[] = [...areaMap.values()].sort((a, b) => b.count - a.count);

  // Forwarded from a session card ("Practice in the tutor"): open on a recall prompt from the SAME source
  // note, so the tutor stays on the card's topic instead of jumping to a random prompt in another project.
  const initialPromptId = sp.source ? prompts.find((p) => p.sourceSlug === sp.source)?.id : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <GraduationCap className="h-6 w-6 text-fuchsia-500" strokeWidth={2} /> AI tutor
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Answer a recall question in your own words — a local AI varies it by difficulty (calibrated to your level),
          grades it against your note, and shows what you missed.
        </p>
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
            Add a “{primaryHeading(cfg.harvest.recallHeading)}” section to a note in your{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">vault</code> and they’ll show up here.
          </p>
        </div>
      ) : (
        <TutorClient prompts={prompts} areas={areas} fromSession={fromSession} initialPromptId={initialPromptId} />
      )}
    </main>
  );
}
