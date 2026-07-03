import { describe, expect, it } from "vitest";
import type { VaultConfig } from "../vault/config";
import { classifyNote, parseConceptNote, parseLearningNote } from "../vault/parse";
import type { ConceptNote, LearningNote } from "../vault/types";
import { buildPack } from "./build";
import { summarize, validatePackContent } from "./validate";
import type { PackManifest } from "./types";
import {
  buildDraftFiles,
  emitConceptNote,
  emitLessonNote,
  matchConceptTitle,
  parseConceptBody,
  parseGenLesson,
  parseOutline,
  type DraftInput,
} from "./generate";

// The parser must harvest the exact headings the emitters write — this is the whole point of the round-trip.
const CFG: VaultConfig = {
  vaultPath: "/fixtures",
  folders: { learning: "learning", concepts: "concepts" },
  harvest: {
    cardsHeading: ["📘 New concepts"],
    recallHeading: ["❓ To review next"],
    relatedHeading: ["Related"],
  },
  tags: { hubPrefix: ["Belongs to:"], projectTagPrefix: "project/" },
  areas: { labels: {}, offByDefault: [] },
  tutor: { provider: "ollama", model: "qwen2.5", baseUrl: "http://127.0.0.1:11434" },
};

// A small acyclic outline: neural-network depends on the two foundational concepts.
const OUTLINE: DraftInput["outline"] = {
  concepts: [
    { slug: "vector", title: "Vector", gloss: "an ordered list of numbers", prerequisites: [] },
    { slug: "weight", title: "Weight", gloss: "a tunable parameter", prerequisites: [] },
    {
      slug: "neural-network",
      title: "Neural network",
      gloss: "layers of weighted units",
      prerequisites: ["vector", "weight"],
    },
  ],
  lessons: [
    { slug: "foundations", title: "Foundations", conceptSlugs: ["vector", "weight"] },
    { slug: "the-network", title: "The network", conceptSlugs: ["neural-network"] },
  ],
};

const INPUT: DraftInput = {
  outline: OUTLINE,
  packId: "ai-basics",
  packName: "AI Basics",
  lang: "en",
  conceptBodies: {
    vector: parseConceptBody({ paragraphs: ["A vector is an ordered list of numbers.", "It has a direction."] }),
    weight: parseConceptBody({ paragraphs: ["A weight scales an input."] }),
    "neural-network": parseConceptBody({ paragraphs: ["A neural network stacks weighted units into layers."] }),
  },
  lessons: {
    foundations: parseGenLesson({
      intro: "The building blocks.",
      cards: [
        { term: "vector", gloss: "ordered numbers", definition: "an ordered list of numbers", concept: "Vector" },
        { term: "weight", gloss: "a parameter", definition: "a tunable scalar on an input", concept: "Weight" },
      ],
      recall: ["What is a vector?", "Why do weights matter?"],
    }),
    "the-network": parseGenLesson({
      intro: "Putting it together.",
      cards: [
        {
          term: "neural network",
          gloss: "layered units",
          definition: "layers of weighted units",
          concept: "Neural network",
        },
      ],
      recall: ["Describe a neural network in your own words."],
    }),
  },
};

const MANIFEST: PackManifest = {
  id: "ai-basics",
  name: "AI Basics",
  lang: "en",
  version: "0.1.0",
  author: "Test",
  license: "All rights reserved",
  description: "round-trip fixture",
};

/** Recompile the emitted draft files the way the compiler's vault mode does (classify by folder path). */
function compileDraft() {
  const files = buildDraftFiles(INPUT);
  const learning: LearningNote[] = [];
  const concepts: ConceptNote[] = [];
  const bodies = new Map<string, string>();
  for (const f of files) {
    const slug = f.relPath.replace(/^(learning|concepts)\//, "").replace(/\.md$/, "");
    bodies.set(f.relPath, f.content);
    if (f.relPath.startsWith("learning/")) learning.push(parseLearningNote(slug, f.relPath, f.content, CFG));
    else concepts.push(parseConceptNote(slug, f.relPath, f.content, CFG));
  }
  const pack = buildPack(MANIFEST, learning, concepts, (n) => bodies.get(n.path) ?? "");
  return { files, learning, concepts, pack };
}

describe("emit → parse round-trip", () => {
  it("emits cards the parser harvests back verbatim", () => {
    const md = emitLessonNote(
      INPUT.outline.lessons[0],
      INPUT.lessons.foundations,
      { projectSlug: "ai-basics", hub: "AI Basics", conceptTitles: ["Vector", "Weight"] },
    );
    const note = parseLearningNote("foundations", "learning/foundations.md", md, CFG);
    expect(note.cards).toHaveLength(2);
    expect(note.cards[0].front).toBe("vector");
    expect(note.cards[0].conceptLink).toBe("Vector");
    // The back keeps both the gloss and the definition (the `vault` card convention).
    expect(note.cards[0].back).toContain("ordered numbers");
    expect(note.cards[0].back).toContain("an ordered list of numbers");
    expect(note.recall.map((r) => r.question)).toEqual(["What is a vector?", "Why do weights matter?"]);
    expect(note.projects).toContain("project/ai-basics");
    expect(note.hub).toBe("AI Basics");
  });

  it("emits a concept whose gloss and prerequisite edges parse back", () => {
    const titleBySlug = new Map(INPUT.outline.concepts.map((c) => [c.slug, c.title]));
    const md = emitConceptNote(
      INPUT.outline.concepts[2], // neural-network → vector, weight
      INPUT.conceptBodies["neural-network"],
      { projectSlug: "ai-basics", titleBySlug },
    );
    const concept = parseConceptNote("neural-network", "concepts/neural-network.md", md, CFG);
    expect(concept.gloss).toContain("layers of weighted units");
    expect(concept.edges.map((e) => e.to).sort()).toEqual(["Vector", "Weight"]);
    // A foundational concept emits no Related section → no edges.
    const foundational = emitConceptNote(
      INPUT.outline.concepts[0],
      INPUT.conceptBodies.vector,
      { projectSlug: "ai-basics", titleBySlug },
    );
    expect(parseConceptNote("vector", "concepts/vector.md", foundational, CFG).edges).toHaveLength(0);
  });

  it("classifies emitted notes correctly (lessons=learning, concepts=concept)", () => {
    const { files } = compileDraft();
    for (const f of files) {
      const kind = classifyNote(f.content, CFG);
      expect(kind).toBe(f.relPath.startsWith("learning/") ? "learning" : "concept");
    }
  });

  it("produces a pack that compiles clean with a real prerequisite DAG (no cycles, no errors)", () => {
    const { pack } = compileDraft();
    expect(pack.notes).toHaveLength(2);
    expect(pack.concepts).toHaveLength(3);
    const issues = validatePackContent(pack);
    const { errors } = summarize(issues);
    expect(errors).toBe(0);
    // The asymmetric prereq edges form a DAG → the cycle detector stays silent.
    expect(issues.filter((i) => i.kind === "cycle")).toHaveLength(0);
    // Every card's concept link resolves (no missing-link warnings from the generated content).
    expect(issues.filter((i) => i.kind === "missing-link")).toHaveLength(0);
  });
});

describe("runtime guards reject malformed LLM output", () => {
  it("parseOutline throws on a non-object / missing fields", () => {
    expect(() => parseOutline({ concepts: [{ slug: "x" }], lessons: [] })).toThrow(/title/);
    expect(() => parseOutline({ lessons: [] })).toThrow(/concepts/);
  });

  it("parseGenLesson requires each card's fields", () => {
    expect(() => parseGenLesson({ intro: "", cards: [{ term: "t" }], recall: [] })).toThrow(/gloss/);
  });

  it("parseOutline defaults an omitted prerequisites list to empty", () => {
    const o = parseOutline({ concepts: [{ slug: "a", title: "A", gloss: "g" }], lessons: [] });
    expect(o.concepts[0].prerequisites).toEqual([]);
  });
});

describe("matchConceptTitle reconciles sloppy LLM concept links", () => {
  const titles = ["Neural network", "Vector", "Weight"];
  it("keeps an exact title", () => expect(matchConceptTitle("Vector", titles)).toBe("Vector"));
  it("matches case-insensitively", () => expect(matchConceptTitle("vector", titles)).toBe("Vector"));
  it("strips a trailing ': gloss' the model appended", () =>
    expect(matchConceptTitle("Neural network: layers of weighted units", titles)).toBe("Neural network"));
  it("strips a trailing ' — gloss'", () =>
    expect(matchConceptTitle("Weight — a tunable parameter", titles)).toBe("Weight"));
  it("leaves a genuinely unknown value untouched (compiler will flag it)", () =>
    expect(matchConceptTitle("Something else", titles)).toBe("Something else"));

  it("makes cards resolve even when the LLM emits 'Title: gloss' concept values", () => {
    const md = emitLessonNote(
      { slug: "l", title: "L", conceptSlugs: ["vector"] },
      parseGenLesson({
        intro: "",
        cards: [{ term: "v", gloss: "g", definition: "d", concept: "Vector: an ordered list of numbers" }],
        recall: [],
      }),
      { projectSlug: "p", hub: "H", conceptTitles: ["Vector"] },
    );
    const note = parseLearningNote("l", "learning/l.md", md, CFG);
    expect(note.cards[0].conceptLink).toBe("Vector");
  });
});
