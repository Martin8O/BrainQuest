"use client";

// The flip-card review loop — the only client component in B3. It owns the session's UI state
// (which card, flipped?, how many done) and walks a queue of due cards. Grading calls the gradeCard
// server action, which persists the new schedule; "again" re-queues the card so you re-see it before
// the session ends (lightweight relearning). The pure FSRS schedule() runs here too — read-only — to
// preview what each button does to the interval, so the buttons teach as you press them.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { schedule } from "@/lib/srs/scheduler";
import { XP_PER_REVIEW } from "@/lib/gamification/engine";
import type { Grade } from "@/lib/srs/types";
import type { GamificationState } from "@/lib/gamification/types";
import { Hud } from "../components/Hud";
import { gradeCard, getGamification } from "./actions";
import type { SessionCard } from "./types";

/** The four grade buttons, left→hardest to right→easiest, with their keyboard shortcut. */
const GRADES: { grade: Grade; label: string; hint: string; cls: string }[] = [
  { grade: "again", label: "Again", hint: "1", cls: "bg-red-600 hover:bg-red-500" },
  { grade: "hard", label: "Hard", hint: "2", cls: "bg-amber-600 hover:bg-amber-500" },
  { grade: "good", label: "Good", hint: "3", cls: "bg-emerald-600 hover:bg-emerald-500" },
  { grade: "easy", label: "Easy", hint: "4", cls: "bg-sky-600 hover:bg-sky-500" },
];

/** Format a projected interval in whole days for a button hint. */
function intervalLabel(days: number): string {
  return days <= 0 ? "<1d" : days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

export default function SessionClient({
  initialQueue,
  levelBefore,
  xpBefore,
}: {
  initialQueue: SessionCard[];
  levelBefore: number;
  xpBefore: number;
}) {
  const [queue, setQueue] = useState<SessionCard[]>(initialQueue);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [pending, setPending] = useState(false);
  // Fresh gamification state, fetched once the session ends → drives the "unlock moment" celebration.
  const [gamification, setGamification] = useState<GamificationState | null>(null);

  const finished = index >= queue.length;
  const card = finished ? null : queue[index];

  // When the queue empties, pull the post-session XP/level/streak so the summary shows real numbers.
  // Swallow a failed fetch (e.g. a transient vault read error) — the generic complete screen still
  // renders with the fallback XP estimate rather than crashing on an unhandled rejection.
  useEffect(() => {
    if (finished && reviewed > 0 && gamification === null) {
      void getGamification()
        .then(setGamification)
        .catch(() => {});
    }
  }, [finished, reviewed, gamification]);

  const handleGrade = useCallback(
    async (grade: Grade) => {
      if (pending || !card) return;
      setPending(true);
      try {
        const newState = await gradeCard(card.id, grade);
        // "again" failed the card → put it back at the end so it returns this session, with its
        // freshly-lapsed state so the next interval preview is accurate.
        if (grade === "again") {
          setQueue((q) => [...q, { ...card, state: newState }]);
        }
        setReviewed((n) => n + 1);
        setIndex((i) => i + 1);
        setFlipped(false);
      } finally {
        setPending(false);
      }
    },
    [card, pending],
  );

  // Keyboard: Space/Enter reveals, then 1–4 grade. Cleanup on unmount/re-bind — the classic effect.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (finished) return;
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
  }, [flipped, finished, handleGrade]);

  if (finished) {
    // True XP gained = post-session total minus where you started (mastery bonus included). Until the
    // fresh state lands, fall back to the per-review estimate so the line still shows something.
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
              <h2 className="mt-4 text-2xl font-bold">⚡ Level up — {gamification!.level.title}!</h2>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                You reached level {gamification!.level.level}. New rank unlocked.
              </p>
            </div>
          ) : (
            <>
              <div className="text-4xl">🎉</div>
              <h2 className="mt-3 text-2xl font-bold">Session complete</h2>
            </>
          )}
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Reviewed {reviewed} {reviewed === 1 ? "card" : "cards"} · <span className="font-semibold text-emerald-700 dark:text-emerald-300">+{xpEarned} XP</span>
            {gamification?.streak.todayActive && gamification.streak.current > 0 && (
              <> · 🔥 {gamification.streak.current} day streak</>
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

  const remaining = queue.length - index;

  return (
    <div>
      {/* Progress */}
      <div className="mb-4">
        <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
          <span>
            {reviewed} reviewed · {remaining} left
          </span>
          <span className="font-mono">{card!.sourceSlug}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${(reviewed / (reviewed + remaining)) * 100}%` }}
          />
        </div>
      </div>

      {/* The card */}
      <div className="flex min-h-[16rem] flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
        <div className="flex-1">
          <div className="text-xl font-semibold sm:text-2xl">{card!.front}</div>
          {flipped && (
            <>
              <hr className="my-4 border-zinc-200 dark:border-zinc-800" />
              <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{card!.back}</p>
              {card!.conceptLink && (
                <span className="mt-4 inline-block rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  🔗 {card!.conceptLink}
                </span>
              )}
            </>
          )}
        </div>

        {/* Controls */}
        <div className="mt-6">
          {!flipped ? (
            <button
              onClick={() => setFlipped(true)}
              className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
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
      </div>
    </div>
  );
}
