// Unit tests for the vault parser — the other risky logic E2 names. The whole app is downstream of
// these regexes: a parser that quietly mis-harvests one bullet poisons every card, edge and concept.
// parse.ts is pure (no fs), so we feed it strings and assert the exact harvested shape.
import { describe, expect, it } from "vitest";
import type { VaultConfig } from "./config";
import {
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
} from "./parse";

const cfg: VaultConfig = {
  vaultPath: "/vault",
  folders: { learning: "learning", concepts: "concepts" },
  harvest: { cardsHeading: "📘 Nové pojmy", recallHeading: "❓ K probrání příště", relatedHeading: "Související" },
  tags: { hubPrefix: "Patří k:", projectTagPrefix: "project/" },
  areas: { labels: {}, offByDefault: [] },
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
