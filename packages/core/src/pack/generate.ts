// AI pack-generation layer (M4.1) — the PURE half: the LLM output contracts (JSON schemas + typed shapes),
// the prompt builders, and the markdown emitters. NO fs and NO network here, so every piece is unit-testable
// and the emit → parse round-trip is proven deterministically (generate.test.ts). The impure orchestrator
// (tools/generate-pack.mts) makes the LLM calls and writes the files.
//
// The design (masterplan pillar 2): AI drafts EDITABLE vault-shaped markdown, a human curates it in Obsidian,
// and the EXISTING compiler (compile-pack.mts) validates + compiles it. The AI never emits the final pack.json
// directly — keeping the deterministic, validated path unchanged and the author in the loop.
//
// Generation is staged for quality and cost (small, focused calls beat one mega-call):
//   1. outline  — the whole pack's concept list + the prerequisite DAG + how concepts group into lessons.
//   2. concept  — one call per concept → its explanatory body.
//   3. lesson   — one call per lesson → its cards (term/gloss/definition + the concept SLUG it teaches) + recall.
//
// Concept links are correct BY CONSTRUCTION: the lesson stage returns each card's `conceptSlug` chosen from a
// constrained enum (the lesson's own concept slugs), which the schema enforces — so `→ [[concept]]` resolves
// deterministically (slug → title) instead of guessing from free text.
import { slugify } from "../vault/parse";

/* ------------------------------------------------------------------ stage output contracts (types) --- */

/** One concept in the outline: its identity, a one-line gloss, and the concepts it builds on (its prereqs). */
export interface OutlineConcept {
  /** Stable kebab-case id, unique within the pack (keys the file name + wikilink resolution). */
  slug: string;
  title: string;
  /** One-sentence definition (becomes the concept note's gloss line + the source for cards). */
  gloss: string;
  /** Slugs of the concepts this one depends on — the DIRECTED prerequisite edges (this → prereq). */
  prerequisites: string[];
}

/** A lesson groups a few related concepts into one learning note (the unit that harvests cards + recall). */
export interface OutlineLesson {
  slug: string;
  title: string;
  /** Slugs of the concepts this lesson teaches (order = teaching order within the lesson). */
  conceptSlugs: string[];
}

/** Stage 1 output: the whole pack skeleton + its prerequisite graph, before any prose is written. */
export interface PackOutline {
  concepts: OutlineConcept[];
  lessons: OutlineLesson[];
}

/** Stage 2 output for one concept: its body, as a list of paragraphs (joined with blank lines on emit). */
export interface ConceptBody {
  paragraphs: string[];
}

/** One generated flashcard (stage 3), before it's rendered to the `- **term** (gloss) — def → [[concept]]` line. */
export interface GenCard {
  term: string;
  gloss: string;
  definition: string;
  /** The SLUG of the concept this card teaches (chosen from the lesson's concepts; rendered as `→ [[title]]`). */
  conceptSlug: string;
}

/** Stage 3 output for one lesson: a short intro, its cards, and open recall prompts. */
export interface GenLesson {
  intro: string;
  cards: GenCard[];
  recall: string[];
}

/* ---------------------------------------------------------------------------- JSON schemas (per stage) --- */
// Passed to the LLM transport as the structured-output constraint (Ollama `format` / Anthropic `input_schema`
// / OpenAI guidance). Plain JSON Schema objects so all three providers accept them.

export const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slug: { type: "string" },
          title: { type: "string" },
          gloss: { type: "string" },
          prerequisites: { type: "array", items: { type: "string" } },
        },
        required: ["slug", "title", "gloss", "prerequisites"],
      },
    },
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slug: { type: "string" },
          title: { type: "string" },
          conceptSlugs: { type: "array", items: { type: "string" } },
        },
        required: ["slug", "title", "conceptSlugs"],
      },
    },
  },
  required: ["concepts", "lessons"],
} as const;

export const CONCEPT_SCHEMA = {
  type: "object",
  properties: { paragraphs: { type: "array", items: { type: "string" } } },
  required: ["paragraphs"],
} as const;

/**
 * Build the lesson schema for a specific lesson: `conceptSlug` is constrained to that lesson's own concept
 * slugs (a JSON-Schema enum) so a provider that enforces the schema (Ollama, Anthropic tool input) can only
 * emit a real slug → the `→ [[concept]]` link resolves by construction, no fuzzy matching.
 */
export function lessonSchema(conceptSlugs: string[]) {
  return {
    type: "object",
    properties: {
      intro: { type: "string" },
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term: { type: "string" },
            gloss: { type: "string" },
            definition: { type: "string" },
            conceptSlug: conceptSlugs.length ? { type: "string", enum: conceptSlugs } : { type: "string" },
          },
          required: ["term", "gloss", "definition", "conceptSlug"],
        },
      },
      recall: { type: "array", items: { type: "string" } },
    },
    required: ["intro", "cards", "recall"],
  };
}

/* ---------------------------------------------------------- runtime guards (LLMs lie about their schema) --- */

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${what}: expected an object, got ${Array.isArray(value) ? "an array" : typeof value}.`);
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${what}: expected an array of strings.`);
  return value.map((v, i) => {
    if (typeof v !== "string") throw new Error(`${what}[${i}]: expected a string.`);
    return v;
  });
}

function reqString(rec: Record<string, unknown>, key: string, what: string): string {
  const v = rec[key];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${what}: "${key}" must be a non-empty string.`);
  return v;
}

/** Validate + narrow a raw LLM reply into a PackOutline (throws a helpful message on any shape mismatch). */
export function parseOutline(value: unknown): PackOutline {
  const rec = asRecord(value, "outline");
  if (!Array.isArray(rec.concepts)) throw new Error("outline: `concepts` must be an array.");
  if (!Array.isArray(rec.lessons)) throw new Error("outline: `lessons` must be an array.");
  const concepts = rec.concepts.map((c, i): OutlineConcept => {
    const o = asRecord(c, `outline.concepts[${i}]`);
    return {
      slug: reqString(o, "slug", `outline.concepts[${i}]`),
      title: reqString(o, "title", `outline.concepts[${i}]`),
      gloss: reqString(o, "gloss", `outline.concepts[${i}]`),
      prerequisites: asStringArray(o.prerequisites ?? [], `outline.concepts[${i}].prerequisites`),
    };
  });
  const lessons = rec.lessons.map((l, i): OutlineLesson => {
    const o = asRecord(l, `outline.lessons[${i}]`);
    return {
      slug: reqString(o, "slug", `outline.lessons[${i}]`),
      title: reqString(o, "title", `outline.lessons[${i}]`),
      conceptSlugs: asStringArray(o.conceptSlugs ?? [], `outline.lessons[${i}].conceptSlugs`),
    };
  });
  return { concepts, lessons };
}

/** Validate + narrow a raw LLM reply into a ConceptBody. */
export function parseConceptBody(value: unknown): ConceptBody {
  const rec = asRecord(value, "concept");
  return { paragraphs: asStringArray(rec.paragraphs ?? [], "concept.paragraphs") };
}

/** Validate + narrow a raw LLM reply into a GenLesson. */
export function parseGenLesson(value: unknown): GenLesson {
  const rec = asRecord(value, "lesson");
  if (!Array.isArray(rec.cards)) throw new Error("lesson: `cards` must be an array.");
  const cards = rec.cards.map((c, i): GenCard => {
    const o = asRecord(c, `lesson.cards[${i}]`);
    return {
      term: reqString(o, "term", `lesson.cards[${i}]`),
      gloss: reqString(o, "gloss", `lesson.cards[${i}]`),
      definition: reqString(o, "definition", `lesson.cards[${i}]`),
      conceptSlug: reqString(o, "conceptSlug", `lesson.cards[${i}]`),
    };
  });
  return {
    intro: typeof rec.intro === "string" ? rec.intro : "",
    cards,
    recall: asStringArray(rec.recall ?? [], "lesson.recall"),
  };
}

/* ------------------------------------------------------------------------------ outline normalization --- */

/** A slug reference the LLM produced that pointed at nothing real, dropped during normalization. */
export interface DroppedRef {
  kind: "prerequisite" | "lesson-concept";
  /** The concept/lesson slug that owned the bad reference. */
  owner: string;
  /** The unresolved slug that was dropped. */
  slug: string;
}

/** Make a de-duplicating, filename-safe slug assigner (mirrors splitDocIntoNotes' collision handling). */
function slugAssigner(): (base: string, fallback: string) => string {
  const used = new Map<string, number>();
  return (base, fallback) => {
    const b = slugify(base) || fallback;
    const seen = used.get(b) ?? 0;
    used.set(b, seen + 1);
    return seen === 0 ? b : `${b}-${seen + 1}`;
  };
}

/**
 * Normalize a raw outline so downstream code is safe and consistent:
 * - every concept/lesson slug is run through `slugify` + de-duplicated → filename-safe (no `/`, `..`, spaces),
 *   so `concepts/<slug>.md` can never escape the output dir or silently overwrite a sibling;
 * - prerequisite + lesson conceptSlug references are remapped to the sanitized slugs, and any that point at a
 *   concept that doesn't exist are DROPPED and reported (so the caller can warn loudly instead of the edge
 *   vanishing silently). Pure — no fs.
 */
export function normalizeOutline(raw: PackOutline): { outline: PackOutline; dropped: DroppedRef[] } {
  const dropped: DroppedRef[] = [];
  const conceptSlugOf = slugAssigner();
  // old slug → new slug (for remapping references). A duplicate old slug maps to its first sanitized form.
  const remap = new Map<string, string>();
  const concepts = raw.concepts.map((c, i) => {
    const slug = conceptSlugOf(c.slug, `concept-${i + 1}`);
    if (!remap.has(c.slug)) remap.set(c.slug, slug);
    return { ...c, slug };
  });
  const known = new Set(concepts.map((c) => c.slug));

  const resolvedConcepts = concepts.map((c) => {
    const prerequisites: string[] = [];
    for (const p of c.prerequisites) {
      const mapped = remap.get(p);
      if (mapped && mapped !== c.slug && known.has(mapped)) prerequisites.push(mapped);
      else dropped.push({ kind: "prerequisite", owner: c.slug, slug: p });
    }
    return { ...c, prerequisites: [...new Set(prerequisites)] };
  });

  const lessonSlugOf = slugAssigner();
  const lessons = raw.lessons.map((l, i) => {
    const slug = lessonSlugOf(l.slug, `lesson-${i + 1}`);
    const conceptSlugs: string[] = [];
    for (const s of l.conceptSlugs) {
      const mapped = remap.get(s);
      if (mapped && known.has(mapped)) conceptSlugs.push(mapped);
      else dropped.push({ kind: "lesson-concept", owner: slug, slug: s });
    }
    return { ...l, slug, conceptSlugs: [...new Set(conceptSlugs)] };
  });

  return { outline: { concepts: resolvedConcepts, lessons }, dropped };
}

/* --------------------------------------------------------------------------------- prompt builders --- */
// System = the role + hard rules; user = the concrete task. Kept separate so the transport can cache/pin them.

const AUTHOR_RULES =
  "You are an expert curriculum designer building a spaced-repetition learning pack. " +
  "Prefer precise, self-contained explanations over vague ones. Never invent facts you are unsure of. " +
  "Every definition must stand on its own without external links.";

export function outlineSystem(lang: string): string {
  return `${AUTHOR_RULES} Write ALL content in ${lang}. You are designing the pack's concept map: the list of\n` +
    "concepts to teach, a ONE-SENTENCE gloss for each, the PREREQUISITE edges (which concept must be understood\n" +
    "before which — a directed acyclic graph, no cycles), and how concepts group into short lessons. Order\n" +
    "concepts foundation-first. Use stable kebab-case slugs (e.g. \"neural-network\"). Prerequisites reference\n" +
    "other concepts by their slug; a foundational concept has an empty prerequisites list.";
}

export function outlineUser(opts: {
  topic: string;
  audience: string;
  conceptCount: number;
  seed?: string;
}): string {
  const lines = [
    `Topic: ${opts.topic}`,
    `Audience: ${opts.audience}`,
    `Produce about ${opts.conceptCount} concepts, grouped into lessons of 3–6 concepts each.`,
  ];
  if (opts.seed && opts.seed.trim()) {
    lines.push("", "Ground the pack in this source material (extract concepts from it, don't contradict it):", "---", opts.seed.trim());
  }
  return lines.join("\n");
}

export function conceptSystem(lang: string): string {
  return `${AUTHOR_RULES} Write ALL content in ${lang}. Explain ONE concept clearly: 2–4 short paragraphs — a\n` +
    "self-contained definition, why it matters, and a concrete example. Plain prose, no headings, no bullet lists.";
}

export function conceptUser(opts: { title: string; gloss: string; topic: string; prereqTitles: string[] }): string {
  const lines = [`Pack topic: ${opts.topic}`, `Concept: ${opts.title}`, `Gloss: ${opts.gloss}`];
  if (opts.prereqTitles.length) lines.push(`The reader already knows: ${opts.prereqTitles.join(", ")}.`);
  return lines.join("\n");
}

export function lessonSystem(lang: string): string {
  return `${AUTHOR_RULES} Write ALL content in ${lang}. Turn a lesson's concepts into flashcards and recall\n` +
    "prompts. Each card: a short term (front), a one-line gloss, and a self-contained definition (back). Set each\n" +
    "card's \"conceptSlug\" to the slug (shown in [brackets]) of the concept the card teaches — it MUST be one of\n" +
    "the listed slugs. Recall prompts are OPEN questions the learner answers in their own words (not yes/no). Make\n" +
    "one card per concept at minimum; add a few deeper cards where useful.";
}

export function lessonUser(opts: {
  title: string;
  topic: string;
  concepts: { slug: string; title: string; gloss: string }[];
}): string {
  return [
    `Pack topic: ${opts.topic}`,
    `Lesson: ${opts.title}`,
    "Concepts to teach (use the [slug] as conceptSlug):",
    ...opts.concepts.map((c) => `- [${c.slug}] ${c.title}: ${c.gloss}`),
  ].join("\n");
}

/* ------------------------------------------------------------------------------------ markdown emit --- */

/** Collapse any whitespace (incl. newlines) to single spaces — bullets MUST be one physical line to harvest. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** A draft file to write: a vault-relative path (`learning/…` or `concepts/…`) and its markdown content. */
export interface DraftFile {
  relPath: string;
  content: string;
}

/** Everything buildDraftFiles needs: the outline, the per-concept bodies, the per-lesson content + manifest bits. */
export interface DraftInput {
  /** MUST be a normalized outline (see normalizeOutline) — slugs are filename-safe + unique, refs resolved. */
  outline: PackOutline;
  /** slug → generated body paragraphs. */
  conceptBodies: Record<string, ConceptBody>;
  /** slug → generated lesson content. */
  lessons: Record<string, GenLesson>;
  /** Pack id → the `project/<id>` tag; pack name → the `Belongs to: [[name]]` hub, so notes group. */
  packId: string;
  packName: string;
  lang: string;
}

/** Render one concept note in the exact harvest convention (gloss line first so parseGloss finds it). */
export function emitConceptNote(
  concept: OutlineConcept,
  body: ConceptBody,
  ctx: { projectSlug: string; titleBySlug: Map<string, string> },
): string {
  const parts: string[] = [`# ${oneLine(concept.title)}`, "", `#concept #project/${ctx.projectSlug}`, ""];
  parts.push(`**${oneLine(concept.title)}** — ${oneLine(concept.gloss)}`, "");
  for (const p of body.paragraphs) {
    const line = p.trim();
    if (line) parts.push(line, "");
  }
  // Prerequisites → directed "Related" edges (this concept → the concept it builds on). Asymmetric on purpose:
  // that is what makes the graph a real dependency DAG the compiler can cycle-check (validate.ts header).
  const prereqTitles = concept.prerequisites
    .map((slug) => ctx.titleBySlug.get(slug))
    .filter((t): t is string => Boolean(t));
  if (prereqTitles.length) {
    parts.push("## Related");
    for (const t of prereqTitles) parts.push(`- [[${t}]] — prerequisite`);
    parts.push("");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Render one lesson note (its cards + recall prompts) in the exact harvest convention. */
export function emitLessonNote(
  lesson: OutlineLesson,
  content: GenLesson,
  ctx: { projectSlug: string; hub: string; titleBySlug: Map<string, string> },
): string {
  const parts: string[] = [
    `# ${oneLine(lesson.title)}`,
    "",
    `#learning #project/${ctx.projectSlug}`,
    "",
    `Belongs to: [[${oneLine(ctx.hub)}]]`,
    "",
  ];
  if (content.intro.trim()) parts.push(content.intro.trim(), "");
  parts.push("## 📘 New concepts");
  for (const c of content.cards) {
    // conceptSlug came from the constrained enum → resolve to the concept's title; fall back to the raw slug
    // (the compiler then flags it as a missing link, visibly, rather than a card pointing nowhere).
    const title = ctx.titleBySlug.get(c.conceptSlug) ?? c.conceptSlug;
    parts.push(`- **${oneLine(c.term)}** (${oneLine(c.gloss)}) — ${oneLine(c.definition)} → [[${oneLine(title)}]]`);
  }
  parts.push("", "## ❓ To review next");
  for (const q of content.recall) parts.push(`- ${oneLine(q)}`);
  parts.push("");
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Assemble the full set of draft files for a generated pack (pure). Concepts → `concepts/<slug>.md`, lessons →
 * `learning/<slug>.md` — a vault-shaped folder the existing compiler reads in "vault" mode. Expects a NORMALIZED
 * outline (slugs filename-safe + unique). A concept with no generated body, or a lesson with no generated
 * content, is skipped (the orchestrator logs what was missing).
 */
export function buildDraftFiles(input: DraftInput): DraftFile[] {
  const titleBySlug = new Map(input.outline.concepts.map((c) => [c.slug, c.title]));
  const files: DraftFile[] = [];
  for (const c of input.outline.concepts) {
    const body = input.conceptBodies[c.slug];
    if (!body) continue;
    files.push({
      relPath: `concepts/${c.slug}.md`,
      content: emitConceptNote(c, body, { projectSlug: input.packId, titleBySlug }),
    });
  }
  for (const l of input.outline.lessons) {
    const content = input.lessons[l.slug];
    if (!content) continue;
    files.push({
      relPath: `learning/${l.slug}.md`,
      content: emitLessonNote(l, content, { projectSlug: input.packId, hub: input.packName, titleBySlug }),
    });
  }
  return files;
}
