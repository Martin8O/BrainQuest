"use client";

// The flip-card review loop. It walks an ordered queue of due cards; revealing a card opens a "doorway to
// depth": the card's concept (fuller gloss + a jump into the skill tree), an on-demand AI "Explain more",
// a link to read the full source note, and a neighbourhood of related topics you can STEER toward — click
// one and the next card is about it (otherwise the next card follows the default foundation-first order).
// Grading calls gradeCard (persists the schedule); "again" re-queues the card. An AREA FILTER (same areas
// as the tutor) focuses the session; changing it restarts the walk. Choices persist per device.
import Link from "next/link";
import {
  PartyPopper,
  Zap,
  Flame,
  Link2,
  Network,
  Sparkles,
  FileText,
  GraduationCap,
  Compass,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { schedule } from "@/lib/srs/scheduler";
import { XP_PER_REVIEW } from "@/lib/gamification/engine";
import type { Grade } from "@/lib/srs/types";
import type { GamificationState } from "@/lib/gamification/types";
import { Hud } from "../components/Hud";
import { AreaFilter } from "../components/AreaFilter";
import { gradeCard, getGamification, explainTerm } from "./actions";
import type { SessionArea, SessionCard } from "./types";

/** The four grade buttons, left→hardest to right→easiest, with their keyboard shortcut. */
const GRADES: { grade: Grade; label: string; hint: string; cls: string }[] = [
  { grade: "again", label: "Again", hint: "1", cls: "bg-red-600 hover:bg-red-500" },
  { grade: "hard", label: "Hard", hint: "2", cls: "bg-amber-600 hover:bg-amber-500" },
  { grade: "good", label: "Good", hint: "3", cls: "bg-sky-600 hover:bg-sky-500" },
  { grade: "easy", label: "Easy", hint: "4", cls: "bg-emerald-600 hover:bg-emerald-500" },
];

const AREAS_KEY = "bq.session.areas";
// Where we are in the session, stashed so leaving to read a note / practice in the tutor and coming back
// resumes the SAME card (revealed), instead of dropping you on card 1. Per-tab (sessionStorage), one-shot.
const RESUME_KEY = "bq.session.resume";

type Explain = { loading: boolean; text: string | null; error: string | null };
const NO_EXPLAIN: Explain = { loading: false, text: null, error: null };

function intervalLabel(days: number): string {
  return days <= 0 ? "<1d" : days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

export default function SessionClient({
  initialQueue,
  areas,
  levelBefore,
  xpBefore,
}: {
  initialQueue: SessionCard[];
  areas: SessionArea[];
  levelBefore: number;
  xpBefore: number;
}) {
  const filterWalk = useCallback(
    (en: Set<string>) => initialQueue.filter((c) => en.has(c.areaKey)),
    [initialQueue],
  );

  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(areas.filter((a) => a.defaultOn).map((a) => a.key)));
  // The ordered list we walk. Mutable so "again" can re-queue and a chosen direction can jump a card forward.
  const [walk, setWalk] = useState<SessionCard[]>(() =>
    initialQueue.filter((c) => areas.some((a) => a.defaultOn && a.key === c.areaKey)),
  );
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [pending, setPending] = useState(false);
  const [direction, setDirection] = useState<string | null>(null); // chosen "up next" concept, or null
  const [explain, setExplain] = useState<Explain>(NO_EXPLAIN);
  const [gamification, setGamification] = useState<GamificationState | null>(null);

  const poolEmpty = walk.length === 0;
  const finished = !poolEmpty && pos >= walk.length;
  const card = poolEmpty || finished ? null : walk[pos];
  const remaining = walk.length - pos;

  /** Restart the walk on a (new) area selection. */
  const applyAreas = useCallback(
    (next: Set<string>) => {
      setEnabled(next);
      setWalk(filterWalk(next));
      setPos(0);
      setReviewed(0);
      setFlipped(false);
      setDirection(null);
      setExplain(NO_EXPLAIN);
      setGamification(null);
    },
    [filterWalk],
  );

  // Once on mount: restore the saved area filter, then (if returning from a note/tutor side-trip) resume the
  // same card — position, count, and revealed state — so navigation doesn't bounce you back to card 1.
  // Guarded by a ref because the resume is a one-shot key: React Strict Mode runs mount effects twice in
  // dev, and the second run would otherwise find the key already consumed and reset the revealed state.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    let en = new Set(areas.filter((a) => a.defaultOn).map((a) => a.key));
    try {
      const raw = localStorage.getItem(AREAS_KEY);
      if (raw) en = new Set((JSON.parse(raw) as string[]).filter((k) => areas.some((a) => a.key === k)));
    } catch {
      // ignore malformed/blocked storage — defaults apply
    }
    const nextWalk = filterWalk(en);

    let p = 0;
    let rev = 0;
    let fl = false;
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (raw) {
        const { cardId, reviewed, flipped } = JSON.parse(raw) as { cardId: string; reviewed: number; flipped: boolean };
        const idx = nextWalk.findIndex((c) => c.id === cardId);
        if (idx >= 0) {
          p = idx;
          rev = reviewed ?? 0;
          fl = !!flipped;
        }
        sessionStorage.removeItem(RESUME_KEY); // one-shot
      }
    } catch {
      // ignore
    }

    setEnabled(en);
    setWalk(nextWalk);
    setPos(p);
    setReviewed(rev);
    setFlipped(fl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  /** Stash where we are before leaving to a note/tutor, so coming back resumes this exact card. */
  const stashResume = useCallback(() => {
    if (!card) return;
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ cardId: card.id, reviewed, flipped }));
    } catch {
      // best-effort
    }
  }, [card, reviewed, flipped]);

  const toggleArea = useCallback(
    (key: string) => {
      const next = new Set(enabled);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(AREAS_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort
      }
      applyAreas(next);
    },
    [enabled, applyAreas],
  );

  // Pull post-session XP/level/streak once the queue empties → the celebration shows real numbers.
  useEffect(() => {
    if (finished && reviewed > 0 && gamification === null) {
      void getGamification().then(setGamification).catch(() => {});
    }
  }, [finished, reviewed, gamification]);

  const handleGrade = useCallback(
    async (grade: Grade) => {
      if (pending || !card) return;
      setPending(true);
      try {
        const newState = await gradeCard(card.id, grade);
        setWalk((prev) => {
          const nextWalk = [...prev];
          // "again" → re-queue at the end with its freshly-lapsed state.
          if (grade === "again") nextWalk.push({ ...card, state: newState });
          // Steer: if a direction was chosen, jump a matching card to be next.
          if (direction) {
            const j = nextWalk.findIndex(
              (c, i) => i > pos && c.concept?.title.toLowerCase() === direction.toLowerCase(),
            );
            if (j > pos + 1) {
              const [picked] = nextWalk.splice(j, 1);
              nextWalk.splice(pos + 1, 0, picked);
            }
          }
          return nextWalk;
        });
        setDirection(null);
        setReviewed((n) => n + 1);
        setPos((p) => p + 1);
        setFlipped(false);
        setExplain(NO_EXPLAIN);
      } finally {
        setPending(false);
      }
    },
    [card, pending, direction, pos],
  );

  const handleExplain = useCallback(async () => {
    if (!card || explain.loading) return;
    setExplain({ loading: true, text: null, error: null });
    const res = await explainTerm(card.id);
    setExplain(res.ok ? { loading: false, text: res.text, error: null } : { loading: false, text: null, error: res.error });
  }, [card, explain.loading]);

  // Keyboard: Space/Enter reveals, then 1–4 grade.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!card) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!flipped && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setFlipped(true);
      } else if (flipped) {
        const g = GRADES.find((x) => x.hint === e.key);
        if (g) {
          e.preventDefault();
          void handleGrade(g.grade);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, card, handleGrade]);

  return (
    <div>
      <AreaFilter areas={areas} enabled={enabled} onToggle={toggleArea} />

      {poolEmpty ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-3xl">🗂️</div>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">Turn on at least one area above to review.</p>
        </div>
      ) : finished ? (
        <FinishedScreen reviewed={reviewed} gamification={gamification} levelBefore={levelBefore} xpBefore={xpBefore} />
      ) : (
        <>
          {/* Meta: area · source note (→ reader) · progress count */}
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {card!.areaLabel}
              </span>
              <Link
                href={`/note/${encodeURIComponent(card!.sourceSlug)}`}
                onClick={stashResume}
                className="truncate text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200"
                title={`Read the full note: ${card!.sourceTitle}`}
              >
                {card!.sourceTitle}
              </Link>
            </div>
            <span className="shrink-0 text-zinc-500">
              {reviewed} done · {remaining} left
            </span>
          </div>
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${(reviewed / (reviewed + remaining)) * 100}%` }}
            />
          </div>

          {/* The card */}
          <div className="flex min-h-[16rem] flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
            <div className="flex-1">
              <div className="text-xl font-semibold sm:text-2xl">{card!.front}</div>

              {flipped && (
                <div className="reveal-in">
                  <hr className="my-4 border-zinc-200 dark:border-zinc-800" />
                  <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{card!.back}</p>

                  <ConceptBlock
                    concept={card!.concept}
                    front={card!.front}
                    explain={explain}
                    onExplain={handleExplain}
                  />

                  {card!.related.length > 0 && (
                    <NextChips related={card!.related} direction={direction} onPick={setDirection} />
                  )}
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="mt-6">
              {!flipped ? (
                <button
                  onClick={() => setFlipped(true)}
                  className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Reveal answer <span className="opacity-60">(Space)</span>
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {GRADES.map((g) => {
                    const next = schedule(card!.state, g.grade, new Date());
                    return (
                      <button
                        key={g.grade}
                        onClick={() => void handleGrade(g.grade)}
                        disabled={pending}
                        className={`flex flex-col items-center rounded-xl py-3 text-sm font-medium text-white transition disabled:opacity-50 ${g.cls}`}
                      >
                        <span>
                          {g.label} <span className="opacity-60">({g.hint})</span>
                        </span>
                        <span className="mt-0.5 text-xs opacity-80">{intervalLabel(next.intervalDays)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer doorways — highlighted + centered once revealed */}
            {flipped && (
              <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <Link
                  href={`/note/${encodeURIComponent(card!.sourceSlug)}`}
                  onClick={stashResume}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
                >
                  <FileText className="h-4 w-4" /> Read the full note
                </Link>
                <Link
                  href={`/tutor?from=session&source=${encodeURIComponent(card!.sourceSlug)}`}
                  onClick={stashResume}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
                >
                  <GraduationCap className="h-4 w-4" /> Practice in the tutor
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The "go deeper" block under a revealed card. Both actions work for EVERY card: "Explain more" asks the
 * LLM about the card's term (grounded in its source note — no concept needed), and "Skill tree" jumps to
 * the card's concept node, or — when the card has no `→ [[concept]]` link — to the term itself (often a
 * node too; an unknown focus just opens the map un-targeted). The concept title + gloss only show when linked.
 */
function ConceptBlock({
  concept,
  front,
  explain,
  onExplain,
}: {
  concept: { title: string; gloss: string | null } | null;
  front: string;
  explain: Explain;
  onExplain: () => void;
}) {
  const focus = concept?.title ?? front;
  return (
    <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {concept ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
            <Link2 className="h-4 w-4" /> {concept.title}
          </span>
        ) : (
          <span className="text-xs font-medium uppercase tracking-wide text-indigo-400 dark:text-indigo-500">
            Go deeper
          </span>
        )}
        <div className="flex items-center gap-2 text-xs">
          <Link
            href={`/map?focus=${encodeURIComponent(focus)}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1.5 font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-200 dark:bg-indigo-900/60 dark:text-indigo-200 dark:hover:bg-indigo-900"
          >
            <Network className="h-4 w-4 text-indigo-500 dark:text-indigo-400" /> Skill tree
          </Link>
          <button
            onClick={onExplain}
            disabled={explain.loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-700 shadow-sm transition hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/50 dark:text-amber-200 dark:hover:bg-amber-900"
          >
            {explain.loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-amber-500 dark:text-amber-400" />
            ) : (
              <Sparkles className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            )}
            Explain more
          </button>
        </div>
      </div>
      {concept?.gloss && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{concept.gloss}</p>}
      {explain.text && (
        <p className="mt-3 whitespace-pre-line border-t border-indigo-200/70 pt-3 text-sm text-zinc-700 dark:border-indigo-900 dark:text-zinc-300">
          {explain.text}
        </p>
      )}
      {explain.error && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{explain.error}</p>}
    </div>
  );
}

/** "Up next" — related concepts that also have a due card; pick one to steer the next card toward it. */
function NextChips({
  related,
  direction,
  onPick,
}: {
  related: string[];
  direction: string | null;
  onPick: (d: string | null) => void;
}) {
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
        <Compass className="h-3.5 w-3.5" /> Up next
      </div>
      <div className="flex flex-wrap gap-1.5">
        {related.map((r) => {
          const on = direction?.toLowerCase() === r.toLowerCase();
          return (
            <button
              key={r}
              onClick={() => onPick(on ? null : r)}
              aria-pressed={on}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                on
                  ? "bg-violet-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {r}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-zinc-400">
        {direction ? `Next card will be about “${direction}”.` : "Pick a direction, or just grade for the default order."}
      </p>
    </div>
  );
}

/** The end-of-session celebration: a level-up moment if you crossed a rank, else a tidy summary. */
function FinishedScreen({
  reviewed,
  gamification,
  levelBefore,
  xpBefore,
}: {
  reviewed: number;
  gamification: GamificationState | null;
  levelBefore: number;
  xpBefore: number;
}) {
  const xpEarned = gamification != null ? Math.max(0, gamification.xp - xpBefore) : reviewed * XP_PER_REVIEW;
  const leveledUp = gamification != null && gamification.level.level > levelBefore;
  return (
    <div>
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-900 dark:bg-emerald-950">
        {leveledUp ? (
          <div className="unlock-pop">
            <div className="halo mx-auto grid h-16 w-16 place-items-center rounded-2xl text-2xl level-gem text-white">
              {gamification!.level.level}
            </div>
            <h2 className="mt-4 flex items-center justify-center gap-2 text-2xl font-bold">
              <Zap className="h-6 w-6 fill-amber-400 text-amber-500" /> Level up — {gamification!.level.title}!
            </h2>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              You reached level {gamification!.level.level}. New rank unlocked.
            </p>
          </div>
        ) : (
          <>
            <PartyPopper className="mx-auto h-12 w-12 text-emerald-500" strokeWidth={1.75} />
            <h2 className="mt-3 text-2xl font-bold">Session complete</h2>
          </>
        )}
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Reviewed {reviewed} {reviewed === 1 ? "card" : "cards"} ·{" "}
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">+{xpEarned} XP</span>
          {gamification?.streak.todayActive && gamification.streak.current > 0 && (
            <span className="inline-flex items-center gap-1">
              {" "}· <Flame className="h-4 w-4 fill-amber-400 text-amber-500" /> {gamification.streak.current} day streak
            </span>
          )}
        </p>
      </div>

      {gamification && <Hud g={gamification} className="mt-4" />}

      <div className="mt-5 text-center">
        <Link
          href="/session"
          className="inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Check for more due
        </Link>
        <Link href="/" className="ml-3 inline-block text-sm text-zinc-500 underline hover:text-zinc-700">
          Back to overview
        </Link>
      </div>
    </div>
  );
}
