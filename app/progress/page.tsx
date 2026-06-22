// Progress page (server component). Reads the harvest (B1) + review store (B2), derives the whole
// mastery picture with the pure computeProgress(), and renders it: overall, per-concept ("where am I
// vs. everything ahead"), and per-cluster. force-dynamic because it reflects the live review store.
import Link from "next/link";
import { readVault } from "@/lib/vault/reader";
import { loadReviewStore } from "@/lib/srs/store";
import { computeProgress } from "@/lib/progress/mastery";
import type { ClusterProgress, ConceptMastery, MasteryLevel } from "@/lib/progress/types";

export const dynamic = "force-dynamic";

/**
 * Visual treatment per mastery level — label + Tailwind classes for chips and the legend. The dot
 * colours follow the same gradual ramp as the skill-tree map: grey → orange → yellow → green.
 */
const LEVELS: Record<MasteryLevel, { label: string; chip: string; dot: string }> = {
  mastered: { label: "Mastered", chip: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300", dot: "bg-green-500" },
  young: { label: "Almost", chip: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300", dot: "bg-yellow-400" },
  learning: { label: "Learning", chip: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300", dot: "bg-orange-500" },
  untouched: { label: "Not started", chip: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", dot: "bg-slate-400" },
};

const LEVEL_ORDER: MasteryLevel[] = ["mastered", "young", "learning", "untouched"];

function pct(x: number): number {
  return Math.round(x * 100);
}

export default async function ProgressPage() {
  const vault = await readVault();
  const store = await loadReviewStore();
  const { overall, concepts, clusters } = computeProgress(vault.harvest, vault.learning, store);

  const byLevel = LEVEL_ORDER.map((level) => ({
    level,
    items: concepts.filter((c) => c.level === level),
  }));

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">📊 Progress</h1>
          <p className="mt-1 text-sm text-zinc-500">How much you know vs. what&apos;s still ahead — grows as your vault does.</p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-zinc-500 underline hover:text-zinc-700">
          Overview
        </Link>
      </header>

      {!vault.ok && (
        <div className="mb-8 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Could not read the vault. {vault.error}
        </div>
      )}

      {/* Overall */}
      <section className="mb-10 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-4xl font-bold tabular-nums">{pct(overall.avgStrength)}%</div>
            <div className="mt-0.5 text-sm text-zinc-500">overall mastery</div>
          </div>
          <div className="text-right text-sm text-zinc-500">
            {overall.reviewedCards} / {overall.totalCards} cards reviewed
          </div>
        </div>
        <StackedBar buckets={overall.buckets} total={overall.totalCards} />
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
          <Legend dot="bg-green-500" label={`${overall.buckets.mature} mature`} />
          <Legend dot="bg-orange-500" label={`${overall.buckets.learning} learning`} />
          <Legend dot="bg-slate-400" label={`${overall.buckets.new} new`} />
        </div>
      </section>

      {/* Concepts: where am I vs. everything ahead */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold">Concepts</h2>
        <p className="mb-4 text-sm text-zinc-500">
          {concepts.length} in your graph · {byLevel.find((g) => g.level === "mastered")?.items.length ?? 0} mastered,{" "}
          {byLevel.find((g) => g.level === "untouched")?.items.length ?? 0} not started.
        </p>
        <div className="space-y-5">
          {byLevel.map(({ level, items }) =>
            items.length === 0 ? null : (
              <div key={level}>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${LEVELS[level].dot}`} />
                  {LEVELS[level].label}
                  <span className="font-normal text-zinc-400">({items.length})</span>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {items.map((c) => (
                    <ConceptChip key={c.concept} concept={c} />
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      </section>

      {/* Clusters: per source note */}
      <section>
        <h2 className="mb-4 text-xl font-semibold">
          By topic <span className="font-normal text-zinc-400">({clusters.length} notes)</span>
        </h2>
        <ul className="space-y-2.5">
          {clusters.map((cl) => (
            <ClusterRow key={cl.slug} cluster={cl} />
          ))}
        </ul>
      </section>
    </main>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/** A stacked bar: mature (green) → learning (amber) → new (zinc), widths proportional to counts. */
function StackedBar({ buckets, total }: { buckets: { new: number; learning: number; mature: number }; total: number }) {
  const w = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      <div className="h-full bg-green-500" style={{ width: `${w(buckets.mature)}%` }} />
      <div className="h-full bg-orange-500" style={{ width: `${w(buckets.learning)}%` }} />
      <div className="h-full bg-slate-400 dark:bg-slate-600" style={{ width: `${w(buckets.new)}%` }} />
    </div>
  );
}

function ConceptChip({ concept }: { concept: ConceptMastery }) {
  return (
    <li
      className={`rounded-full px-2.5 py-1 text-xs ${LEVELS[concept.level].chip}`}
      title={`${concept.cardCount} card${concept.cardCount === 1 ? "" : "s"} · ${pct(concept.avgStrength)}% strength`}
    >
      {concept.concept}
      {concept.cardCount > 0 && <span className="ml-1 opacity-60">{pct(concept.avgStrength)}%</span>}
    </li>
  );
}

function ClusterRow({ cluster }: { cluster: ClusterProgress }) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{cluster.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {pct(cluster.avgStrength)}% · {cluster.cardCount} cards
        </span>
      </div>
      <StackedBar buckets={cluster.buckets} total={cluster.cardCount} />
    </li>
  );
}
