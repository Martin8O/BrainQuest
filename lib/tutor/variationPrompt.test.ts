// Tests for D2's difficulty ladder + the prompt we send the LLM. These are the PURE guardrails: the
// rung contract the UI renders against, the mastery→start-rung calibration, and that the user prompt
// stays grounded in the note. (The live generation itself is a manual smoke test — see scripts/.)
import { describe, expect, it } from "vitest";
import { MAX_NOTE_CHARS } from "./prompt";
import {
  RUNGS,
  VARIATION_KEYS,
  VARIATION_SCHEMA,
  VARIATION_SYSTEM_PROMPT,
  buildVariationPrompt,
  rungAt,
  startRungForStrength,
} from "./variationPrompt";

describe("the ladder", () => {
  it("has four ascending rungs across the Bloom bands", () => {
    expect(RUNGS).toHaveLength(4);
    expect(RUNGS.map((r) => r.level)).toEqual([1, 2, 3, 4]);
    expect(RUNGS.map((r) => r.bloom)).toEqual(["recall", "understand", "apply", "analyze"]);
    expect(new Set(RUNGS.map((r) => r.label)).size).toBe(4); // labels distinct
  });

  it("rungAt clamps + rounds out-of-range levels to a valid rung", () => {
    expect(rungAt(0).level).toBe(1);
    expect(rungAt(99).level).toBe(4);
    expect(rungAt(2.6).level).toBe(3); // rounds
  });
});

describe("startRungForStrength — calibrate the entry rung from mastery", () => {
  it("maps mastery bands to a start rung", () => {
    const cases: [number, number][] = [
      [0, 1], [0.33, 1], [0.34, 2], [0.66, 2], [0.67, 3], [1, 3],
    ];
    for (const [strength, want] of cases) expect(startRungForStrength(strength)).toBe(want);
  });

  it("never starts at the top rung, so there is always a harder rung left to climb", () => {
    for (const s of [0, 0.5, 0.9, 1, 2]) expect(startRungForStrength(s)).toBeLessThanOrEqual(3);
  });
});

describe("the structured-output schema", () => {
  it("requires exactly r1..r4 and forbids extra keys", () => {
    expect(VARIATION_SCHEMA.required).toEqual(["r1", "r2", "r3", "r4"]);
    expect(VARIATION_SCHEMA.additionalProperties).toBe(false);
    expect(VARIATION_KEYS).toEqual(["r1", "r2", "r3", "r4"]);
  });
});

describe("buildVariationPrompt", () => {
  const note = "Toto je poznámka o spaced repetition a SM-2 intervalech.";

  it("embeds the original question, fences the note, and asks for all four rungs", () => {
    const user = buildVariationPrompt("Co je SM-2?", note);
    expect(user).toContain("Co je SM-2?");
    expect(user).toContain("<note>");
    expect(user).toContain("</note>");
    for (const key of VARIATION_KEYS) expect(user).toContain(key);
  });

  it("truncates an over-long note so the prompt size is independent of overflow", () => {
    const slightlyOver = buildVariationPrompt("Q", "X".repeat(MAX_NOTE_CHARS + 500));
    const wildlyOver = buildVariationPrompt("Q", "X".repeat(MAX_NOTE_CHARS + 50_000));
    expect(slightlyOver).toContain("…(zkráceno)");
    // No matter how far the note overflows the cap, the prompt is the same bounded length.
    expect(slightlyOver.length).toBe(wildlyOver.length);
  });

  it("the system prompt keeps the answerable-from-note guardrail", () => {
    expect(VARIATION_SYSTEM_PROMPT).toMatch(/ANSWERABLE using ONLY the provided note/i);
    expect(VARIATION_SYSTEM_PROMPT).toMatch(/Do NOT reveal/i);
  });
});
