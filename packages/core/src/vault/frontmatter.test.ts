import { describe, expect, it } from "vitest";
import { frontmatterList, frontmatterScalar, splitFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  it("returns the note unchanged when there is no frontmatter", () => {
    const md = "# Title\n\nbody text";
    expect(splitFrontmatter(md)).toEqual({ data: {}, body: md });
  });

  it("parses scalars, inline lists, and block lists, and strips the block from the body", () => {
    const md = [
      "---",
      "title: My Note",
      "hub: BrainQuest",
      "tags: [learning, project/demo]",
      "authors:",
      "  - Alice",
      "  - Bob",
      "---",
      "# My Note",
      "body",
    ].join("\n");
    const { data, body } = splitFrontmatter(md);
    expect(data.title).toBe("My Note");
    expect(data.hub).toBe("BrainQuest");
    expect(data.tags).toEqual(["learning", "project/demo"]);
    expect(data.authors).toEqual(["Alice", "Bob"]);
    expect(body).toBe("# My Note\nbody");
  });

  it("strips quotes and ignores unrecognized lines", () => {
    const md = ['---', 'name: "Quoted"', "weird nonsense line", "---", "body"].join("\n");
    const { data } = splitFrontmatter(md);
    expect(data.name).toBe("Quoted");
    expect(data.weird).toBeUndefined();
  });

  it("frontmatterList splits a scalar and drops leading # (scalar AND array items)", () => {
    expect(frontmatterList({ tags: "#a #b" }, "tags")).toEqual(["a", "b"]);
    expect(frontmatterList({ tags: ["x", "y"] }, "tags")).toEqual(["x", "y"]);
    // array items with a leading # (e.g. `tags: [learning, "#project/x"]`) normalize like inline #tags
    expect(frontmatterList({ tags: ["learning", "#project/x"] }, "tags")).toEqual(["learning", "project/x"]);
    expect(frontmatterList({}, "tags")).toEqual([]);
  });

  it("frontmatterScalar returns a scalar or the first list element", () => {
    expect(frontmatterScalar({ hub: "H" }, "hub")).toBe("H");
    expect(frontmatterScalar({ hub: ["H1", "H2"] }, "hub")).toBe("H1");
    expect(frontmatterScalar({}, "hub")).toBeNull();
  });
});
