import { describe, expect, it } from "vitest";
import { interleaveBySource } from "./order";

/** Tiny helper: build items tagged with a source + an id, so we can assert exact output order. */
function item(sourceSlug: string, id: string) {
  return { sourceSlug, id };
}

describe("interleaveBySource", () => {
  it("round-robins across source notes instead of dumping one note", () => {
    const input = [
      item("a", "a1"),
      item("a", "a2"),
      item("a", "a3"),
      item("b", "b1"),
      item("b", "b2"),
      item("c", "c1"),
    ];
    expect(interleaveBySource(input).map((x) => x.id)).toEqual(["a1", "b1", "c1", "a2", "b2", "a3"]);
  });

  it("preserves within-note order and first-seen note order", () => {
    const input = [item("b", "b1"), item("a", "a1"), item("a", "a2"), item("b", "b2")];
    // 'b' is seen first, so it leads each round; order within each note is kept.
    expect(interleaveBySource(input).map((x) => x.id)).toEqual(["b1", "a1", "b2", "a2"]);
  });

  it("keeps every item exactly once (no drops, no dupes)", () => {
    const input = Array.from({ length: 50 }, (_, i) => item(`note${i % 7}`, `c${i}`));
    const out = interleaveBySource(input);
    expect(out).toHaveLength(input.length);
    expect(new Set(out.map((x) => x.id)).size).toBe(input.length);
  });

  it("handles a single note and an empty list", () => {
    expect(interleaveBySource([item("a", "a1"), item("a", "a2")]).map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(interleaveBySource([])).toEqual([]);
  });
});
