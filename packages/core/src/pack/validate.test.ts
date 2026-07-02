import { describe, expect, it } from "vitest";
import type { Pack, PackConcept, PackNote } from "./types";
import { PACK_FORMAT_VERSION } from "./types";
import { formatIssues, packStats, summarize, validatePackContent } from "./validate";

// --- Tiny pack builders (bypass parsing — validate.ts works on the Pack shape directly). ----------------

function note(slug: string, over: Partial<PackNote> = {}): PackNote {
  return {
    slug,
    title: slug,
    date: null,
    tags: [],
    hub: null,
    projects: [],
    body: "",
    cards: [],
    recall: [],
    ...over,
  };
}

function concept(title: string, edges: { to: string }[] = [], over: Partial<PackConcept> = {}): PackConcept {
  return {
    slug: title.toLowerCase(),
    title,
    tags: [],
    gloss: null,
    body: "",
    edges: edges.map((e) => ({ from: title, to: e.to, reason: null })),
    ...over,
  };
}

function pack(notes: PackNote[], concepts: PackConcept[]): Pack {
  return {
    format: PACK_FORMAT_VERSION,
    manifest: {
      id: "t",
      name: "T",
      lang: "en",
      version: "1",
      author: "a",
      license: "l",
      description: "d",
    },
    notes,
    concepts,
  };
}

const card = (front: string, conceptLink: string | null) => ({ front, back: "b", conceptLink });

describe("validatePackContent", () => {
  it("passes a clean, connected pack with no issues", () => {
    const p = pack(
      [note("n1", { cards: [card("token", "token")] })],
      [concept("token", [{ to: "embedding" }]), concept("embedding", [{ to: "token" }])],
    );
    expect(validatePackContent(p)).toEqual([]);
  });

  it("flags a card link to a nonexistent concept (missing-link, case-insensitive resolution)", () => {
    const p = pack(
      [note("n1", { cards: [card("x", "Token"), card("y", "Ghost")] })],
      [concept("token")], // note the differing case — "Token" must still resolve
    );
    const issues = validatePackContent(p);
    const missing = issues.filter((i) => i.kind === "missing-link");
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("[[Ghost]]");
    expect(missing[0].severity).toBe("warning");
  });

  it("flags an edge to a nonexistent concept", () => {
    const p = pack([], [concept("token", [{ to: "nope" }])]);
    const missing = validatePackContent(p).filter((i) => i.kind === "missing-link");
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("[[nope]]");
  });

  it("flags a disconnected concept as an orphan, but not a card-referenced one", () => {
    const p = pack(
      [note("n1", { cards: [card("t", "token")] })],
      [concept("token"), concept("lonely")], // token is card-referenced; lonely is truly disconnected
    );
    const orphans = validatePackContent(p).filter((i) => i.kind === "orphan-concept");
    expect(orphans.map((o) => o.ref)).toEqual(["lonely"]);
  });

  it("flags empty learning notes", () => {
    const p = pack([note("empty"), note("full", { recall: [{ question: "q?" }] })], []);
    const empty = validatePackContent(p).filter((i) => i.kind === "empty-note");
    expect(empty.map((e) => e.ref)).toEqual(["empty"]);
  });

  it("flags duplicate slugs as errors", () => {
    const p = pack([note("dup", { recall: [{ question: "a" }] }), note("dup", { recall: [{ question: "b" }] })], []);
    const dups = validatePackContent(p).filter((i) => i.kind === "duplicate-slug");
    expect(dups).toHaveLength(1);
    expect(dups[0].severity).toBe("error");
  });

  it("does NOT report symmetric related-pairs as cycles", () => {
    // A↔B and B↔C and C↔A are all mutual — related links, not dependency cycles.
    const p = pack(
      [],
      [
        concept("A", [{ to: "B" }, { to: "C" }]),
        concept("B", [{ to: "A" }, { to: "C" }]),
        concept("C", [{ to: "A" }, { to: "B" }]),
      ],
    );
    expect(validatePackContent(p).filter((i) => i.kind === "cycle")).toEqual([]);
  });

  it("reports a genuine asymmetric dependency cycle", () => {
    // A→B→C→A with no reverse edges = a real one-way cycle.
    const p = pack(
      [],
      [concept("A", [{ to: "B" }]), concept("B", [{ to: "C" }]), concept("C", [{ to: "A" }])],
    );
    const cycles = validatePackContent(p).filter((i) => i.kind === "cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].message).toMatch(/A → B → C/);
  });

  it("reports a self-loop (a concept relating to itself) as a cycle, once", () => {
    const p = pack([], [concept("A", [{ to: "A" }, { to: "A" }]), concept("B")]);
    const cycles = validatePackContent(p).filter((i) => i.kind === "cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].message).toMatch(/A → A/);
  });

  it("does NOT report a DAG as a cycle", () => {
    const p = pack([], [concept("A", [{ to: "B" }]), concept("B", [{ to: "C" }]), concept("C")]);
    // C is a sink referenced by B (not orphan); no cycle.
    expect(validatePackContent(p).filter((i) => i.kind === "cycle")).toEqual([]);
  });
});

describe("summarize / packStats / formatIssues", () => {
  it("counts errors vs warnings", () => {
    const p = pack([note("dup"), note("dup")], [concept("lonely")]);
    const s = summarize(validatePackContent(p));
    expect(s.errors).toBe(1); // duplicate-slug
    expect(s.warnings).toBeGreaterThanOrEqual(1); // empty-note + orphan
  });

  it("counts pack content", () => {
    const p = pack(
      [note("n", { cards: [card("a", null), card("b", null)], recall: [{ question: "q" }] })],
      [concept("x", [{ to: "y" }]), concept("y")],
    );
    expect(packStats(p)).toEqual({ notes: 1, concepts: 2, cards: 2, recall: 1, edges: 1 });
  });

  it("renders a clean-pack report", () => {
    expect(formatIssues([])).toContain("no content issues");
  });
});
