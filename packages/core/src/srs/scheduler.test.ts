// Unit tests for the FSRS scheduler state machine (F1) — the thin layer that turns "state + grade + now"
// into the next state. The FSRS math itself is covered in fsrs.test.ts; here we pin the state transitions:
// a new card seeds its memory from the opening grade, a pass grows the interval, a lapse restarts it and
// re-shows it today, and the daily-queue helpers behave. A scheduler that silently drifts is the kind of
// bug spaced repetition hides for weeks, so the key numbers are pinned exactly.
import { describe, expect, it } from "vitest";
import { ensureStates, isDue, newReviewState, schedule, selectDue } from "./scheduler";
import { emptyStore } from "./store";
import type { ReviewState } from "./types";

const NOW = new Date("2026-06-22T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
const dueAfter = (days: number) => at(days).toISOString();

describe("newReviewState", () => {
  it("creates a fresh, immediately-due card with no FSRS memory yet", () => {
    expect(newReviewState("card#0", NOW)).toEqual({
      cardId: "card#0",
      reps: 0,
      lapses: 0,
      intervalDays: 0,
      stability: 0,
      difficulty: 0,
      due: NOW.toISOString(),
      lastReviewedAt: null,
      lastGrade: null,
    });
  });
});

describe("schedule — a brand-new card seeds its memory from the opening grade", () => {
  const fresh = () => newReviewState("c", NOW);

  it("hard opens at a 1-day interval", () => {
    const s = schedule(fresh(), "hard", NOW);
    expect(s.intervalDays).toBe(1);
    expect(s.reps).toBe(1);
    expect(s.due).toBe(dueAfter(1));
    expect(s.stability).toBeCloseTo(1.4003, 4); // S0(hard) = w1
    expect(s.difficulty).toBeCloseTo(6.3916, 4);
  });

  it("good opens at 4 days", () => {
    const s = schedule(fresh(), "good", NOW);
    expect(s.intervalDays).toBe(4);
    expect(s.due).toBe(dueAfter(4));
    expect(s.stability).toBeCloseTo(3.7145, 4); // S0(good) = w2
    expect(s.difficulty).toBeCloseTo(5.1618, 4);
  });

  it("easy opens at 14 days with the lowest difficulty", () => {
    const s = schedule(fresh(), "easy", NOW);
    expect(s.intervalDays).toBe(14);
    expect(s.due).toBe(dueAfter(14));
    expect(s.stability).toBeCloseTo(13.8206, 4); // S0(easy) = w3
    expect(s.difficulty).toBeCloseTo(3.932, 4);
  });

  it("the three passing grades give three DIFFERENT intervals on a new card (the four buttons mean something)", () => {
    const intervals = (["hard", "good", "easy"] as const).map((g) => schedule(fresh(), g, NOW).intervalDays);
    expect(intervals).toEqual([1, 4, 14]);
    expect(new Set(intervals).size).toBe(3);
  });
});

describe("schedule — an established card grows by a grade-specific amount", () => {
  // A card that graduated on "good" (S=3.7145, D=5.1618, reps 1), reviewed again 4 days later.
  const graduated = schedule(newReviewState("c", NOW), "good", NOW);
  const later = at(4);

  it("good multiplies the interval out (≈15 days) and keeps difficulty steady", () => {
    const s = schedule(graduated, "good", later);
    expect(s.intervalDays).toBe(15);
    expect(s.reps).toBe(2);
    expect(s.stability).toBeCloseTo(14.8081, 3);
    expect(s.difficulty).toBeCloseTo(5.1618, 3);
  });

  it("easy grows fastest (≈36 days), hard slowest (≈6 days)", () => {
    expect(schedule(graduated, "hard", later).intervalDays).toBe(6);
    expect(schedule(graduated, "easy", later).intervalDays).toBe(36);
  });

  it("grows the interval more the longer you successfully waited (a harder recall is worth more)", () => {
    const soon = schedule(graduated, "good", at(1)); // reviewed early, high retrievability
    const late = schedule(graduated, "good", at(8)); // reviewed late, lower retrievability
    expect(late.intervalDays).toBeGreaterThan(soon.intervalDays);
  });
});

describe("schedule — a lapse ('again') restarts the card", () => {
  const mature = schedule(schedule(newReviewState("c", NOW), "good", NOW), "good", at(4)); // reps 2, S≈14.8

  it("resets reps + interval, counts the lapse, re-shows the same day, and shrinks stability", () => {
    const s = schedule(mature, "again", at(20));
    expect(s.reps).toBe(0);
    expect(s.intervalDays).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.due).toBe(at(20).toISOString()); // due again right now
    expect(s.stability).toBeLessThan(mature.stability); // post-lapse stability drops
    expect(s.difficulty).toBeGreaterThan(mature.difficulty); // a fail makes the card harder
    expect(s.lastGrade).toBe("again");
  });

  it("a relapse grows from the reduced post-lapse stability, not from scratch (memory is kept)", () => {
    const lapsed = schedule(mature, "again", at(20)); // reps 0, but stability/difficulty retained
    const recovered = schedule(lapsed, "good", at(20));
    // It is NOT treated as a brand-new "good" (which would graduate to 4 days); it grows from the lapse.
    expect(recovered.intervalDays).not.toBe(4);
    expect(recovered.reps).toBe(1);
  });

  it("is pure — it never mutates the input state", () => {
    const before = schedule(newReviewState("c", NOW), "good", NOW);
    const snapshot = structuredClone(before);
    schedule(before, "good", at(4));
    expect(before).toEqual(snapshot);
  });
});

describe("isDue / ensureStates / selectDue — the daily queue", () => {
  it("isDue is true at or before the due moment, false after", () => {
    const s = { ...newReviewState("c", NOW), due: dueAfter(2) };
    expect(isDue(s, NOW)).toBe(false);
    expect(isDue(s, at(2))).toBe(true); // exactly due
    expect(isDue(s, at(3))).toBe(true);
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
    const past: ReviewState = { ...newReviewState("past", NOW), due: dueAfter(-2) };
    const today: ReviewState = { ...newReviewState("today", NOW), due: NOW.toISOString() };
    const future: ReviewState = { ...newReviewState("future", NOW), due: dueAfter(5) };
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
