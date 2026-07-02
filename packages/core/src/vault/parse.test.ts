// Unit tests for the vault parser — the other risky logic E2 names. The whole app is downstream of
// these regexes: a parser that quietly mis-harvests one bullet poisons every card, edge and concept.
// parse.ts is pure (no fs), so we feed it strings and assert the exact harvested shape.
import { describe, expect, it } from "vitest";
import type { VaultConfig } from "./config";
import {
  classifyNote,
  parseCardBullet,
  parseConceptNote,
  parseDateFromSlug,
  parseGloss,
  parseHub,
  parseLearningNote,
  parseRelatedBullet,
  parseTags,
  parseTitle,
  sectionItems,
  slugify,
  splitDocIntoNotes,
} from "./parse";

const cfg: VaultConfig = {
  vaultPath: "/vault",
  folders: { learning: "learning", concepts: "concepts" },
  harvest: { cardsHeading: "📘 Nové pojmy", recallHeading: "❓ K probrání příště", relatedHeading: "Související" },
  tags: { hubPrefix: "Patří k:", projectTagPrefix: "project/" },
  areas: { labels: {}, offByDefault: [] },
  tutor: { provider: "ollama", model: "qwen2.5", baseUrl: "http://127.0.0.1:11434" },
};

describe("small field parsers", () => {
  it("parseTitle returns the first H1, ignoring deeper headings, else null", () => {
    expect(parseTitle("## Section\n# Real Title\nbody")).toBe("Real Title");
    expect(parseTitle("no heading here")).toBeNull();
  });

  it("parseTags reads dedicated #tag lines but never markdown headings or inline prose tags", () => {
    expect(parseTags("# Heading\n#learning #project/brainquest\nText with #inline tag")).toEqual([
      "learning",
      "project/brainquest",
    ]);
    expect(parseTags("## Nadpis\nžádné tagy")).toEqual([]);
  });

  it("parseDateFromSlug pulls a YYYY-MM-DD prefix, else null", () => {
    expect(parseDateFromSlug("2026-06-22-a2-vault-reader")).toBe("2026-06-22");
    expect(parseDateFromSlug("concept-without-date")).toBeNull();
  });

  it("parseHub extracts the configured-prefix `[[Hub]]` target", () => {
    expect(parseHub("intro\nPatří k: [[BrainQuest]]\nmore", "Patří k:")).toBe("BrainQuest");
    expect(parseHub("no hub line", "Patří k:")).toBeNull();
    // The prefix is config-driven, so another brain's convention works too.
    expect(parseHub("Belongs to: [[Hub]]", "Belongs to:")).toBe("Hub");
  });

  it("parseGloss returns the first bold definition line, markdown stripped", () => {
    expect(parseGloss("# Title\n\n**server action** (česky: serverová akce) — běží na serveru")).toBe(
      "server action (česky: serverová akce) — běží na serveru",
    );
    expect(parseGloss("# Title\nplain body, no bold")).toBeNull();
  });
});

describe("sectionItems", () => {
  const md = [
    "## 📘 Nové pojmy",
    "- _template helper bullet that must be skipped_",
    "- **term** — real bullet",
    "- another real bullet",
    "## Next heading",
    "- bullet in another section",
  ].join("\n");

  it("returns the section's bullets, skipping the italic helper and stopping at the next heading", () => {
    expect(sectionItems(md, "📘 Nové pojmy")).toEqual(["- **term** — real bullet", "- another real bullet"]);
  });

  it("returns [] for a heading that is not present", () => {
    expect(sectionItems(md, "Neexistuje")).toEqual([]);
  });

  it("matches any heading in an alias list (so English/Czech vaults both harvest)", () => {
    const english = "## 📘 New concepts\n- **term** — bullet";
    // The Czech note matches the Czech alias; the English note matches the English alias — same config.
    const aliases = ["📘 New concepts", "📘 Nové pojmy"];
    expect(sectionItems(md, aliases)).toEqual(["- **term** — real bullet", "- another real bullet"]);
    expect(sectionItems(english, aliases)).toEqual(["- **term** — bullet"]);
  });
});

describe("parseCardBullet", () => {
  it("splits front / back / conceptLink and drops the trailing pointer", () => {
    const card = parseCardBullet("- **server action** (serverová akce) — běží na serveru → [[server action]]");
    expect(card).toEqual({
      front: "server action",
      back: "(serverová akce) — běží na serveru",
      conceptLink: "server action",
    });
  });

  it("returns null for a bullet without a leading bold term (not a card)", () => {
    expect(parseCardBullet("- just a plain note, not a term")).toBeNull();
  });

  it("leaves conceptLink null when the bullet has no `→ [[…]]` pointer", () => {
    expect(parseCardBullet("- **atomic write** — write a temp file then rename")?.conceptLink).toBeNull();
  });
});

describe("parseRelatedBullet", () => {
  it("reads the wikilink target and the reason after the dash", () => {
    expect(parseRelatedBullet("- [[Next.js]] — kde se to používá")).toEqual({ to: "Next.js", reason: "kde se to používá" });
  });

  it("returns null reason when there is no explanation, and null entirely without a link", () => {
    expect(parseRelatedBullet("- [[SM-2]]")).toEqual({ to: "SM-2", reason: null });
    expect(parseRelatedBullet("- plain bullet, no link")).toBeNull();
  });
});

describe("parseLearningNote — end to end", () => {
  const md = [
    "# A2 — Vault reader",
    "",
    "#learning #project/brainquest",
    "Patří k: [[BrainQuest]]",
    "",
    "## 📘 Nové pojmy",
    "- _helper bullet to skip_",
    "- **server action** (serverová akce) — běží na serveru → [[server action]]",
    "- not a term, skipped by the card parser",
    "",
    "## ❓ K probrání příště",
    "- Co je server action?",
    "- Proč je vault read-only?",
  ].join("\n");
  const note = parseLearningNote("2026-06-22-a2-vault-reader", "/vault/learning/a2.md", md, cfg);

  it("fills the note metadata from the right places", () => {
    expect(note.kind).toBe("learning");
    expect(note.title).toBe("A2 — Vault reader");
    expect(note.date).toBe("2026-06-22");
    expect(note.hub).toBe("BrainQuest");
    expect(note.projects).toEqual(["project/brainquest"]);
  });

  it("harvests exactly the one real card, with a stable id and the concept link", () => {
    expect(note.cards).toHaveLength(1);
    expect(note.cards[0]).toMatchObject({
      id: "2026-06-22-a2-vault-reader#c0",
      front: "server action",
      conceptLink: "server action",
      sourceSlug: "2026-06-22-a2-vault-reader",
    });
  });

  it("harvests both recall prompts with stable ids", () => {
    expect(note.recall.map((r) => r.question)).toEqual(["Co je server action?", "Proč je vault read-only?"]);
    expect(note.recall[0].id).toBe("2026-06-22-a2-vault-reader#r0");
  });
});

describe("parseConceptNote — end to end", () => {
  const md = [
    "# Server action",
    "",
    "**server action** (česky: serverová akce) — kód běžící na serveru",
    "",
    "## Související",
    "- [[Next.js]] — kde se používá",
    "- [[server component]]",
    "- plain text, no link",
  ].join("\n");
  const note = parseConceptNote("server-action", "/vault/concepts/server-action.md", md, cfg);

  it("reads title + gloss and builds outgoing edges, skipping link-less bullets", () => {
    expect(note.title).toBe("Server action");
    expect(note.gloss).toBe("server action (česky: serverová akce) — kód běžící na serveru");
    expect(note.edges).toEqual([
      { from: "Server action", to: "Next.js", reason: "kde se používá" },
      { from: "Server action", to: "server component", reason: null },
    ]);
  });
});

describe("YAML frontmatter tolerance (M1)", () => {
  const enCfg: VaultConfig = {
    ...cfg,
    harvest: { cardsHeading: "New concepts", recallHeading: "To review next", relatedHeading: "Related" },
    tags: { hubPrefix: "Belongs to:", projectTagPrefix: "project/" },
  };

  it("reads tags, hub and date from frontmatter when the inline convention is absent", () => {
    const md = [
      "---",
      "tags: [learning, project/demo]",
      "hub: BrainQuest",
      "date: 2026-05-01",
      "---",
      "# Frontmatter note",
      "",
      "## New concepts",
      "- **thing** — a definition",
    ].join("\n");
    const note = parseLearningNote("no-date-slug", "/x.md", md, enCfg);
    expect(note.tags).toEqual(["learning", "project/demo"]);
    expect(note.hub).toBe("BrainQuest");
    expect(note.date).toBe("2026-05-01"); // slug has no date prefix → frontmatter fallback
    expect(note.projects).toEqual(["project/demo"]);
    expect(note.cards).toHaveLength(1);
  });

  it("unwraps a bracketed frontmatter hub and recovers a #-prefixed project tag", () => {
    // Real shared-vault shape: `hub: "[[X]]"` (brackets) + `tags: [learning, "#project/x"]` (leading #).
    const md = [
      "---",
      'tags: [learning, "#project/advanced-topic"]',
      'hub: "[[RL All-in-One Dashboard]]"',
      "---",
      "# FM-only note",
    ].join("\n");
    const note = parseLearningNote("no-date", "/x.md", md, enCfg);
    expect(note.hub).toBe("RL All-in-One Dashboard"); // brackets stripped → matches inline-hub spelling
    expect(note.projects).toEqual(["project/advanced-topic"]); // # stripped → filter matches
  });

  it("keeps inline metadata winning, with frontmatter merged in", () => {
    const md = [
      "---",
      "tags: [fromfm]",
      "---",
      "# Inline wins",
      "#learning",
      "Belongs to: [[InlineHub]]",
    ].join("\n");
    const note = parseLearningNote("2026-01-01-x", "/x.md", md, enCfg);
    expect(note.hub).toBe("InlineHub"); // inline present → used over any frontmatter hub
    expect(note.date).toBe("2026-01-01"); // slug date wins
    expect(note.tags).toEqual(["learning", "fromfm"]); // union
  });
});

describe("classifyNote", () => {
  const enCfg: VaultConfig = {
    ...cfg,
    harvest: { cardsHeading: "New concepts", recallHeading: "To review next", relatedHeading: "Related" },
  };
  it("calls a note with cards or recall 'learning', otherwise 'concept'", () => {
    expect(classifyNote("# N\n## New concepts\n- **t** — d", enCfg)).toBe("learning");
    expect(classifyNote("# N\n## To review next\n- q?", enCfg)).toBe("learning");
    expect(classifyNote("# Token\n**token** — a unit\n## Related\n- [[x]]", enCfg)).toBe("concept");
  });
});

describe("slugify + splitDocIntoNotes", () => {
  it("slugify makes a filename-safe slug", () => {
    expect(slugify("Hello, World! (v2)")).toBe("hello-world-v2");
    expect(slugify("  A__B  ")).toBe("a-b");
  });

  it("splits a doc into notes on H1 headings, ignoring a preamble", () => {
    const doc = ["intro preamble", "# First", "body 1", "# Second", "body 2"].join("\n");
    const sections = splitDocIntoNotes(doc);
    expect(sections.map((s) => s.title)).toEqual(["First", "Second"]);
    expect(sections.map((s) => s.slug)).toEqual(["first", "second"]);
    expect(sections[0].body).toBe("# First\nbody 1");
  });

  it("keeps slugs unique when titles collide or slugify to nothing", () => {
    const doc = ["# Setup", "a", "# Setup", "b", "# 🎯", "c"].join("\n");
    // duplicate "Setup" → suffixed; emoji-only title → positional fallback (never an empty slug)
    expect(splitDocIntoNotes(doc).map((s) => s.slug)).toEqual(["setup", "setup-2", "section-3"]);
  });
});
