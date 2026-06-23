// Tests for the tutor area filter (D2.1). It maps a note's project tag to a focusable "area" so the
// cross-project vault doesn't drown the learner; the load-bearing rule is that RL is OFF by default while
// everything else is ON, and a note with no project tag still shows up ("other", kept on).
import { describe, expect, it } from "vitest";
import { areaForProjects, type AreaConfig } from "./area";

// The `vault` area config (E1 lifted these out of the module into vault.config.json).
const cfg: AreaConfig = {
  tags: { projectTagPrefix: "project/" },
  areas: {
    labels: { "brainquest": "BrainQuest", example-project: "Example Project", "advanced-topic": "Advanced Topic", "advanced-topic": "RL" },
    offByDefault: ["advanced-topic"],
  },
};

describe("areaForProjects", () => {
  it("maps known projects to friendly labels, all on by default", () => {
    expect(areaForProjects(["project/brainquest"], cfg)).toEqual({ key: "brainquest", label: "BrainQuest", defaultOn: true });
    expect(areaForProjects(["project/example-project"], cfg)).toMatchObject({ label: "Example Project", defaultOn: true });
    expect(areaForProjects(["project/advanced-topic"], cfg)).toMatchObject({ label: "Advanced Topic", defaultOn: true });
  });

  it("hides RL by default (the niche/deep area you opt into)", () => {
    expect(areaForProjects(["project/advanced-topic"], cfg)).toEqual({ key: "advanced-topic", label: "RL", defaultOn: false });
  });

  it("buckets a note with no project tag into 'other', kept on so nothing silently vanishes", () => {
    expect(areaForProjects([], cfg)).toEqual({ key: "other", label: "Other", defaultOn: true });
  });

  it("prettifies an unknown project slug into a label", () => {
    expect(areaForProjects(["project/some-new-thing"], cfg)).toMatchObject({ key: "some-new-thing", label: "Some New Thing" });
  });

  it("uses the first project/ tag when a note carries several", () => {
    expect(areaForProjects(["project/brainquest", "project/example-project"], cfg).key).toBe("brainquest");
  });

  it("honors a different brain's tag prefix and labels from config", () => {
    const other: AreaConfig = { tags: { projectTagPrefix: "area:" }, areas: { labels: { math: "Mathematics" }, offByDefault: ["math"] } };
    expect(areaForProjects(["area:math"], other)).toEqual({ key: "math", label: "Mathematics", defaultOn: false });
  });
});
