// PURE area mapping for the tutor's category filter — no fs, no React, so it's trivially testable and
// shared by the page (which tags each prompt) and any later config. An "area" = the project a recall
// prompt's source note belongs to. The vault is cross-project, so without this the tutor mixes RL,
// Example Project, Advanced Topic and BrainQuest together; the filter lets the learner focus and skip the niche.
export interface TutorAreaDef {
  /** Stable key (the project slug without the "project/" prefix), e.g. "brainquest", "advanced-topic". */
  key: string;
  /** Learner-facing label shown on the toggle chip. */
  label: string;
  /** Whether this area is ON by default (niche/deep areas are opt-in → off). */
  defaultOn: boolean;
}

/** Friendly labels for the known projects; unknown slugs are prettified from the slug. */
const LABELS: Record<string, string> = {
  "brainquest": "BrainQuest",
  "example-project": "Example Project",
  "advanced-topic": "Advanced Topic",
  "advanced-topic": "RL",
};

/** Areas hidden by default — niche/deep material the learner opts into rather than wades through. */
const OFF_BY_DEFAULT = new Set(["advanced-topic"]);

/** Bucket for a note with no project tag at all. */
const OTHER_KEY = "other";

/** "advanced-topic" → "Example Advanced Topic" (only used for projects without an explicit label). */
function prettify(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Map a learning note's project tags to a single tutor area. The first `project/…` tag wins (notes
 * carry one in practice); a note with none falls into "other" (kept ON, so nothing silently vanishes).
 */
export function areaForProjects(projects: string[]): TutorAreaDef {
  const tag = projects.find((p) => p.startsWith("project/")) ?? projects[0];
  const slug = tag ? tag.replace(/^project\//, "") : OTHER_KEY;
  return { key: slug, label: LABELS[slug] ?? prettify(slug), defaultOn: !OFF_BY_DEFAULT.has(slug) };
}
