// In-app note reader (server component). The daily session links here so a card is a doorway to its full
// teaching note — the deep layer — without leaving BrainQuest. READ-ONLY: it reads the note file and
// renders it; it never writes the vault. Handles both learning and concept notes by slug.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readNoteBody, readVault } from "@brainquest/core/vault/reader";

export const dynamic = "force-dynamic";

/** Render Obsidian wikilinks as plain text (`[[target|alias]]` → alias, `[[target]]` → target). */
function stripWikilinks(md: string): string {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) =>
    (alias ?? target).trim(),
  );
}

export default async function NotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const vault = await readVault();
  const note = [...vault.learning, ...vault.concepts].find((n) => n.slug === decoded);
  if (!note) notFound();

  let md = "";
  try {
    md = await readNoteBody(note.path);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/session"
        className="mb-6 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to session
      </Link>

      <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
        <FileText className="h-4 w-4" /> {note.kind === "learning" ? "Learning note" : "Concept"}
        {note.kind === "learning" && note.date && <span className="font-mono normal-case">· {note.date}</span>}
      </div>

      <article className="prose prose-zinc max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-pre:bg-zinc-900 prose-pre:text-zinc-100">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripWikilinks(md)}</ReactMarkdown>
      </article>
    </main>
  );
}
