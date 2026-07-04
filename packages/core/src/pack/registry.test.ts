import { describe, expect, it } from "vitest";
import type { Pack, PackManifest } from "./types";
import {
  emptyRegistry,
  installedFromPack,
  parseRegistry,
  removePack,
  reviewsKeyFor,
  setActive,
  upsertPack,
  type InstalledPack,
} from "./registry";

/** A tiny valid pack with a given manifest id + a couple of cards, for count assertions. */
function makePack(id: string, cardCounts: number[] = [2, 1]): Pack {
  const manifest: PackManifest = {
    id,
    name: `Pack ${id}`,
    lang: "en",
    version: "1.0.0",
    author: "Tester",
    license: "All rights reserved",
    description: "test",
  };
  const notes = cardCounts.map((n, i) => ({
    slug: `${id}-note-${i}`,
    title: `Note ${i}`,
    date: null,
    tags: [],
    hub: null,
    projects: [],
    body: "body",
    cards: Array.from({ length: n }, (_, c) => ({ front: `q${c}`, back: `a${c}`, conceptLink: null })),
    recall: [],
  }));
  return { format: 1, manifest, notes, concepts: [] };
}

const ENTRY = (id: string, source: "builtin" | "imported" = "imported"): InstalledPack => ({
  id,
  name: `Pack ${id}`,
  lang: "en",
  version: "1.0.0",
  author: "Tester",
  source,
  addedAt: source === "builtin" ? null : "2026-07-04T00:00:00.000Z",
  notes: 1,
  concepts: 0,
  cards: 1,
});

describe("reviewsKeyFor", () => {
  it("namespaces the review store per pack id", () => {
    expect(reviewsKeyFor("python-core")).toBe("reviews:python-core");
    expect(reviewsKeyFor("a")).not.toBe(reviewsKeyFor("b"));
  });
});

describe("installedFromPack", () => {
  it("derives id/name/counts from the pack, with addedAt as given", () => {
    const e = installedFromPack(makePack("demo", [3, 2]), "imported", "2026-07-04T10:00:00.000Z");
    expect(e).toMatchObject({ id: "demo", name: "Pack demo", source: "imported", notes: 2, concepts: 0, cards: 5 });
    expect(e.addedAt).toBe("2026-07-04T10:00:00.000Z");
  });

  it("marks a built-in with a null addedAt", () => {
    expect(installedFromPack(makePack("builtin"), "builtin", null).addedAt).toBeNull();
  });
});

describe("parseRegistry", () => {
  it("returns an empty registry for junk", () => {
    for (const junk of [null, undefined, 42, "x", {}]) {
      expect(parseRegistry(junk)).toEqual(emptyRegistry());
    }
  });

  it("drops malformed entries and de-dupes by id (last wins)", () => {
    const raw = {
      activeId: "a",
      packs: [
        ENTRY("a"),
        { id: "" }, // no id → dropped
        { nope: true }, // garbage → dropped
        { ...ENTRY("a"), name: "Renamed" }, // duplicate id → replaces
      ],
    };
    const reg = parseRegistry(raw);
    expect(reg.packs).toHaveLength(1);
    expect(reg.packs[0].name).toBe("Renamed");
    expect(reg.activeId).toBe("a");
  });

  it("repairs an activeId that points at no installed pack", () => {
    const reg = parseRegistry({ activeId: "ghost", packs: [ENTRY("real")] });
    expect(reg.activeId).toBe("real");
  });

  it("defaults missing display fields on a sparse entry", () => {
    const reg = parseRegistry({ activeId: "x", packs: [{ id: "x", source: "imported" }] });
    expect(reg.packs[0]).toMatchObject({ id: "x", name: "x", notes: 0, concepts: 0, cards: 0, addedAt: null });
  });
});

describe("upsertPack", () => {
  it("appends a new pack and makes the first one active", () => {
    const reg = upsertPack(emptyRegistry(), ENTRY("first"));
    expect(reg.packs.map((p) => p.id)).toEqual(["first"]);
    expect(reg.activeId).toBe("first");
  });

  it("replaces an existing entry without changing the active selection", () => {
    let reg = upsertPack(emptyRegistry(), ENTRY("a"));
    reg = upsertPack(reg, ENTRY("b"));
    reg = setActive(reg, "b");
    reg = upsertPack(reg, { ...ENTRY("a"), version: "2.0.0" });
    expect(reg.packs).toHaveLength(2);
    expect(reg.packs.find((p) => p.id === "a")!.version).toBe("2.0.0");
    expect(reg.activeId).toBe("b");
  });
});

describe("setActive", () => {
  it("switches to an installed pack, ignores an unknown id", () => {
    const reg = upsertPack(upsertPack(emptyRegistry(), ENTRY("a")), ENTRY("b"));
    expect(setActive(reg, "b").activeId).toBe("b");
    expect(setActive(reg, "ghost").activeId).toBe("a");
  });
});

describe("removePack", () => {
  it("removes a non-active pack and keeps the active selection", () => {
    let reg = upsertPack(upsertPack(emptyRegistry(), ENTRY("a")), ENTRY("b"));
    reg = removePack(reg, "b");
    expect(reg.packs.map((p) => p.id)).toEqual(["a"]);
    expect(reg.activeId).toBe("a");
  });

  it("falls back to the first remaining pack when the active one is removed", () => {
    let reg = upsertPack(upsertPack(emptyRegistry(), ENTRY("a")), ENTRY("b"));
    reg = setActive(reg, "a");
    reg = removePack(reg, "a");
    expect(reg.activeId).toBe("b");
  });

  it("empties activeId when the last pack is removed", () => {
    let reg = upsertPack(emptyRegistry(), ENTRY("only"));
    reg = removePack(reg, "only");
    expect(reg).toEqual(emptyRegistry());
  });
});
