"use client";

// The tutor loop — the only client component in D1. It owns the UI state (which prompt, the typed
// answer, the returned grade) and calls the gradeRecallAnswer server action, which runs the Claude
// call on the server. Picking the next prompt uses Math.random() inside a click handler only (never
// during render), so there's no hydration mismatch and no reproducibility concern — it's UI variety,
// not a data pipeline.
import Link from "next/link";
import { useCallback, useState } from "react";
import { gradeRecallAnswer } from "./actions";
import type { GradeResponse, GradeResult, Verdict } from "@/lib/tutor/types";
import type { TutorPrompt } from "./types";

/** Per-verdict styling — the headline badge + score colour. */
const VERDICT: Record<Verdict, { label: string; badge: string; bar: string }> = {
  correct: { label: "Výborně", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", bar: "bg-emerald-500" },
  partial: { label: "Skoro", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200", bar: "bg-amber-500" },
  incorrect: { label: "Ještě ne", badge: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200", bar: "bg-rose-500" },
};

export default function TutorClient({ prompts }: { prompts: TutorPrompt[] }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<GradeResponse | null>(null);

  const prompt = prompts[index];

  const nextPrompt = useCallback(() => {
    setIndex((cur) => {
      if (prompts.length <= 1) return cur;
      let n = cur;
      while (n === cur) n = Math.floor(Math.random() * prompts.length); // jump to a different one
      return n;
    });
    setAnswer("");
    setResponse(null);
  }, [prompts.length]);

  const submit = useCallback(async () => {
    if (pending || !answer.trim()) return;
    setPending(true);
    setResponse(null);
    try {
      setResponse(await gradeRecallAnswer(prompt.id, answer));
    } catch {
      setResponse({ ok: false, code: "api", error: "Hodnocení selhalo (síť?). Zkus to znovu." });
    } finally {
      setPending(false);
    }
  }, [pending, answer, prompt.id]);

  return (
    <div>
      {/* Provenance + cycle */}
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
        <span className="font-mono">{prompt.sourceSlug}</span>
        <span>
          {index + 1} / {prompts.length}
        </span>
      </div>

      {/* The question */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
        <div className="text-lg font-semibold sm:text-xl">{prompt.question}</div>

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={pending}
          rows={5}
          placeholder="Odpověz vlastními slovy…"
          className="mt-4 w-full resize-y rounded-xl border border-zinc-300 bg-white p-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-indigo-900"
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void submit()}
            disabled={pending || !answer.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {pending ? "Hodnotím…" : "Ohodnotit odpověď"}
            {!pending && <span className="ml-1 opacity-60">(⌘/Ctrl+↵)</span>}
          </button>
          <button
            onClick={nextPrompt}
            disabled={pending}
            className="text-sm text-zinc-500 underline hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
          >
            Další otázka →
          </button>
        </div>
      </div>

      {/* The grade */}
      {response && !response.ok && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {response.error}
        </div>
      )}

      {response && response.ok && <GradeCard result={response.result} />}

      <div className="mt-6 text-center">
        <Link href="/" className="text-sm text-zinc-500 underline hover:text-zinc-700">
          Back to overview
        </Link>
      </div>
    </div>
  );
}

function GradeCard({ result }: { result: GradeResult }) {
  const v = VERDICT[result.verdict];
  return (
    <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${v.badge}`}>{v.label}</span>
        <span className="text-sm tabular-nums text-zinc-500">{result.score} / 100</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${v.bar} transition-all`} style={{ width: `${result.score}%` }} />
      </div>

      {result.summary && <p className="mt-4 text-zinc-700 dark:text-zinc-300">{result.summary}</p>}

      {result.gotRight.length > 0 && (
        <Section title="Co ti vyšlo" rows={result.gotRight} mark="✓" markClass="text-emerald-600 dark:text-emerald-400" />
      )}
      {result.missed.length > 0 && (
        <Section title="Co ti uniklo" rows={result.missed} mark="✗" markClass="text-rose-600 dark:text-rose-400" />
      )}

      {result.modelAnswer && (
        <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/50">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            Vzorová odpověď
          </div>
          <p className="mt-1 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{result.modelAnswer}</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, rows, mark, markClass }: { title: string; rows: string[]; mark: string; markClass: string }) {
  return (
    <div className="mt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
      <ul className="mt-1 space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <span className={`shrink-0 font-bold ${markClass}`}>{mark}</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
