// The game HUD — Level + XP bar + Streak + a 14-day activity strip. Pure presentation: it takes a
// computed GamificationState (lib/gamification) and renders it, no data access of its own, so it works
// as a server component on the home page and is reused verbatim in the session "unlock" celebration.
import { Flame } from "lucide-react";
import type { GamificationState } from "@/lib/gamification/types";

/** A capped intensity 0..1 for an activity-strip bar, so one huge day doesn't flatten the rest. */
function intensity(count: number): number {
  return count <= 0 ? 0 : Math.min(1, 0.25 + count / 20);
}

export function Hud({ g, className = "" }: { g: GamificationState; className?: string }) {
  return (
    <div
      className={`flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white/70 p-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <LevelBlock g={g} />
      <StreakBlock g={g} />
    </div>
  );
}

function LevelBlock({ g }: { g: GamificationState }) {
  const { level } = g;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      <div className="level-gem grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-bold text-white">
        {level.level}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">
            {level.title}
            <span className="ml-1.5 text-xs font-normal text-zinc-400">Lvl {level.level}</span>
          </span>
          <span className="shrink-0 font-mono text-xs text-zinc-500">
            {level.isMax ? `${g.xp} XP · MAX` : `${level.xpIntoLevel} / ${level.xpForLevel} XP`}
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="xp-fill h-full rounded-full" style={{ width: `${Math.round(level.progress * 100)}%` }} />
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {g.totalReviews} reviews · {g.masteredConcepts} mastered
        </div>
      </div>
    </div>
  );
}

function StreakBlock({ g }: { g: GamificationState }) {
  const { streak } = g;
  return (
    <div className="flex shrink-0 items-center gap-4">
      <div className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Flame
            className={`h-6 w-6 ${streak.current > 0 && streak.todayActive ? "flame-lit fill-amber-400 text-amber-500" : "flame-cold text-zinc-400"}`}
            strokeWidth={2}
          />
          <span className="text-2xl font-bold tabular-nums">{streak.current}</span>
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {streak.current === 0
            ? "Start a streak"
            : streak.todayActive
              ? `day streak · best ${streak.longest}`
              : "review today to keep it"}
        </div>
      </div>
      <ActivityStrip g={g} />
    </div>
  );
}

function ActivityStrip({ g }: { g: GamificationState }) {
  return (
    <div className="flex items-end gap-[3px]" title="Last 14 days">
      {g.recentDays.map((d) => {
        const h = 6 + Math.round(intensity(d.count) * 22); // 6..28px
        return (
          <div
            key={d.date}
            className={`w-[6px] rounded-sm ${
              d.count > 0 ? "bg-violet-500" : "bg-zinc-200 dark:bg-zinc-800"
            } ${d.isToday ? "ring-1 ring-fuchsia-400" : ""}`}
            style={{ height: `${d.count > 0 ? h : 6}px` }}
            title={`${d.date}: ${d.count} review${d.count === 1 ? "" : "s"}`}
          />
        );
      })}
    </div>
  );
}
