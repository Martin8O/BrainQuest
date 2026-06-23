// Tests for the mastery/progress math (C1). It DERIVES "how much do I know" from cards + review state,
// so a bug here silently mis-reports the learner's standing. The standout case is the case-insensitive
// concept match — a real bug found during C1, kept here as a regression test so it can't come back.
import { describe, expect, it } from "vitest";
import type { Card, Harvest, LearningNote } from "@/lib/vault/types";
import { emptyStore } from "@/lib/srs/store";
import { newReviewState } from "@/lib/srs/scheduler";
import type { ReviewState, ReviewStore } from "@/lib/srs/types";
import { cardBucket, cardStrength, computeProgress } from "./mastery";

const NOW = new Date("2026-06-23T08:00:00.000Z");

/** A review state at a given interval (≥21d = mature/strength 1). */
function reviewed(cardId: string, intervalDays: number): ReviewState {
  return { ...newReviewState(cardId, NOW), reps: 1, intervalDays, lastReviewedAt: NOW.toISOString() };
}

describe("cardStrength / cardBucket", () => {
  it("is 0 for an unseen or reps-0 card", () => {
    expect(cardStrength(undefined)).toBe(0);
    expect(cardStrength(newReviewState("c", NOW))).toBe(0); // reps 0
    expect(cardBucket(undefined)).toBe("new");
  });

  it("scales linearly with interval and caps at 1 (mature) at 21 days", () => {
    expect(cardStrength(reviewed("c", 0))).toBe(0);
    expect(cardStrength(reviewed("c", 21))).toBe(1);
    expect(cardStrength(reviewed("c", 42))).toBe(1); // capped, not >1
    expect(cardStrength(reviewed("c", 10))).toBeCloseTo(10 / 21, 10);
    expect(cardBucket(reviewed("c", 21))).toBe("mature");
    expect(cardBucket(reviewed("c", 10))).toBe("learning");
  });
});

describe("computeProgress", () => {
  const cards: Card[] = [
    { id: "n0#c0", front: "a", back: "", conceptLink: "Build step", sourceSlug: "n0", sourcePath: "/n0.md" },
    { id: "n0#c1", front: "b", back: "", conceptLink: "build step", sourceSlug: "n0", sourcePath: "/n0.md" },
  ];
  const harvest: Pick<Harvest, "cards" | "graph"> = {
    cards,
    graph: { nodes: ["Build step", "Lonely concept"], edges: [] },
  };
  const notes: Pick<LearningNote, "slug" | "title" | "date">[] = [
    { slug: "n0", title: "Scaffolding note", date: "2026-06-22" },
  ];

  it("computes overall totals from every card", () => {
    const store: ReviewStore = emptyStore();
    store.reviews["n0#c0"] = reviewed("n0#c0", 21); // mature
    const p = computeProgress(harvest, notes, store);
    expect(p.overall.totalCards).toBe(2);
    expect(p.overall.reviewedCards).toBe(1);
    expect(p.overall.buckets).toEqual({ new: 1, learning: 0, mature: 1 });
  });

  it("matches a card's concept link to its graph node CASE-INSENSITIVELY (C1 regression)", () => {
    const store: ReviewStore = emptyStore();
    // Both cards point at the concept, one as "Build step" and one as "build step".
    store.reviews["n0#c0"] = reviewed("n0#c0", 21);
    store.reviews["n0#c1"] = reviewed("n0#c1", 21);
    const p = computeProgress(harvest, notes, store);
    const build = p.concepts.find((c) => c.concept === "Build step")!;
    expect(build.cardCount).toBe(2); // both cards counted despite the casing difference
    expect(build.avgStrength).toBe(1);
    expect(build.level).toBe("mastered");
  });

  it("keeps concepts with zero cards as 'untouched' (the 'co mě čeká' side)", () => {
    const p = computeProgress(harvest, notes, emptyStore());
    const lonely = p.concepts.find((c) => c.concept === "Lonely concept")!;
    expect(lonely.cardCount).toBe(0);
    expect(lonely.level).toBe("untouched");
  });

  it("groups cards into source-note clusters with a label and date", () => {
    const p = computeProgress(harvest, notes, emptyStore());
    expect(p.clusters).toHaveLength(1);
    expect(p.clusters[0]).toMatchObject({ slug: "n0", title: "Scaffolding note", date: "2026-06-22", cardCount: 2 });
  });
});
