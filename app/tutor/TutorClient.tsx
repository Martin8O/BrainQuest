"use client";

// The tutor loop. It owns the UI state (which area filter, which prompt, the difficulty ladder + chosen
// rung, the typed answer, the returned grade) and calls two server actions: getVariations (D2 — builds a
// fresh, fixed ladder of rephrasings calibrated to the learner's mastery) and gradeRecallAnswer (D1 —
// grades the answer against the source note). The AREA FILTER lets the learner focus on chosen projects
// and skip the niche (RL is off by default); the choice persists in localStorage. The original question
// shows instantly; the variations swap in when the local model finishes, and are cached server-side so
// the second visit is instant. Picking the next prompt uses Math.random() inside a click handler only
// (never during render) — UI variety, no reproducibility concern and no hydration mismatch.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { gradeRecallAnswer, getVariations } from "./actions";
import type { GradeResponse, GradeResult, Variation, VariationLadder, Verdict } from "@/lib/tutor/types";
import type { TutorArea, TutorPrompt } from "./types";

/** Per-verdict styling — the headline badge + score colour. */
const VERDICT: Record<Verdict, { label: string; badge: string; bar: string }> = {
  correct: { label: "Výborně", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", bar: "bg-emerald-500" },
  partial: { label: "Skoro", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200", bar: "bg-amber-500" },
  incorrect: { label: "Ještě ne", badge: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200", bar: "bg-rose-500" },
};

/** localStorage key for the area filter (per-device UI preference, not learning data). */
const AREAS_KEY = "bq.tutor.areas";

/** Pick a random prompt id from a pool, avoiding `avoid` when the pool has more than one. */
function randomId(pool: TutorPrompt[], avoid?: string): string {
  if (pool.length === 0) return "";
  if (pool.length === 1) return pool[0].id;
  let id = avoid ?? "";
  while (id === (avoid ?? "")) id = pool[Math.floor(Math.random() * pool.length)].id;
  return id;
}

export default function TutorClient({ prompts, areas }: { prompts: TutorPrompt[]; areas: TutorArea[] }) {
  // Which areas (projects) are active. Init from each area's default (RL off) — deterministic, so the
  // server render and first client render match; a saved preference is applied in an effect after mount.
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(areas.filter((a) => a.defaultOn).map((a) => a.key)));

  const pool = useMemo(() => prompts.filter((p) => enabled.has(p.areaKey)), [prompts, enabled]);

  const [currentId, setCurrentId] = useState<string>(() => {
    const on = new Set(areas.filter((a) => a.defaultOn).map((a) => a.key));
    return prompts.find((p) => on.has(p.areaKey))?.id ?? prompts[0]?.id ?? "";
  });

  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<GradeResponse | null>(null);

  // D2 — the difficulty ladder for the current prompt + which rung is selected. We stamp the ladder with
  // the prompt id it belongs to, so "is it ready / still loading" is DERIVED by comparing ids rather than
  // flipping a loading flag synchronously inside an effect (which React discourages). `note` carries the
  // soft fallback message ("offline → original question").
  const [ladderData, setLadderData] = useState<{ promptId: string; ladder: VariationLadder | null; note: string | null } | null>(null);
  const [level, setLevel] = useState(1);

  // The current prompt, derived: the chosen id if it's still in the pool, else the pool's first (so a
  // filter change that drops the current prompt falls back gracefully without a setState-in-render).
  const prompt: TutorPrompt | undefined = pool.find((p) => p.id === currentId) ?? pool[0];
  const promptId = prompt?.id;

  const ready = ladderData?.promptId === promptId; // data we hold is for THIS prompt, not a stale one
  const ladder = ready ? ladderData!.ladder : null;
  const ladderNote = ready ? ladderData!.note : null;
  const ladderLoading = !!promptId && !ready; // until the current prompt's ladder lands, we're (re)generating

  // Apply a saved area preference once on mount (per-device). Init above is the deterministic default, so
  // the first paint matches the server; this only adjusts afterwards → no hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AREAS_KEY);
      if (!raw) return;
      const keys = (JSON.parse(raw) as string[]).filter((k) => areas.some((a) => a.key === k));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of a UI pref from localStorage
      setEnabled(new Set(keys));
    } catch {
      // ignore a malformed/blocked localStorage — defaults already apply
    }
  }, [areas]);

  // Fetch (or reuse the server cache of) the ladder whenever the prompt changes. The cancelled flag drops
  // a slow generation for a prompt the learner has already skipped past (stale-response race). No
  // synchronous setState here — the resets are derived from the id comparison instead.
  useEffect(() => {
    if (!promptId) return;
    let cancelled = false;
    void getVariations(promptId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setLadderData({ promptId, ladder: res.ladder, note: null });
        setLevel(res.ladder.startLevel); // open at the learner's calibrated difficulty
      } else {
        setLadderData({ promptId, ladder: null, note: res.error }); // keep the original question
      }
    });
    return () => {
      cancelled = true;
    };
  }, [promptId]);

  /** The question actually shown + graded: the chosen rung when the ladder is ready, else the original. */
  const current: Variation | null = ladder?.variations.find((v) => v.level === level) ?? null;
  const shownQuestion = current?.question ?? prompt?.question ?? "";

  const persist = useCallback((set: Set<string>) => {
    try {
      localStorage.setItem(AREAS_KEY, JSON.stringify([...set]));
    } catch {
      // ignore — persistence is best-effort
    }
  }, []);

  const toggleArea = useCallback(
    (key: string) => {
      const next = new Set(enabled);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setEnabled(next);
      persist(next);
      // If the current prompt's area just turned off, jump to one that's still in the (new) pool.
      const nextPool = prompts.filter((p) => next.has(p.areaKey));
      if (!nextPool.some((p) => p.id === currentId)) {
        setCurrentId(randomId(nextPool));
        setAnswer("");
        setResponse(null);
      }
    },
    [enabled, prompts, currentId, persist],
  );

  const pickLevel = useCallback((next: number) => {
    setLevel(next);
    setResponse(null); // a grade belongs to one question — drop it when the question changes
  }, []);

  const nextPrompt = useCallback(() => {
    if (pool.length === 0) return;
    setCurrentId((cur) => randomId(pool, cur));
    setAnswer("");
    setResponse(null);
  }, [pool]);

  const submit = useCallback(async () => {
    if (pending || !answer.trim() || !promptId) return;
    setPending(true);
    setResponse(null);
    try {
      // Grade the exact question the learner saw (the chosen variation), against its source note.
      setResponse(await gradeRecallAnswer(promptId, answer, shownQuestion));
    } catch {
      setResponse({ ok: false, code: "api", error: "Hodnocení selhalo (síť?). Zkus to znovu." });
    } finally {
      setPending(false);
    }
  }, [pending, answer, promptId, shownQuestion]);

  const poolPos = prompt ? pool.findIndex((p) => p.id === prompt.id) + 1 : 0;

  return (
    <div>
      {/* Area (category) filter — focus on chosen projects, skip the niche */}
      <AreaFilter areas={areas} enabled={enabled} onToggle={toggleArea} />

      {!prompt ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-3xl">🗂️</div>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">Zapni aspoň jednu oblast nahoře, ať je z čeho vybírat.</p>
        </div>
      ) : (
        <>
          {/* Provenance + cycle */}
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
            <span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {prompt.areaLabel}
              </span>{" "}
              <span className="font-mono">{prompt.sourceSlug}</span>
            </span>
            <span>
              {poolPos} / {pool.length}
            </span>
          </div>

          {/* Difficulty ladder — easy → hard, opening at the learner's calibrated rung */}
          <LadderBar ladder={ladder} level={level} loading={ladderLoading} note={ladderNote} onPick={pickLevel} />

          {/* The question */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
            <div className="text-lg font-semibold sm:text-xl">{shownQuestion}</div>

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
        </>
      )}

      <div className="mt-6 text-center">
        <Link href="/" className="text-sm text-zinc-500 underline hover:text-zinc-700">
          Back to overview
        </Link>
      </div>
    </div>
  );
}

/**
 * The category filter: one chip per area (project) with its prompt count. Active areas are filled;
 * inactive are muted. Niche areas (RL) start OFF, so the tutor focuses on what matters and the learner
 * opts the rest in. The choice persists per device.
 */
function AreaFilter({ areas, enabled, onToggle }: { areas: TutorArea[]; enabled: Set<string>; onToggle: (key: string) => void }) {
  if (areas.length <= 1) return null; // nothing to filter
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Oblasti</span>
        {areas.map((a) => {
          const on = enabled.has(a.key);
          return (
            <button
              key={a.key}
              onClick={() => onToggle(a.key)}
              aria-pressed={on}
              title={on ? `${a.label} — zapnuto (klik vypne)` : `${a.label} — vypnuto (klik zapne)`}
              className={[
                "rounded-full px-2.5 py-1 text-xs font-medium transition",
                on
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-100 text-zinc-400 line-through hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-700",
              ].join(" ")}
            >
              {a.label} <span className="tabular-nums opacity-70">{a.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The difficulty selector: four rungs from easy → hard. The learner's calibrated start rung is ringed
 * ("tvoje úroveň"), the selected one is filled. While the model generates (first visit), the original
 * question stays up and a subtle hint shows; if generation is unavailable, a soft note explains the
 * fallback. Each chip is clickable so the learner can warm up easier or push harder at will.
 */
function LadderBar({
  ladder,
  level,
  loading,
  note,
  onPick,
}: {
  ladder: VariationLadder | null;
  level: number;
  loading: boolean;
  note: string | null;
  onPick: (level: number) => void;
}) {
  if (!ladder) {
    // No ladder yet: show the generation hint (loading) or the fallback note (failed) — or nothing.
    const msg = loading ? "Připravuji obtížnostní varianty otázky…" : note;
    if (!msg) return <div className="mb-3" />;
    return (
      <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
        {loading && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500" />
        )}
        <span>{msg}</span>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Obtížnost</span>
        {ladder.variations.map((v) => {
          const selected = v.level === level;
          const isStart = v.level === ladder.startLevel;
          return (
            <button
              key={v.level}
              onClick={() => onPick(v.level)}
              title={`${v.level}. ${v.label} (${v.bloom})`}
              className={[
                "rounded-full px-2.5 py-1 text-xs font-medium transition",
                selected
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
                !selected && isStart ? "ring-2 ring-indigo-300 dark:ring-indigo-700" : "",
              ].join(" ")}
            >
              <span className="tabular-nums opacity-70">{v.level}.</span> {v.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-zinc-400">
        Start na úrovni <span className="font-semibold text-indigo-500">{ladder.startLevel}</span> podle tvé znalosti
        tématu — klidně si přidej, nebo začni lehčeji.
      </p>
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
