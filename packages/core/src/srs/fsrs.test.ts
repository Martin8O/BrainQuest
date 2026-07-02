// Unit tests for the FSRS-4.5 core math (F1) — the risky logic that replaced SM-2. These pin the model's
// defining properties (the forgetting curve, grade ordering, mean reversion, lapse drop) plus a few exact
// numbers computed from the published formulas + default weights, so a silent drift in the math is caught.
import { describe, expect, it } from "vitest";
import {
  FSRS_PARAMS,
  REQUEST_RETENTION,
  initDifficulty,
  initStability,
  intervalFromStability,
  nextDifficulty,
  nextLapseStability,
  nextRecallStability,
  retrievability,
} from "./fsrs";

describe("retrievability — the forgetting curve", () => {
  it("is 1 right after review and falls to the request retention after exactly S days", () => {
    expect(retrievability(0, 5)).toBeCloseTo(1, 10);
    expect(retrievability(5, 5)).toBeCloseTo(REQUEST_RETENTION, 10); // R = 0.9 when t = S, by design
    expect(retrievability(50, 50)).toBeCloseTo(REQUEST_RETENTION, 10); // scale-free: t = S → 0.9 at any S
  });

  it("decreases monotonically with elapsed time", () => {
    const r1 = retrievability(1, 10);
    const r5 = retrievability(5, 10);
    const r20 = retrievability(20, 10);
    expect(r1).toBeGreaterThan(r5);
    expect(r5).toBeGreaterThan(r20);
  });
});

describe("intervalFromStability", () => {
  it("rounds to ≈ stability (interval = S at 90% retention) and never goes below 1 day", () => {
    expect(intervalFromStability(4)).toBe(4);
    expect(intervalFromStability(36.4)).toBe(36);
    expect(intervalFromStability(0.1)).toBe(1); // sub-day stability still schedules at least a day out
    expect(intervalFromStability(3.7145)).toBe(4); // a fresh "good" card
  });
});

describe("initial stability + difficulty (the opening rating)", () => {
  it("seeds stability straight from the weight for that rating: S0(G) = w[G−1]", () => {
    expect(initStability("again")).toBeCloseTo(FSRS_PARAMS[0], 10);
    expect(initStability("hard")).toBeCloseTo(FSRS_PARAMS[1], 10);
    expect(initStability("good")).toBeCloseTo(FSRS_PARAMS[2], 10);
    expect(initStability("easy")).toBeCloseTo(FSRS_PARAMS[3], 10);
  });

  it("gives a harder opening grade a higher difficulty, all within [1,10]", () => {
    const d = { again: initDifficulty("again"), hard: initDifficulty("hard"), good: initDifficulty("good"), easy: initDifficulty("easy") };
    expect(d.again).toBeGreaterThan(d.hard);
    expect(d.hard).toBeGreaterThan(d.good);
    expect(d.good).toBeGreaterThan(d.easy);
    for (const v of Object.values(d)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(d.good).toBeCloseTo(FSRS_PARAMS[4], 10); // D0(good) = w4 exactly
  });

  it("the four opening grades give four DIFFERENT initial intervals (the buttons mean something)", () => {
    const ivls = (["again", "hard", "good", "easy"] as const).map((g) => intervalFromStability(initStability(g)));
    // again 1 · hard 1 collide at the 1-day floor, but the three PASSING grades are distinct and increasing.
    expect(intervalFromStability(initStability("hard"))).toBeLessThan(intervalFromStability(initStability("good")));
    expect(intervalFromStability(initStability("good"))).toBeLessThan(intervalFromStability(initStability("easy")));
    expect(ivls).toEqual([1, 1, 4, 14]);
  });
});

describe("nextDifficulty — nudge then mean-revert", () => {
  const D = 5.1618; // D0(good)

  it("raises difficulty on a fail, lowers it on easy, barely moves on good", () => {
    expect(nextDifficulty(D, "again")).toBeGreaterThan(D);
    expect(nextDifficulty(D, "easy")).toBeLessThan(D);
    expect(nextDifficulty(D, "good")).toBeCloseTo(D, 4); // good ≈ unchanged (it is the anchor)
  });

  it("never leaves the [1,10] range, even from an extreme", () => {
    expect(nextDifficulty(10, "again")).toBeLessThanOrEqual(10);
    expect(nextDifficulty(1, "easy")).toBeGreaterThanOrEqual(1);
  });
});

describe("nextRecallStability — a pass grows stability", () => {
  const S = 3.7145;
  const D = 5.1618;
  const r = retrievability(4, S); // reviewed 4 days after a card with stability 3.71

  it("increases stability, and more so for easier grades (easy > good > hard)", () => {
    const hard = nextRecallStability(D, S, r, "hard");
    const good = nextRecallStability(D, S, r, "good");
    const easy = nextRecallStability(D, S, r, "easy");
    expect(hard).toBeGreaterThan(S);
    expect(good).toBeGreaterThan(hard);
    expect(easy).toBeGreaterThan(good);
    // Pinned to the FSRS-4.5 formula with default weights.
    expect(good).toBeCloseTo(14.8081, 3);
    expect(easy).toBeCloseTo(35.6141, 3);
  });

  it("grows stability MORE when the card was less retrievable (lower R = a harder, more valuable recall)", () => {
    const freshlyReviewed = nextRecallStability(D, S, retrievability(0, S), "good"); // R≈1, almost no gain
    const nearlyForgotten = nextRecallStability(D, S, retrievability(8, S), "good"); // low R, big gain
    expect(nearlyForgotten).toBeGreaterThan(freshlyReviewed);
  });
});

describe("nextLapseStability — a fail shrinks stability", () => {
  it("drops a mature card's stability well below its previous value", () => {
    const S = 50;
    const lapsed = nextLapseStability(5, S, retrievability(40, S));
    expect(lapsed).toBeLessThan(S);
    expect(lapsed).toBeGreaterThan(0);
  });
});
