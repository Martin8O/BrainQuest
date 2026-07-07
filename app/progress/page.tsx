"use client";

// Progress page (client). Reads the harvest + review store from the client data layer, derives the whole
// mastery picture with the pure computeProgress(), and renders it: overall, per-concept ("where am I
// vs. everything ahead"), and per-cluster.
import { TrendingUp } from "lucide-react";
import { computeProgress } from "@brainquest/core/progress/mastery";
import type { ClusterProgress, ConceptMastery, MasteryLevel } from "@brainquest/core/progress/types";
import { useBrain } from "../lib/BrainProvider";
import { PageError, PageLoading } from "../lib/PageStatus";

/**
 * Visual treatment per mastery level — label + Tailwind classes for chips and the legend. The dot
 * colours follow the same gradual ramp as the skill-tree map: grey → orange → yellow → green.
 */
const LEVELS: Record<MasteryLevel, { label: string; chip: string; dot: string }> = {
  mastered: { label: "Mastered", chip: "bg-green-500/12 text-green-700 ring-1 ring-green-500/25 dark:bg-green-400/10 dark:text-green-300 dark:ring-green-400/25", dot: "bg-green-500" },
  young: { label: "Almost", chip: "bg-yellow-500/12 text-yellow-700 ring-1 ring-yellow-500/25 dark:bg-yellow-400/10 dark:text-yellow-300 dark:ring-yellow-400/25", dot: "bg-yellow-400" },
  learning: { label: "Learning", chip: "bg-orange-500/12 text-orange-700 ring-1 ring-orange-500/25 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-400/25", dot: "bg-orange-500" },
  untouched: { label: "Not started", chip: "bg-slate-500/10 text-slate-500 ring-1 ring-slate-500/20 dark:bg-slate-400/10 dark:text-slate-400 dark:ring-slate-400/20", dot: "bg-slate-400" },
};

const LEVEL_ORDER: MasteryLevel[] = ["mastered", "young", "learning", "untouched"];

function pct(x: number): number {
  return Math.round(x * 100);
}

export default function ProgressPage() {
  const { status, error, snapshot, store } = useBrain();
  if (status === "loading") return <PageLoading label="Loading your progress…" />;
  if (status === "error" || !snapshot) return <PageError error={error} />;

  const { overall, concepts, clusters } = computeProgress(snapshot.harvest, snapshot.learning, store);

  const byLevel = LEVEL_ORDER.map((level) => ({
    level,
    items: concepts.filter((c) => c.level === level),
  }));

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30">
            <TrendingUp className="h-5 w-5" strokeWidth={2} />
          </span>
          Progress
        </h1>
        <p className="mt-1 text-sm text-zinc-500">How much you know vs. what&apos;s still ahead — grows as your vault does.</p>
      </header>

      {/* Overall */}
      <section className="bq-card bq-topline relative mb-10 overflow-hidden rounded-2xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-gradient text-5xl font-extrabold tabular-nums">{pct(overall.avgStrength)}%</div>
            <div className="mt-1 text-sm text-zinc-500">overall mastery</div>
          </div>
          <div className="text-right text-sm text-zinc-500">
            {overall.reviewedCards} / {overall.totalCards} cards reviewed
          </div>
        </div>
        <StrengthBar buckets={overall.buckets} total={overall.totalCards} avgStrength={overall.avgStrength} />
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
        <h2 className="mb-1 text-xl font-semibold">
          By topic <span className="font-normal text-zinc-400">({clusters.length} notes)</span>
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          <span className="font-medium">%</span> = how well you know it · <span className="font-medium">X/Y</span> = cards seen
        </p>
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

/**
 * A strength bar whose FILLED length equals the shown % (avgStrength) — so the bar and the number
 * always agree. The fill is split by maturity: green = the share contributed by mature cards
 * (mature/total, each worth full strength), orange = the rest of the strength (from learning cards);
 * the grey remainder is how far the topic still is from full mastery. A pile of just-started cards
 * therefore reads as a short orange sliver (low strength), not a full orange bar (high count).
 */
function StrengthBar({
  buckets,
  total,
  avgStrength,
}: {
  buckets: { new: number; learning: number; mature: number };
  total: number;
  avgStrength: number;
}) {
  const greenFrac = total === 0 ? 0 : buckets.mature / total;
  const orangeFrac = Math.max(0, avgStrength - greenFrac); // learning cards' strength share
  return (
    <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-900/10 shadow-inner dark:bg-white/10">
      <div
        className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
        style={{ width: `${greenFrac * 100}%` }}
      />
      <div
        className="h-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-500"
        style={{ width: `${orangeFrac * 100}%` }}
      />
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
    <li className="rounded-xl border border-zinc-200/80 bg-white/70 p-3 shadow-sm transition duration-200 hover:border-zinc-300 hover:shadow-md dark:border-white/10 dark:bg-zinc-900/60 dark:hover:border-white/20">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{cluster.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {pct(cluster.avgStrength)}% · {cluster.reviewedCards}/{cluster.cardCount} cards
        </span>
      </div>
      <StrengthBar buckets={cluster.buckets} total={cluster.cardCount} avgStrength={cluster.avgStrength} />
    </li>
  );
}
