// Tests for the review-store persistence layer. This one DOES touch the disk (that's the point), so it
// redirects the data dir to a throwaway temp folder via BRAINQUEST_DATA_DIR — it must NEVER read or write
// the committed data/reviews.json (Martin's real progress). Covers: missing-file default, the read →
// schedule → save round-trip, the daily activity tally, and the forward migration of a legacy SM-2 file
// (v1/v2, with an `ease` field) up to the current FSRS shape (v3, with stability + difficulty).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { localDateKey } from "../gamification/engine";
import { emptyStore, loadReviewStore, recordReview, reviewsPath, saveReviewStore } from "./store";
import { newReviewState } from "./scheduler";

const NOW = new Date("2026-06-23T08:00:00.000Z");
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bq-store-test-"));
  process.env.BRAINQUEST_DATA_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.BRAINQUEST_DATA_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadReviewStore", () => {
  it("returns an empty v3 store when the file does not exist yet", async () => {
    const store = await loadReviewStore();
    expect(store).toEqual(emptyStore());
    expect(store.version).toBe(3);
  });

  it("forward-migrates a legacy SM-2 file (v2, `ease`) to FSRS v3 (stability + difficulty), keeping `daily`", async () => {
    // A v2 store as written before F1: an SM-2 state (ease/intervalDays, no stability) + an activity log.
    const v2 = {
      version: 2,
      reviews: {
        "x#c0": { cardId: "x#c0", reps: 1, lapses: 0, intervalDays: 6, ease: 2.5, due: "2026-06-29T08:00:00.000Z", lastReviewedAt: NOW.toISOString(), lastGrade: "good" },
      },
      daily: { "2026-06-23": 4 },
    };
    await fs.writeFile(reviewsPath(), JSON.stringify(v2), "utf8");

    const store = await loadReviewStore();
    expect(store.version).toBe(3);
    expect(store.daily).toEqual({ "2026-06-23": 4 }); // streak history preserved
    const m = store.reviews["x#c0"];
    expect(typeof m.stability).toBe("number"); // gained FSRS memory
    expect(typeof m.difficulty).toBe("number");
    expect(m).not.toHaveProperty("ease"); // SM-2 ease dropped
    expect(m.stability).toBe(6); // seeded from the prior interval (interval ≈ stability)
    expect(m.intervalDays).toBe(6); // schedule undisturbed by the upgrade
    expect(m.reps).toBe(1);
    expect(m.lastGrade).toBe("good");
  });

  it("forward-migrates a v1 file (no `daily`) to v3, defaulting daily to {}", async () => {
    const v1 = { version: 1, reviews: { "x#c0": { cardId: "x#c0", reps: 0, lapses: 0, intervalDays: 0, ease: 2.5, due: NOW.toISOString(), lastReviewedAt: null, lastGrade: null } } };
    await fs.writeFile(reviewsPath(), JSON.stringify(v1), "utf8");
    const store = await loadReviewStore();
    expect(store.version).toBe(3);
    expect(store.daily).toEqual({});
    expect(store.reviews["x#c0"].stability).toBeDefined();
  });
});

describe("recordReview round-trip", () => {
  it("schedules the card, persists it, and tallies today's activity", async () => {
    const state = await recordReview("card#0", "good", NOW);
    expect(state.intervalDays).toBe(4); // new card + good → FSRS opens at 4d (scheduler contract)

    const onDisk = await loadReviewStore();
    expect(onDisk.reviews["card#0"].due).toBe(state.due);
    expect(onDisk.daily[localDateKey(NOW)]).toBe(1);
  });

  it("accumulates multiple reviews on the same local day", async () => {
    await recordReview("a", "good", NOW);
    await recordReview("b", "again", NOW);
    await recordReview("c", "easy", NOW);
    const store = await loadReviewStore();
    expect(Object.keys(store.reviews).sort()).toEqual(["a", "b", "c"]);
    expect(store.daily[localDateKey(NOW)]).toBe(3);
  });
});

describe("saveReviewStore", () => {
  it("writes valid JSON that loads back identically (atomic temp→rename leaves no .tmp behind)", async () => {
    const store = emptyStore();
    store.reviews["k"] = newReviewState("k", NOW);
    store.daily["2026-06-23"] = 5;
    await saveReviewStore(store);

    expect(await loadReviewStore()).toEqual(store);
    const leftovers = (await fs.readdir(tmpDir)).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});
