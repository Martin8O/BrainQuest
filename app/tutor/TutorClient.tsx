"use client";

// The tutor loop. It owns the UI state (which area filter, which prompt, the difficulty ladder + chosen
// rung, the typed answer, the returned grade) and calls the CLIENT tutor (lib/tutorClient): getVariations
// (D2 — a fresh, fixed ladder of rephrasings calibrated to the learner's mastery) and gradeRecallAnswer
// (D1 — grades the answer against the source note text from the pack). Both run in the browser against the
// user's chosen backend; the tutor is off by default (a banner links to Settings). The AREA FILTER lets
// the learner focus on chosen projects and skip the niche (RL is off by default); the choice persists in
// localStorage. The original question shows instantly; the variations swap in when generation finishes and
// are cached in IndexedDB so the second visit is instant. Picking the next prompt uses Math.random() inside
// a click handler only (never during render) — UI variety, no reproducibility concern, no hydration mismatch.
import Link from "next/link";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { computeProgress } from "@brainquest/core/progress/mastery";
import { AreaFilter } from "../components/AreaFilter";
import { useBrain } from "../lib/BrainProvider";
import { getVariationsClient, gradeRecallAnswerClient, loadTutorConfig } from "../lib/tutorClient";
import type { GradeResponse, GradeResult, Variation, VariationLadder, Verdict } from "@brainquest/core/tutor/types";
import type { TutorArea, TutorPrompt } from "./types";

/** Per-verdict styling — the headline badge + score colour. */
const VERDICT: Record<Verdict, { label: string; badge: string; bar: string }> = {
  correct: { label: "Correct", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", bar: "bg-emerald-500" },
  partial: { label: "Almost", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200", bar: "bg-amber-500" },
  incorrect: { label: "Not yet", badge: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200", bar: "bg-rose-500" },
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

export default function TutorClient({
  prompts,
  areas,
  fromSession = false,
  initialPromptId,
}: {
  prompts: TutorPrompt[];
  areas: TutorArea[];
  fromSession?: boolean;
  /** When set (forwarded from a session card), open on this prompt and force its area on. */
  initialPromptId?: string;
}) {
  const { snapshot, store, noteBody } = useBrain();
  // Whether the AI tutor is switched on (device setting, default OFF). Read once — a banner nudges to Settings.
  const [tutorOn] = useState(() => loadTutorConfig().enabled);

  // A prompt's source-note text (from the pack) + the learner's C1 mastery of that note's cluster — the two
  // inputs the client tutor needs: grounding text for grading, and the calibrated start difficulty.
  const notePathBySlug = useMemo(() => new Map((snapshot?.learning ?? []).map((n) => [n.slug, n.path])), [snapshot]);
  const strengthBySlug = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    const clusters = computeProgress(snapshot.harvest, snapshot.learning, store).clusters;
    return new Map(clusters.map((c) => [c.slug, c.avgStrength]));
  }, [snapshot, store]);
  const noteTextFor = useCallback(
    (slug: string) => {
      const p = notePathBySlug.get(slug);
      return p ? noteBody(p) ?? "" : "";
    },
    [notePathBySlug, noteBody],
  );

  // Which areas (projects) are active. Init from each area's default (RL off) — deterministic, so the
  // server render and first client render match; a saved preference is applied in an effect after mount.
  // A forwarded card's area is forced on so its prompt is reachable even if that area is off by default.
  const [enabled, setEnabled] = useState<Set<string>>(() => {
    const on = new Set(areas.filter((a) => a.defaultOn).map((a) => a.key));
    const fwdArea = initialPromptId ? prompts.find((p) => p.id === initialPromptId)?.areaKey : undefined;
    if (fwdArea) on.add(fwdArea);
    return on;
  });

  const pool = useMemo(() => prompts.filter((p) => enabled.has(p.areaKey)), [prompts, enabled]);

  const [currentId, setCurrentId] = useState<string>(() => {
    if (initialPromptId) return initialPromptId; // opened on the card's topic
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

  // Data we hold is for THIS prompt (not a stale one) AND we actually have data. The `!= null` guard is
  // load-bearing: with an empty pool `promptId` is undefined, and `ladderData?.promptId` is also undefined
  // when nothing loaded yet — so a bare `===` would spuriously read true and the `ladderData!` below would
  // dereference null. Requiring `ladderData != null` keeps `ready` false until a ladder genuinely lands.
  const ready = ladderData != null && ladderData.promptId === promptId;
  const ladder = ready ? ladderData!.ladder : null;
  const ladderNote = ready ? ladderData!.note : null;
  const ladderLoading = !!promptId && !ready; // until the current prompt's ladder lands, we're (re)generating

  // Apply a saved area preference once on mount (per-device). Init above is the deterministic default, so
  // the first paint matches the server; this only adjusts afterwards → no hydration mismatch. Skipped when
  // forwarded from a card: that visit is a focused "practice this topic", so we keep its prompt + area.
  useEffect(() => {
    if (initialPromptId) return;
    try {
      const raw = localStorage.getItem(AREAS_KEY);
      if (!raw) return;
      const keys = (JSON.parse(raw) as string[]).filter((k) => areas.some((a) => a.key === k));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of a UI pref from localStorage
      setEnabled(new Set(keys));
    } catch {
      // ignore a malformed/blocked localStorage — defaults already apply
    }
  }, [areas, initialPromptId]);

  // Fetch (or reuse the server cache of) the ladder whenever the prompt changes. The cancelled flag drops
  // a slow generation for a prompt the learner has already skipped past (stale-response race). No
  // synchronous setState here — the resets are derived from the id comparison instead.
  useEffect(() => {
    if (!promptId) return;
    const p = prompts.find((x) => x.id === promptId);
    if (!p) return;
    let cancelled = false;
    void getVariationsClient(
      {
        promptId,
        question: p.question,
        noteText: noteTextFor(p.sourceSlug),
        strength: strengthBySlug.get(p.sourceSlug) ?? 0,
      },
      loadTutorConfig(),
    ).then((res) => {
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
  }, [promptId, prompts, noteTextFor, strengthBySlug]);

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
    if (pending || !answer.trim() || !promptId || !prompt) return;
    setPending(true);
    setResponse(null);
    try {
      // Grade the exact question the learner saw (the chosen variation), against its source note text.
      setResponse(
        await gradeRecallAnswerClient(
          { question: shownQuestion, noteText: noteTextFor(prompt.sourceSlug), answer },
          loadTutorConfig(),
        ),
      );
    } catch {
      setResponse({ ok: false, code: "api", error: "Grading failed. Try again." });
    } finally {
      setPending(false);
    }
  }, [pending, answer, promptId, prompt, shownQuestion, noteTextFor]);

  const poolPos = prompt ? pool.findIndex((p) => p.id === prompt.id) + 1 : 0;

  return (
    <div>
      {!tutorOn && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-300/70 bg-amber-50/80 p-3 text-sm text-amber-900 backdrop-blur dark:border-amber-500/30 dark:bg-amber-950/50 dark:text-amber-200">
          <GraduationCap className="h-4 w-4 shrink-0" />
          The AI tutor is off. You can still browse questions;
          <Link href="/settings" className="font-semibold underline">
            enable it in Settings
          </Link>
          to grade answers and generate variations.
        </div>
      )}

      {/* Area (category) filter — focus on chosen projects, skip the niche */}
      <AreaFilter areas={areas} enabled={enabled} onToggle={toggleArea} />

      {!prompt ? (
        <div className="bq-card rounded-2xl p-8 text-center">
          <div className="text-3xl">🗂️</div>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">Turn on at least one area above to get questions.</p>
        </div>
      ) : (
        <>
          {/* Provenance + cycle */}
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
            <span>
              <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 font-medium text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-300">
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
          <div className="bq-card bq-topline relative overflow-hidden rounded-3xl p-6 sm:p-8">
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
              placeholder="Answer in your own words…"
              className="mt-4 w-full resize-y rounded-xl border border-zinc-300/80 bg-white/80 p-3 text-sm shadow-inner outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-950/60 dark:focus:border-indigo-400/60 dark:focus:ring-indigo-400/25"
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => void submit()}
                disabled={pending || !answer.trim()}
                className="btn-primary rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {pending ? "Grading…" : "Grade answer"}
                {!pending && <span className="ml-1 opacity-70">(⌘/Ctrl+↵)</span>}
              </button>
              <button
                onClick={nextPrompt}
                disabled={pending}
                className="text-sm text-zinc-500 underline underline-offset-4 transition hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
              >
                Next question →
              </button>
            </div>
          </div>

          {/* The grade */}
          {response && !response.ok && (
            <div className="mt-5 rounded-xl border border-amber-300/70 bg-amber-50/80 p-4 text-sm text-amber-900 backdrop-blur dark:border-amber-500/30 dark:bg-amber-950/50 dark:text-amber-200">
              {response.error}
            </div>
          )}

          {response && response.ok && <GradeCard result={response.result} />}
        </>
      )}

      {fromSession && (
        <div className="mt-6 text-center">
          <Link
            href="/session"
            className="btn-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold"
          >
            <ArrowLeft className="h-4 w-4" /> Back to session
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * The difficulty selector: four rungs from easy → hard. The learner's calibrated start rung is ringed
 * (their level), the selected one is filled. While the model generates (first visit), the original
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
    const msg = loading ? "Generating difficulty variations…" : note;
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
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Difficulty</span>
        {ladder.variations.map((v) => {
          const selected = v.level === level;
          const isStart = v.level === ladder.startLevel;
          return (
            <button
              key={v.level}
              onClick={() => onPick(v.level)}
              title={v.label.toLowerCase() === v.bloom ? `${v.level}. ${v.label}` : `${v.level}. ${v.label} (${v.bloom})`}
              className={[
                "rounded-full px-2.5 py-1 text-xs font-medium transition duration-200",
                selected
                  ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm shadow-indigo-500/30"
                  : "bg-zinc-900/5 text-zinc-600 hover:bg-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10",
                !selected && isStart ? "ring-2 ring-indigo-400/50 dark:ring-indigo-400/40" : "",
              ].join(" ")}
            >
              <span className="tabular-nums opacity-70">{v.level}.</span> {v.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-zinc-400">
        Starting at level <span className="font-semibold text-indigo-500">{ladder.startLevel}</span> based on your mastery
        of this topic — push harder, or warm up easier.
      </p>
    </div>
  );
}

function GradeCard({ result }: { result: GradeResult }) {
  const v = VERDICT[result.verdict];
  return (
    <div className="bq-card reveal-in mt-5 rounded-2xl p-6">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold shadow-sm ${v.badge}`}>{v.label}</span>
        <span className="text-sm font-medium tabular-nums text-zinc-500">{result.score} / 100</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900/10 shadow-inner dark:bg-white/10">
        <div className={`h-full rounded-full ${v.bar} transition-all duration-700`} style={{ width: `${result.score}%` }} />
      </div>

      {result.summary && <p className="mt-4 text-zinc-700 dark:text-zinc-300">{result.summary}</p>}

      {result.gotRight.length > 0 && (
        <Section title="What you got right" rows={result.gotRight} mark="✓" markClass="text-emerald-600 dark:text-emerald-400" />
      )}
      {result.missed.length > 0 && (
        <Section title="What you missed" rows={result.missed} mark="✗" markClass="text-rose-600 dark:text-rose-400" />
      )}

      {result.modelAnswer && (
        <div className="mt-5 rounded-xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/80 to-violet-50/60 p-4 dark:border-indigo-500/25 dark:from-indigo-950/40 dark:to-violet-950/30">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            Model answer
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
