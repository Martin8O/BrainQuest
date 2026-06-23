// Unit tests for the SM-2 scheduler — the risky logic E2 names first. Every case pins exact numbers,
// because the four grade buttons MUST mean something on every review (the grade-aware change from C3),
// and a scheduler that silently drifts is the kind of bug spaced repetition hides for weeks.
import { describe, expect, it } from "vitest";
import { ensureStates, isDue, newReviewState, schedule, selectDue } from "./scheduler";
import { emptyStore } from "./store";
import type { ReviewState } from "./types";

const NOW = new Date("2026-06-22T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const dueAfter = (days: number) => new Date(NOW.getTime() + days * DAY_MS).toISOString();

describe("newReviewState", () => {
  it("creates a fresh, immediately-due card", () => {
    const s = newReviewState("card#0", NOW);
    expect(s).toEqual({
      cardId: "card#0",
      reps: 0,
      lapses: 0,
      intervalDays: 0,
      ease: 2.5,
      due: NOW.toISOString(),
      lastReviewedAt: null,
      lastGrade: null,
    });
  });
});

describe("schedule — a brand-new card graduates on the per-grade ramp", () => {
  const fresh = () => newReviewState("c", NOW);

  it("hard graduates to 1 day", () => {
    const s = schedule(fresh(), "hard", NOW);
    expect(s.intervalDays).toBe(1);
    expect(s.reps).toBe(1);
    expect(s.due).toBe(dueAfter(1));
    expect(s.ease).toBeCloseTo(2.36, 10);
  });

  it("good graduates to 3 days and leaves ease unchanged", () => {
    const s = schedule(fresh(), "good", NOW);
    expect(s.intervalDays).toBe(3);
    expect(s.due).toBe(dueAfter(3));
    expect(s.ease).toBeCloseTo(2.5, 10);
  });

  it("easy graduates to 7 days and bumps ease up", () => {
    const s = schedule(fresh(), "easy", NOW);
    expect(s.intervalDays).toBe(7);
    expect(s.due).toBe(dueAfter(7));
    expect(s.ease).toBeCloseTo(2.6, 10);
  });

  it("the three passing grades give three DIFFERENT intervals on a new card (the C3 fix)", () => {
    const intervals = (["hard", "good", "easy"] as const).map((g) => schedule(fresh(), g, NOW).intervalDays);
    expect(new Set(intervals).size).toBe(3);
  });
});

describe("schedule — an established card grows by a grade-specific factor", () => {
  // reps 1, interval 3d, ease 2.5 — i.e. a card that already graduated on "good".
  const established: ReviewState = { ...newReviewState("c", NOW), reps: 1, intervalDays: 3, ease: 2.5 };

  it("good multiplies the interval by ease", () => {
    const s = schedule(established, "good", NOW); // round(3 * 2.5) = 8
    expect(s.intervalDays).toBe(8);
    expect(s.reps).toBe(2);
  });

  it("hard grows slowly but always advances at least one day", () => {
    const s = schedule(established, "hard", NOW); // max(3+1, round(3*1.2)=4) = 4
    expect(s.intervalDays).toBe(4);
  });

  it("easy multiplies by ease with a bonus", () => {
    const s = schedule(established, "easy", NOW); // ease→2.6, round(3 * 2.6 * 1.3) = 10
    expect(s.intervalDays).toBe(10);
  });
});

describe("schedule — a lapse ('again') restarts the card", () => {
  const mature: ReviewState = { ...newReviewState("c", NOW), reps: 3, intervalDays: 20, ease: 2.5, lapses: 0 };

  it("resets reps + interval, counts the lapse, re-shows the same day, and lowers ease", () => {
    const s = schedule(mature, "again", NOW);
    expect(s.reps).toBe(0);
    expect(s.intervalDays).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.due).toBe(NOW.toISOString()); // due again right now
    expect(s.ease).toBeCloseTo(1.96, 10);
    expect(s.lastGrade).toBe("again");
  });

  it("never drives ease below the 1.3 floor, even after repeated failures", () => {
    let s: ReviewState = { ...newReviewState("c", NOW), ease: 1.3 };
    for (let i = 0; i < 5; i++) s = schedule(s, "again", NOW);
    expect(s.ease).toBeGreaterThanOrEqual(1.3);
  });

  it("is pure — it never mutates the input state", () => {
    const before: ReviewState = { ...newReviewState("c", NOW), reps: 1, intervalDays: 3 };
    const snapshot = structuredClone(before);
    schedule(before, "good", NOW);
    expect(before).toEqual(snapshot);
  });
});

describe("isDue / ensureStates / selectDue — the daily queue", () => {
  it("isDue is true at or before the due moment, false after", () => {
    const s = { ...newReviewState("c", NOW), due: dueAfter(2) };
    expect(isDue(s, NOW)).toBe(false);
    expect(isDue(s, new Date(NOW.getTime() + 2 * DAY_MS))).toBe(true); // exactly due
    expect(isDue(s, new Date(NOW.getTime() + 3 * DAY_MS))).toBe(true);
  });

  it("ensureStates keeps known cards and synthesizes fresh state for unseen ones", () => {
    const store = emptyStore();
    store.reviews["seen"] = { ...newReviewState("seen", NOW), reps: 2, intervalDays: 8 };
    const states = ensureStates(store, ["seen", "unseen"], NOW);
    expect(states.map((s) => s.cardId)).toEqual(["seen", "unseen"]);
    expect(states[0].reps).toBe(2);
    expect(states[1].reps).toBe(0); // unseen → brand new
  });

  it("selectDue returns only due cards, soonest-due first", () => {
    const past = { ...newReviewState("past", NOW), due: dueAfter(-2) };
    const today = { ...newReviewState("today", NOW), due: NOW.toISOString() };
    const future = { ...newReviewState("future", NOW), due: dueAfter(5) };
    const due = selectDue([future, past, today], NOW);
    expect(due.map((s) => s.cardId)).toEqual(["past", "today"]); // future excluded, sorted asc
  });
});

describe("determinism", () => {
  it("same inputs always produce the same output (explicit clock, no Date.now inside)", () => {
    const a = schedule(newReviewState("c", NOW), "good", NOW);
    const b = schedule(newReviewState("c", NOW), "good", NOW);
    expect(a).toEqual(b);
  });
});
