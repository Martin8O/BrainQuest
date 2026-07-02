// Tests for D2's variation cache — the "caching to control cost" the plan asks for. The interesting
// logic is self-invalidation: a hit must require BOTH the note hash and the model to match, so editing a
// note or switching TUTOR_MODEL transparently regenerates instead of serving a stale ladder.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { Variation } from "./types";
import {
  emptyVariationCache,
  getCachedVariations,
  hashNote,
  loadVariationCache,
  saveVariationCache,
  variationsPath,
} from "./variationStore";

const VARIATIONS: Variation[] = [1, 2, 3, 4].map((level) => ({
  level,
  label: `L${level}`,
  bloom: "recall",
  question: `Q${level}`,
}));

describe("hashNote", () => {
  it("is stable for the same text and changes when the text changes", () => {
    expect(hashNote("note A")).toBe(hashNote("note A"));
    expect(hashNote("note A")).not.toBe(hashNote("note B"));
    expect(hashNote("note A")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("getCachedVariations — hit only on an exact (note, model) match", () => {
  const h = hashNote("note A");
  const cache = emptyVariationCache();
  cache.entries["p#r0"] = { noteHash: h, model: "qwen2.5", generatedAt: "2026-06-23T00:00:00.000Z", variations: VARIATIONS };

  it("hits when both the note hash and model match", () => {
    expect(getCachedVariations(cache, "p#r0", h, "qwen2.5")).toHaveLength(4);
  });

  it("misses when the note changed", () => {
    expect(getCachedVariations(cache, "p#r0", hashNote("note B"), "qwen2.5")).toBeNull();
  });

  it("misses when a different model is in use", () => {
    expect(getCachedVariations(cache, "p#r0", h, "llama3.1")).toBeNull();
  });

  it("misses for an unknown prompt id", () => {
    expect(getCachedVariations(cache, "unknown", h, "qwen2.5")).toBeNull();
  });
});

describe("persistence round-trip", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bq-var-test-"));
    process.env.BRAINQUEST_DATA_DIR = tmpDir;
  });
  afterEach(async () => {
    delete process.env.BRAINQUEST_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty cache when the file is absent, and reloads what it saved", async () => {
    expect(await loadVariationCache()).toEqual(emptyVariationCache());

    const cache = emptyVariationCache();
    cache.entries["p#r0"] = { noteHash: hashNote("n"), model: "qwen2.5", generatedAt: "2026-06-23T00:00:00.000Z", variations: VARIATIONS };
    await saveVariationCache(cache);

    expect(await loadVariationCache()).toEqual(cache);
    expect(variationsPath().endsWith("variations.json")).toBe(true);
  });

  it("treats a corrupt cache file as empty rather than throwing (tutor must never break)", async () => {
    await fs.writeFile(variationsPath(), "{ not valid json", "utf8");
    expect(await loadVariationCache()).toEqual(emptyVariationCache());
  });
});
