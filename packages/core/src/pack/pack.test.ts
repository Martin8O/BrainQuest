import { describe, expect, it } from "vitest";
import type { VaultConfig } from "../vault/config";
import { parseConceptNote, parseLearningNote } from "../vault/parse";
import { assembleSnapshot } from "../vault/assemble";
import type { ConceptNote, LearningNote } from "../vault/types";
import { buildPack } from "./build";
import { findPackBody, loadPack, packNotePath } from "./loader";
import { PACK_FORMAT_VERSION, validatePack, type PackManifest } from "./types";

// A minimal config so the parser harvests the English default headings used in the fixtures below.
const CFG: VaultConfig = {
  vaultPath: "/fixtures",
  folders: { learning: "learning", concepts: "concepts" },
  harvest: {
    cardsHeading: ["📘 New concepts", "New concepts"],
    recallHeading: ["❓ To review next", "To review next"],
    relatedHeading: ["Related"],
  },
  tags: { hubPrefix: ["Belongs to:"], projectTagPrefix: "project/" },
  areas: { labels: {}, offByDefault: [] },
  tutor: { provider: "ollama", model: "qwen2.5", baseUrl: "http://127.0.0.1:11434" },
};

const NOTE_A = `# Alpha note

#learning #project/demo
Belongs to: [[Hub]]

## New concepts
- **token** (česky: token) — a unit of text → [[token]]
- **prompt** (česky: prompt) — the input you give a model

## To review next
- What is a token?
`;

const NOTE_B = `# Beta note

#learning #project/demo

## New concepts
- **embedding** (česky: vektor) — a numeric representation
`;

const CONCEPT_TOKEN = `# token

**token** (česky: token) — a unit of text a model reads.

## Related
- [[embedding]] — both are model inputs
`;

const CONCEPT_EMBEDDING = `# embedding

**embedding** (česky: vektor) — a numeric representation.
`;

function parseFixtures(): { learning: LearningNote[]; concepts: ConceptNote[] } {
  const learning = [
    parseLearningNote("2026-01-02-beta", "/fixtures/learning/2026-01-02-beta.md", NOTE_B, CFG),
    parseLearningNote("2026-01-01-alpha", "/fixtures/learning/2026-01-01-alpha.md", NOTE_A, CFG),
  ];
  const concepts = [
    parseConceptNote("token", "/fixtures/concepts/token.md", CONCEPT_TOKEN, CFG),
    parseConceptNote("embedding", "/fixtures/concepts/embedding.md", CONCEPT_EMBEDDING, CFG),
  ];
  return { learning, concepts };
}

const MANIFEST: PackManifest = {
  id: "demo-pack",
  name: "Demo Pack",
  lang: "en",
  version: "1.0.0",
  author: "Tester",
  license: "CC-BY-4.0",
  description: "A tiny pack for tests.",
};

describe("pack build ↔ load round-trip", () => {
  it("produces the same content model as reading the vault directly", () => {
    const { learning, concepts } = parseFixtures();
    const vaultSnapshot = assembleSnapshot("/fixtures", learning, concepts);

    const bodies = new Map<string, string>([
      ["/fixtures/learning/2026-01-01-alpha.md", NOTE_A],
      ["/fixtures/learning/2026-01-02-beta.md", NOTE_B],
      ["/fixtures/concepts/token.md", CONCEPT_TOKEN],
      ["/fixtures/concepts/embedding.md", CONCEPT_EMBEDDING],
    ]);
    const pack = buildPack(MANIFEST, learning, concepts, (n) => bodies.get(n.path) ?? "");
    const packSnapshot = loadPack(pack);

    // Same aggregated harvest (ignoring the note-path field, which legitimately differs vault vs pack).
    const stripPath = <T extends { sourcePath: string }>(x: T) => ({ ...x, sourcePath: "«path»" });
    expect(packSnapshot.harvest.cards.map(stripPath)).toEqual(vaultSnapshot.harvest.cards.map(stripPath));
    expect(packSnapshot.harvest.recall.map(stripPath)).toEqual(vaultSnapshot.harvest.recall.map(stripPath));
    expect(packSnapshot.harvest.graph).toEqual(vaultSnapshot.harvest.graph);

    // Same ordering (newest-first learning, alphabetical concepts) and same derived ids.
    expect(packSnapshot.learning.map((n) => n.slug)).toEqual(["2026-01-02-beta", "2026-01-01-alpha"]);
    expect(packSnapshot.concepts.map((c) => c.title)).toEqual(["embedding", "token"]);
    expect(packSnapshot.harvest.cards.map((c) => c.id)).toEqual(
      vaultSnapshot.harvest.cards.map((c) => c.id),
    );
  });

  it("gives pack notes synthetic pack: paths and keeps bodies retrievable", () => {
    const { learning, concepts } = parseFixtures();
    const bodies = new Map<string, string>([
      ["/fixtures/learning/2026-01-01-alpha.md", NOTE_A],
      ["/fixtures/concepts/token.md", CONCEPT_TOKEN],
    ]);
    const pack = buildPack(MANIFEST, learning, concepts, (n) => bodies.get(n.path) ?? "");

    expect(findPackBody(pack, packNotePath("learning", "2026-01-01-alpha"))).toBe(NOTE_A);
    expect(findPackBody(pack, packNotePath("concept", "token"))).toBe(CONCEPT_TOKEN);
    expect(findPackBody(pack, packNotePath("learning", "does-not-exist"))).toBeNull();

    const snapshot = loadPack(pack);
    expect(snapshot.learning[0].path.startsWith("pack:")).toBe(true);
    expect(snapshot.harvest.cards[0].sourcePath.startsWith("pack:")).toBe(true);
  });
});

describe("validatePack", () => {
  const { learning, concepts } = parseFixtures();
  const good = buildPack(MANIFEST, learning, concepts, () => "");

  it("accepts a well-formed pack", () => {
    expect(() => validatePack(good)).not.toThrow();
    expect(good.format).toBe(PACK_FORMAT_VERSION);
  });

  it("rejects non-objects, missing manifest id, and a future format", () => {
    expect(() => validatePack(null)).toThrow(/not an object/);
    expect(() => validatePack({ format: 1, manifest: { id: "" }, notes: [], concepts: [] })).toThrow(
      /non-empty `id`/,
    );
    expect(() =>
      validatePack({ format: PACK_FORMAT_VERSION + 1, manifest: { id: "x" }, notes: [], concepts: [] }),
    ).toThrow(/newer than supported/);
  });

  it("rejects per-element gaps that would otherwise crash loadPack", () => {
    const base = { format: PACK_FORMAT_VERSION, manifest: { id: "x" } };
    // A note without cards/recall arrays would blow up on `.map` in loadPack.
    expect(() =>
      validatePack({ ...base, notes: [{ slug: "n", title: "N" }], concepts: [] }),
    ).toThrow(/cards.*recall/);
    // A concept without a title would blow up on `.localeCompare` in assembleSnapshot.
    expect(() =>
      validatePack({ ...base, notes: [], concepts: [{ slug: "c", edges: [] }] }),
    ).toThrow(/`slug`\/`title`/);
  });
});
