// Tests for the skill-tree layout (C2). The map is the riskiest module to eyeball, so we pin the two
// properties that must hold regardless of how the force-directed positions land: (1) the lock derivation
// — a node is locked only while it has neighbours and none is touched — and (2) determinism: same graph +
// same seed ⇒ byte-identical coordinates (the map must not wander as you learn). We assert no specific
// pixel coordinates (those are allowed to change), only these invariants.
import { describe, expect, it } from "vitest";
import type { ConceptGraph } from "../vault/types";
import type { ConceptMastery, MasteryLevel } from "../progress/types";
import { buildSkillMap } from "./layout";

/** A ConceptMastery row at a chosen level (the layout only reads `level` for lock state). */
function mastery(concept: string, level: MasteryLevel): ConceptMastery {
  const touched = level !== "untouched";
  return { concept, cardCount: touched ? 1 : 0, avgStrength: touched ? 1 : 0, level };
}

// A simple chain A — B — C — D so lock propagation is easy to reason about.
const chain: ConceptGraph = {
  nodes: ["A", "B", "C", "D"],
  edges: [
    { from: "A", to: "B", reason: null },
    { from: "B", to: "C", reason: null },
    { from: "C", to: "D", reason: null },
  ],
};

/** locked state per concept for a given map. */
function lockState(levels: Record<string, MasteryLevel>): Record<string, boolean> {
  const rows = chain.nodes.map((c) => mastery(c, levels[c] ?? "untouched"));
  const map = buildSkillMap(chain, rows, { seed: 1 });
  return Object.fromEntries(map.nodes.map((n) => [n.concept, n.locked]));
}

describe("lock derivation", () => {
  it("locks every connected node when nothing has been touched", () => {
    expect(lockState({})).toEqual({ A: true, B: true, C: true, D: true });
  });

  it("unlocks a node as soon as one of its neighbours is touched", () => {
    // Touch B: A and C each have B as a neighbour → they unlock; D's only neighbour (C) is still
    // untouched → D stays locked. B itself is touched → never locked.
    expect(lockState({ B: "learning" })).toEqual({ A: false, B: false, C: false, D: true });
  });
});

describe("determinism", () => {
  const rows = chain.nodes.map((c) => mastery(c, "untouched"));
  const coords = (seed: number) =>
    buildSkillMap(chain, rows, { seed }).nodes.map((n) => `${n.x.toFixed(4)},${n.y.toFixed(4)}`).join("|");

  it("produces identical coordinates for the same seed", () => {
    expect(coords(42)).toBe(coords(42));
  });

  it("produces different coordinates for a different seed", () => {
    expect(coords(42)).not.toBe(coords(7));
  });
});
