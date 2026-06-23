// Tests for the gamification engine (C3) — XP, the level ladder, and streaks. All pure + clock-injected,
// so the motivation numbers a learner sees ("L3, 3🔥") are pinned to exact, reproducible values.
import { describe, expect, it } from "vitest";
import {
  computeGamification,
  computeStreak,
  computeXp,
  levelForXp,
  localDateKey,
  recentDays,
  totalReviews,
  xpToReachLevel,
} from "./engine";

// Local noon on 2026-06-23 — streaks are a local-day notion, so build the clock in local time explicitly.
const TODAY = new Date(2026, 5, 23, 12, 0, 0);

describe("the level ladder", () => {
  it("has the gentle-then-stretching floors 0, 100, 300, 600, 1000", () => {
    expect([1, 2, 3, 4, 5].map(xpToReachLevel)).toEqual([0, 100, 300, 600, 1000]);
  });

  it("levelForXp resolves a total to a level + bar fill", () => {
    expect(levelForXp(0)).toMatchObject({ level: 1, title: "Novice", progress: 0, isMax: false });
    expect(levelForXp(99)).toMatchObject({ level: 1, xpIntoLevel: 99, xpForLevel: 100 });
    expect(levelForXp(100)).toMatchObject({ level: 2, title: "Apprentice", xpIntoLevel: 0 });
    expect(levelForXp(150)).toMatchObject({ level: 2, xpIntoLevel: 50, xpForLevel: 200 });
    expect(levelForXp(150).progress).toBeCloseTo(0.25, 10);
  });

  it("clamps at the top rank, where the bar is full and there is no next floor", () => {
    const max = levelForXp(999_999);
    expect(max.title).toBe("Luminary");
    expect(max.isMax).toBe(true);
    expect(max.progress).toBe(1);
    expect(max.nextXp).toBe(Infinity);
  });
});

describe("XP formula", () => {
  it("is reviews·10 + mastered·100, in one place", () => {
    expect(computeXp(0, 0)).toBe(0);
    expect(computeXp(40, 3)).toBe(700);
  });
});

describe("computeStreak", () => {
  it("counts a run ending today as lit", () => {
    const s = computeStreak({ "2026-06-21": 4, "2026-06-22": 6, "2026-06-23": 2 }, TODAY);
    expect(s).toEqual({ current: 3, longest: 3, todayActive: true });
  });

  it("treats an idle-but-unbroken today as at-risk, not broken (measures from yesterday)", () => {
    const s = computeStreak({ "2026-06-20": 1, "2026-06-21": 4, "2026-06-22": 6 }, TODAY);
    expect(s).toMatchObject({ current: 3, todayActive: false });
  });

  it("is 0 when the most recent activity is before yesterday", () => {
    const s = computeStreak({ "2026-06-18": 5, "2026-06-19": 5 }, TODAY);
    expect(s).toMatchObject({ current: 0, longest: 2, todayActive: false });
  });

  it("is 0/0 on an empty log", () => {
    expect(computeStreak({}, TODAY)).toEqual({ current: 0, longest: 0, todayActive: false });
  });
});

describe("recentDays / totalReviews / localDateKey", () => {
  it("localDateKey formats the local calendar day", () => {
    expect(localDateKey(TODAY)).toBe("2026-06-23");
  });

  it("recentDays returns a 14-day window ending today, with today flagged", () => {
    const strip = recentDays({ "2026-06-23": 2 }, TODAY);
    expect(strip).toHaveLength(14);
    expect(strip[0].date).toBe("2026-06-10");
    expect(strip[13]).toEqual({ date: "2026-06-23", count: 2, isToday: true });
  });

  it("totalReviews sums the lifetime log", () => {
    expect(totalReviews({ a: 3, b: 2, c: 0 })).toBe(5);
  });
});

describe("computeGamification — the whole picture", () => {
  it("assembles XP, level, streak and today's count from the store + mastery count", () => {
    const g = computeGamification({ daily: { "2026-06-21": 4, "2026-06-22": 6, "2026-06-23": 2 } }, 2, TODAY);
    expect(g.totalReviews).toBe(12);
    expect(g.todayReviews).toBe(2);
    expect(g.masteredConcepts).toBe(2);
    expect(g.xp).toBe(12 * 10 + 2 * 100); // 320
    expect(g.level.level).toBe(3); // 320 → Adept
    expect(g.streak.current).toBe(3);
  });
});
