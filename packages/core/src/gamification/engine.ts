// Pure gamification math — NO file system, NO ambient clock (the reference day is always injected, so
// every function is deterministic and testable, same discipline as the B2 scheduler and C1 mastery).
// XP and level and streak are DERIVED from the review store's lifetime activity log + the mastered-
// concept count; nothing here is stored that we couldn't recompute. Safe to import on the client.
import type { ReviewStore } from "../srs/types";
import type { DayActivity, GamificationState, LevelInfo, StreakInfo } from "./types";

/** XP for grading one card — the steady drip that rewards just showing up. */
export const XP_PER_REVIEW = 10;
/** XP for pushing a concept to "mastered" (C1) — the big, rare reward that makes levels feel earned. */
export const XP_PER_MASTERED = 100;

/** How many trailing days the activity strip shows. */
export const ACTIVITY_WINDOW = 14;

/** Rank titles by level (index 0 = level 1). The last entry is the cap title. */
const TITLES = [
  "Novice",
  "Apprentice",
  "Adept",
  "Scholar",
  "Expert",
  "Sage",
  "Master",
  "Grandmaster",
  "Luminary",
] as const;

/**
 * Cumulative XP required to *reach* level `n` (n ≥ 1). Level 1 is free (0); each further level costs
 * 100·(n−1) more than the previous, so the floors are 0, 100, 300, 600, 1000, … — a gentle ramp that
 * gives quick early wins, then stretches out. Closed form: 50·(n−1)·n.
 */
export function xpToReachLevel(n: number): number {
  return 50 * (n - 1) * n;
}

/** Title for a level (1-based), clamped to the last rank at and beyond the cap. */
function titleForLevel(level: number): string {
  return TITLES[Math.min(level, TITLES.length) - 1];
}

/** The highest level the ladder defines (titles run out here → treat as the cap). */
const MAX_LEVEL = TITLES.length;

/** Resolve an XP total into a full LevelInfo (level, title, and bar fill toward the next level). */
export function levelForXp(xp: number): LevelInfo {
  // Walk up while the next floor is still affordable, stopping at the cap.
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpToReachLevel(level + 1)) level += 1;

  const floorXp = xpToReachLevel(level);
  const isMax = level >= MAX_LEVEL;
  const nextXp = isMax ? Infinity : xpToReachLevel(level + 1);
  const xpForLevel = isMax ? 0 : nextXp - floorXp;
  const xpIntoLevel = xp - floorXp;
  const progress = isMax ? 1 : xpForLevel === 0 ? 1 : xpIntoLevel / xpForLevel;

  return { level, title: titleForLevel(level), floorXp, nextXp, xpIntoLevel, xpForLevel, progress, isMax };
}

/** Total XP from lifetime activity + mastery. The single XP formula — one place, never forked. */
export function computeXp(totalReviews: number, masteredConcepts: number): number {
  return totalReviews * XP_PER_REVIEW + masteredConcepts * XP_PER_MASTERED;
}

/** Local calendar day key (YYYY-MM-DD) for a date. Streaks are a human/local-day notion, not UTC. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A new date `delta` local days from `d` (delta may be negative). Time-of-day is irrelevant to keys. */
function addDays(d: Date, delta: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + delta);
  return next;
}

/**
 * Streak from the daily log. `current` counts back from today while days are active; if today is still
 * idle the run is measured from yesterday instead, so an unfinished today doesn't read as a broken
 * streak (it's only at risk). `longest` is the longest active run anywhere in the log.
 */
export function computeStreak(daily: Record<string, number>, today: Date): StreakInfo {
  const active = (d: Date) => (daily[localDateKey(d)] ?? 0) > 0;
  const todayActive = active(today);

  let current = 0;
  let cursor = todayActive ? today : addDays(today, -1);
  while (active(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  // Longest: sort the active day-keys and scan for the longest consecutive run.
  const days = Object.keys(daily)
    .filter((k) => (daily[k] ?? 0) > 0)
    .sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of days) {
    run = prev !== null && localDateKey(addDays(new Date(`${prev}T00:00:00`), 1)) === k ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = k;
  }

  return { current, longest: Math.max(longest, current), todayActive };
}

/** Trailing `window` days of activity, oldest → newest, with today last and flagged. */
export function recentDays(daily: Record<string, number>, today: Date, window = ACTIVITY_WINDOW): DayActivity[] {
  const todayKey = localDateKey(today);
  const out: DayActivity[] = [];
  for (let i = window - 1; i >= 0; i--) {
    const key = localDateKey(addDays(today, -i));
    out.push({ date: key, count: daily[key] ?? 0, isToday: key === todayKey });
  }
  return out;
}

/** Sum the lifetime activity log → total reviews ever graded. */
export function totalReviews(daily: Record<string, number>): number {
  return Object.values(daily).reduce((a, b) => a + b, 0);
}

/**
 * The whole motivation picture from the persisted log + mastery count, as of `today`. Pure: same
 * inputs → same output. `store.daily` may be absent on a v1 file → treated as empty.
 */
export function computeGamification(store: Pick<ReviewStore, "daily">, masteredConcepts: number, today: Date): GamificationState {
  const daily = store.daily ?? {};
  const total = totalReviews(daily);
  const xp = computeXp(total, masteredConcepts);
  return {
    xp,
    level: levelForXp(xp),
    streak: computeStreak(daily, today),
    totalReviews: total,
    todayReviews: daily[localDateKey(today)] ?? 0,
    masteredConcepts,
    recentDays: recentDays(daily, today),
  };
}
