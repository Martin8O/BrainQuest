// Shared vault contracts — the single shape the reader produces and the UI consumes.
// (Contracts in one place: when the parser or a page changes shape, change it here.)

/** Common metadata for any note read from the vault. */
export interface VaultNoteBase {
  /** File name without the .md extension, e.g. "2026-06-11-a1-a2-toolchain-scaffold". */
  slug: string;
  /** Absolute path on disk. Server-only — never rendered as a link target in the client. */
  path: string;
  /** H1 title ("# …"), falling back to the slug when missing. */
  title: string;
  /** Inline #tags found near the top of the note (without the leading "#"). */
  tags: string[];
}

/** One flashcard harvested from a "📘 Nové pojmy" bullet. */
export interface Card {
  /** Stable, deterministic id: `${sourceSlug}#c${index}`. */
  id: string;
  /** The English term you try to recall (the bold part of the bullet). */
  front: string;
  /** The Czech gloss + definition — the answer revealed after recall. */
  back: string;
  /** The `→ [[concept]]` this card points to (its node in the graph), or null. */
  conceptLink: string | null;
  /** Slug of the learning note this card came from. */
  sourceSlug: string;
  /** Absolute path of the source note (server-only). */
  sourcePath: string;
}

/** One open recall prompt harvested from a "❓ K probrání příště" bullet. */
export interface RecallPrompt {
  /** Stable, deterministic id: `${sourceSlug}#r${index}`. */
  id: string;
  question: string;
  sourceSlug: string;
  sourcePath: string;
}

/** A directed prerequisite/relation edge between two concepts (from a "Související" bullet). */
export interface ConceptEdge {
  /** Source concept title (the note the edge lives in). */
  from: string;
  /** Target concept title (the [[wikilink]]). */
  to: string;
  /** Why they relate — the text after the em dash, if any. */
  reason: string | null;
}

/** The concept dependency graph: concept notes as nodes, "Související" links as edges. */
export interface ConceptGraph {
  /** Concept note titles. */
  nodes: string[];
  edges: ConceptEdge[];
}

/** The normalized harvest: everything the SRS core (B2+) and the skill tree (C) build on. */
export interface Harvest {
  cards: Card[];
  recall: RecallPrompt[];
  graph: ConceptGraph;
}

/** A dated teaching note from learning/. */
export interface LearningNote extends VaultNoteBase {
  kind: "learning";
  /** YYYY-MM-DD parsed from the filename prefix, or null. */
  date: string | null;
  /** Hub from `Patří k: [[Hub]]`, or null. */
  hub: string | null;
  /** Project tags (e.g. "project/brainquest"). */
  projects: string[];
  /** Cards harvested from this note's "📘 Nové pojmy" section. */
  cards: Card[];
  /** Recall prompts harvested from this note's "❓ K probrání příště" section. */
  recall: RecallPrompt[];
}

/** A project-agnostic atomic note from concepts/. */
export interface ConceptNote extends VaultNoteBase {
  kind: "concept";
  /** First definition line (`**term** (česky: …) — …`), markdown stripped, or null. */
  gloss: string | null;
  /** Outgoing graph edges parsed from this note's "Související" section. */
  edges: ConceptEdge[];
}

/** Everything the reader returns for one render. */
export interface VaultSnapshot {
  /** The resolved vault path that was read. */
  vaultPath: string;
  /** True when the vault folders resolved and were read. */
  ok: boolean;
  /** Human-readable problem when ok === false. */
  error: string | null;
  learning: LearningNote[];
  concepts: ConceptNote[];
  /** Normalized cards + recall prompts + concept graph aggregated across all notes. */
  harvest: Harvest;
}
