// Gamification contracts — the motivation layer's derived shapes. Like the mastery layer (C1), this
// COMPUTES, it never invents: XP/level/streak are pure functions of the review store's lifetime
// activity log (B2, v2) plus how many concepts are mastered (C1). The one shape the HUD + the
// session "unlock moment" both read, kept in one place so they can't drift.

/** One day's review activity — a single bar in the activity strip. */
export interface DayActivity {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** Reviews graded that day. */
  count: number;
  /** True for the day this state was computed (the "today" marker in the strip). */
  isToday: boolean;
}

/** Where the learner sits on the XP ladder — level number, flavour title, and progress to next. */
export interface LevelInfo {
  /** 1-based level. Level 1 starts at 0 XP. */
  level: number;
  /** Gamey rank name for this level (Novice → Apprentice → …). */
  title: string;
  /** Total XP needed to have reached this level. */
  floorXp: number;
  /** Total XP needed to reach the next level (Infinity at the cap). */
  nextXp: number;
  /** XP accumulated inside the current level (xp − floorXp). */
  xpIntoLevel: number;
  /** XP span of the current level (nextXp − floorXp); 0 at the cap. */
  xpForLevel: number;
  /** Fill of the level bar, 0..1 (1 at the cap). */
  progress: number;
  /** True when there is no higher level to reach. */
  isMax: boolean;
}

/** Streak standing — consecutive active days, derived from the daily log. */
export interface StreakInfo {
  /** Current run of consecutive active days ending today (or yesterday if today is still idle). */
  current: number;
  /** Longest such run ever recorded. */
  longest: number;
  /** Whether a review has already been logged today (the flame is "lit", not "at risk"). */
  todayActive: boolean;
}

/** Everything the HUD + session celebration render — all derived from the review store + mastery. */
export interface GamificationState {
  /** Total XP, from lifetime reviews + mastered concepts. */
  xp: number;
  level: LevelInfo;
  streak: StreakInfo;
  /** Lifetime reviews graded (sum of the daily log). */
  totalReviews: number;
  /** Reviews graded today. */
  todayReviews: number;
  /** Concepts at mastery level "mastered" (C1) — the XP heavyweight. */
  masteredConcepts: number;
  /** Most-recent-N days for the activity strip, oldest → newest, today last. */
  recentDays: DayActivity[];
}
