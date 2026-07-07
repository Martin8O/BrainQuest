"use client";

// In-app note reader (client). A session card links here (`/note?slug=…`) so a card is a doorway to its
// full teaching note — the deep layer — without leaving BrainQuest. The note text comes from the loaded
// pack (READ-ONLY: nothing is written). A query param, not a dynamic route, so the app static-exports
// cleanly for the mobile shell (M3). Handles both learning and concept notes by slug.
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useBrain } from "../lib/BrainProvider";
import { PageError, PageLoading } from "../lib/PageStatus";

/** Render Obsidian wikilinks as plain text (`[[target|alias]]` → alias, `[[target]]` → target). */
function stripWikilinks(md: string): string {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) =>
    (alias ?? target).trim(),
  );
}

function NoteView() {
  const { status, error, snapshot, noteBody } = useBrain();
  const slug = useSearchParams().get("slug") ?? "";

  if (status === "loading") return <PageLoading label="Loading note…" />;
  if (status === "error" || !snapshot) return <PageError error={error} />;

  const note = [...snapshot.learning, ...snapshot.concepts].find((n) => n.slug === slug);
  const md = note ? noteBody(note.path) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/session"
        className="btn-primary mb-6 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold"
      >
        <ArrowLeft className="h-4 w-4" /> Back to session
      </Link>

      {!note || md == null ? (
        <div className="bq-card rounded-2xl p-8 text-center">
          <h2 className="text-lg font-semibold">Note not found</h2>
          <p className="mt-2 text-sm text-zinc-500">This note isn’t in the loaded pack.</p>
        </div>
      ) : (
        <div className="bq-card bq-topline relative overflow-hidden rounded-3xl p-6 sm:p-8">
          <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/15 dark:text-indigo-400">
              <FileText className="h-4 w-4" />
            </span>
            {note.kind === "learning" ? "Learning note" : "Concept"}
            {note.kind === "learning" && note.date && <span className="font-mono normal-case">· {note.date}</span>}
          </div>

          <article className="prose prose-zinc max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-pre:bg-zinc-900 prose-pre:text-zinc-100 dark:prose-pre:bg-zinc-950/80">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripWikilinks(md)}</ReactMarkdown>
          </article>
        </div>
      )}
    </main>
  );
}

export default function NotePage() {
  // useSearchParams needs a Suspense boundary under static export.
  return (
    <Suspense fallback={<PageLoading label="Loading note…" />}>
      <NoteView />
    </Suspense>
  );
}
