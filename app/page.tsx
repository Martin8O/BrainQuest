import Link from "next/link";
import { readVault } from "@/lib/vault/reader";
import type { Card, ConceptNote, LearningNote } from "@/lib/vault/types";
import { loadReviewStore } from "@/lib/srs/store";
import { ensureStates, selectDue } from "@/lib/srs/scheduler";
import { computeProgress } from "@/lib/progress/mastery";

// Read the vault fresh on every request — it grows as Martin learns, so never prerender.
export const dynamic = "force-dynamic";

const CARD_PREVIEW_COUNT = 12;

export default async function Home() {
  const now = new Date();
  const vault = await readVault();
  const { cards, recall, graph } = vault.harvest;

  // How many cards are due right now — drives the "start session" call to action.
  const store = await loadReviewStore();
  const dueCount = selectDue(
    ensureStates(
      store,
      cards.map((c) => c.id),
      now,
    ),
    now,
  ).length;

  // Overall mastery — the "how much do I know" headline, links to the full progress view.
  const masteryPct = Math.round(computeProgress(vault.harvest, vault.learning, store).overall.avgStrength * 100);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">🧠 BrainQuest</h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Read-only overview of the <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">vault</code> vault,
          harvested into cards, recall prompts, and a concept graph — the raw material for the spaced-repetition game.
        </p>
        <p className="mt-2 font-mono text-xs text-zinc-500">📂 {vault.vaultPath}</p>
      </header>

      <div className="mb-10 grid gap-3 sm:grid-cols-3">
        <Link
          href="/session"
          className="flex items-center justify-between gap-4 rounded-2xl border border-indigo-300 bg-indigo-50 p-5 transition hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/50 dark:hover:bg-indigo-950"
        >
          <div>
            <div className="text-lg font-semibold">📚 Start daily session</div>
            <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              {dueCount > 0
                ? `${dueCount} ${dueCount === 1 ? "card" : "cards"} due — flip, recall, grade.`
                : "Nothing due right now — you're all caught up."}
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">
            {dueCount} due →
          </span>
        </Link>

        <Link
          href="/progress"
          className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 transition hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/50 dark:hover:bg-emerald-950"
        >
          <div>
            <div className="text-lg font-semibold">📊 View progress</div>
            <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              How much you know vs. what&apos;s ahead.
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">
            {masteryPct}% →
          </span>
        </Link>

        <Link
          href="/map"
          className="flex items-center justify-between gap-4 rounded-2xl border border-violet-300 bg-violet-50 p-5 transition hover:border-violet-400 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/50 dark:hover:bg-violet-950"
        >
          <div>
            <div className="text-lg font-semibold">🗺️ Skill tree</div>
            <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              Every concept and how they connect.
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-violet-600 px-3 py-1.5 text-sm font-medium text-white">
            {vault.concepts.length} →
          </span>
        </Link>
      </div>

      {!vault.ok && (
        <div className="mb-8 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Could not read the vault. {vault.error}
        </div>
      )}

      <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Learning notes" value={vault.learning.length} />
        <Stat label="Concepts" value={vault.concepts.length} />
        <Stat label="📘 Cards" value={cards.length} />
        <Stat label="❓ Recall prompts" value={recall.length} />
        <Stat label="🔗 Graph edges" value={graph.edges.length} />
      </section>

      <section className="mb-12">
        <h2 className="mb-1 text-xl font-semibold">Harvested cards</h2>
        <p className="mb-4 text-sm text-zinc-500">
          First {Math.min(CARD_PREVIEW_COUNT, cards.length)} of {cards.length}, parsed from the “📘 Nové pojmy” bullets.
        </p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.slice(0, CARD_PREVIEW_COUNT).map((c) => (
            <CardPreview key={c.id} card={c} />
          ))}
        </ul>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">
          Learning notes <span className="font-normal text-zinc-400">({vault.learning.length})</span>
        </h2>
        <ul className="space-y-2">
          {vault.learning.map((n) => (
            <LearningRow key={n.slug} note={n} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 text-xl font-semibold">
          Concepts <span className="font-normal text-zinc-400">({vault.concepts.length})</span>
        </h2>
        <p className="mb-4 text-sm text-zinc-500">
          {graph.nodes.length} nodes · {graph.edges.length} edges in the concept graph (from “Související”).
        </p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vault.concepts.map((c) => (
            <ConceptCard key={c.slug} note={c} />
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function CardPreview({ card }: { card: Card }) {
  return (
    <li className="flex flex-col rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="font-medium">{card.front}</div>
      <p className="mt-1 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{card.back}</p>
      {card.conceptLink && (
        <span className="mt-2 self-start rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          🔗 {card.conceptLink}
        </span>
      )}
    </li>
  );
}

function LearningRow({ note }: { note: LearningNote }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="truncate font-medium">{note.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {note.date && <span className="font-mono">{note.date}</span>}
          {note.projects.map((p) => (
            <span key={p} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
              #{p}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span title="cards harvested (📘 Nové pojmy)">📘 {note.cards.length}</span>
        <span title="recall prompts (❓ K probrání příště)">❓ {note.recall.length}</span>
      </div>
    </li>
  );
}

function ConceptCard({ note }: { note: ConceptNote }) {
  return (
    <li className="flex flex-col rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{note.title}</span>
        <span className="shrink-0 text-xs text-zinc-500" title="related concepts (Související edges)">
          🔗 {note.edges.length}
        </span>
      </div>
      {note.gloss && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{note.gloss}</p>}
    </li>
  );
}
