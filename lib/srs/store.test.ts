// Tests for the review-store persistence layer. This one DOES touch the disk (that's the point), so it
// redirects the data dir to a throwaway temp folder via BRAINQUEST_DATA_DIR — it must NEVER read or write
// the committed data/reviews.json (Martin's real progress). Covers: missing-file default, the read →
// schedule → save round-trip, the daily activity tally, and the v1→v2 forward migration.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { localDateKey } from "@/lib/gamification/engine";
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
  it("returns an empty v2 store when the file does not exist yet", async () => {
    const store = await loadReviewStore();
    expect(store).toEqual(emptyStore());
    expect(store.version).toBe(2);
  });

  it("forward-migrates a v1 file (no `daily`) to v2, defaulting daily to {}", async () => {
    const v1 = { version: 1, reviews: { "x#c0": newReviewState("x#c0", NOW) } };
    await fs.writeFile(reviewsPath(), JSON.stringify(v1), "utf8");
    const store = await loadReviewStore();
    expect(store.version).toBe(2);
    expect(store.daily).toEqual({});
    expect(store.reviews["x#c0"]).toBeDefined();
  });
});

describe("recordReview round-trip", () => {
  it("schedules the card, persists it, and tallies today's activity", async () => {
    const state = await recordReview("card#0", "good", NOW);
    expect(state.intervalDays).toBe(3); // new card + good → graduates to 3d (scheduler contract)

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
