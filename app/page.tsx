import { readVault } from "@/lib/vault/reader";
import type { ConceptNote, LearningNote } from "@/lib/vault/types";

// Read the vault fresh on every request — it grows as Martin learns, so never prerender.
export const dynamic = "force-dynamic";

export default async function Home() {
  const vault = await readVault();
  const totalCards = vault.learning.reduce((n, x) => n + x.cardCount, 0);
  const totalRecall = vault.learning.reduce((n, x) => n + x.recallCount, 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">🧠 BrainQuest</h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Read-only overview of the <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">vault</code> vault —
          the raw material BrainQuest will turn into a spaced-repetition learning game.
        </p>
        <p className="mt-2 font-mono text-xs text-zinc-500">📂 {vault.vaultPath}</p>
      </header>

      {!vault.ok && (
        <div className="mb-8 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Could not read the vault. {vault.error}
        </div>
      )}

      <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Learning notes" value={vault.learning.length} />
        <Stat label="Concepts" value={vault.concepts.length} />
        <Stat label="📘 Card candidates" value={totalCards} />
        <Stat label="❓ Recall prompts" value={totalRecall} />
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
        <h2 className="mb-4 text-xl font-semibold">
          Concepts <span className="font-normal text-zinc-400">({vault.concepts.length})</span>
        </h2>
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
        <span title="card candidates (📘 Nové pojmy)">📘 {note.cardCount}</span>
        <span title="recall prompts (❓ K probrání příště)">❓ {note.recallCount}</span>
      </div>
    </li>
  );
}

function ConceptCard({ note }: { note: ConceptNote }) {
  return (
    <li className="flex flex-col rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{note.title}</span>
        <span className="shrink-0 text-xs text-zinc-500" title="related concepts (Související)">
          🔗 {note.relatedCount}
        </span>
      </div>
      {note.gloss && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{note.gloss}</p>}
    </li>
  );
}
