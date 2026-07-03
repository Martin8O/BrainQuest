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
//   3. lesson   — one call per lesson → its cards (term/gloss/definition/→concept) + open recall prompts.

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
  /** The concept title/slug this card points at (rendered as `→ [[concept]]`). */
  concept: string;
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

export const LESSON_SCHEMA = {
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
          concept: { type: "string" },
        },
        required: ["term", "gloss", "definition", "concept"],
      },
    },
    recall: { type: "array", items: { type: "string" } },
  },
  required: ["intro", "cards", "recall"],
} as const;

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
      concept: reqString(o, "concept", `lesson.cards[${i}]`),
    };
  });
  return {
    intro: typeof rec.intro === "string" ? rec.intro : "",
    cards,
    recall: asStringArray(rec.recall ?? [], "lesson.recall"),
  };
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
    "prompts. Each card: a short term (front), a one-line gloss, and a self-contained definition (back). The\n" +
    "card's \"concept\" field MUST be EXACTLY one of the concept titles listed below, copied verbatim — no gloss,\n" +
    "no extra words. Recall prompts are OPEN questions the learner answers in their own words (not yes/no). Make\n" +
    "one card per concept at minimum; add a few deeper cards where useful.";
}

export function lessonUser(opts: { title: string; topic: string; concepts: { title: string; gloss: string }[] }): string {
  return [
    `Pack topic: ${opts.topic}`,
    `Lesson: ${opts.title}`,
    "Concepts to teach:",
    ...opts.concepts.map((c) => `- ${c.title}: ${c.gloss}`),
  ].join("\n");
}

/* ------------------------------------------------------------------------------------ markdown emit --- */

/** Collapse any whitespace (incl. newlines) to single spaces — bullets MUST be one physical line to harvest. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Reconcile an LLM-supplied card "concept" value to a real concept title so the `→ [[concept]]` link resolves.
 * Local models often ignore "copy the title verbatim" and emit "Title: gloss" or a near-miss; this maps such
 * values back to the canonical title (exact → title-before-a-separator → prefix → containment). Returns the raw
 * value trimmed if nothing matches (the compiler then reports it as a missing-link, as it should). Pure.
 */
export function matchConceptTitle(raw: string, titles: string[]): string {
  const r = raw.trim().toLowerCase();
  const exact = titles.find((t) => t.toLowerCase() === r);
  if (exact) return exact;
  // Models frequently prepend the title then ": gloss" / " — gloss": match on the part before the separator.
  const head = raw.split(/[:—–-]/)[0].trim().toLowerCase();
  const byHead = titles.find((t) => t.toLowerCase() === head);
  if (byHead) return byHead;
  const byPrefix = titles.find((t) => r.startsWith(t.toLowerCase()) || t.toLowerCase() === head);
  if (byPrefix) return byPrefix;
  const byContain = titles.find((t) => r.includes(t.toLowerCase()));
  if (byContain) return byContain;
  return raw.trim();
}

/** A draft file to write: a vault-relative path (`learning/…` or `concepts/…`) and its markdown content. */
export interface DraftFile {
  relPath: string;
  content: string;
}

/** Everything buildDraftFiles needs: the outline, the per-concept bodies, the per-lesson content + manifest bits. */
export interface DraftInput {
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
  ctx: { projectSlug: string; hub: string; conceptTitles: string[] },
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
    const concept = matchConceptTitle(c.concept, ctx.conceptTitles);
    parts.push(`- **${oneLine(c.term)}** (${oneLine(c.gloss)}) — ${oneLine(c.definition)} → [[${oneLine(concept)}]]`);
  }
  parts.push("", "## ❓ To review next");
  for (const q of content.recall) parts.push(`- ${oneLine(q)}`);
  parts.push("");
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Assemble the full set of draft files for a generated pack (pure). Concepts → `concepts/<slug>.md`, lessons →
 * `learning/<slug>.md` — a vault-shaped folder the existing compiler reads in "vault" mode. A concept with no
 * generated body, or a lesson with no generated content, is skipped (the orchestrator logs what was missing).
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
  const conceptTitles = input.outline.concepts.map((c) => c.title);
  for (const l of input.outline.lessons) {
    const content = input.lessons[l.slug];
    if (!content) continue;
    files.push({
      relPath: `learning/${l.slug}.md`,
      content: emitLessonNote(l, content, { projectSlug: input.packId, hub: input.packName, conceptTitles }),
    });
  }
  return files;
}
