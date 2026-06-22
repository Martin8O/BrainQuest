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

/** A dated teaching note from learning/. */
export interface LearningNote extends VaultNoteBase {
  kind: "learning";
  /** YYYY-MM-DD parsed from the filename prefix, or null. */
  date: string | null;
  /** Hub from `Patří k: [[Hub]]`, or null. */
  hub: string | null;
  /** Project tags (e.g. "project/brainquest"). */
  projects: string[];
  /** Bullet items under the "Nové pojmy" heading — card candidates (full harvest is B1). */
  cardCount: number;
  /** Bullet items under the "K probrání příště" heading — recall prompts (B1). */
  recallCount: number;
}

/** A project-agnostic atomic note from concepts/. */
export interface ConceptNote extends VaultNoteBase {
  kind: "concept";
  /** First definition line (`**term** (česky: …) — …`), markdown stripped, or null. */
  gloss: string | null;
  /** [[wikilinks]] under the "Související" heading — graph edges (built for real in B1). */
  relatedCount: number;
}

/** Everything the reader returns for one render of the overview page. */
export interface VaultSnapshot {
  /** The resolved vault path that was read. */
  vaultPath: string;
  /** True when the vault folders resolved and were read. */
  ok: boolean;
  /** Human-readable problem when ok === false. */
  error: string | null;
  learning: LearningNote[];
  concepts: ConceptNote[];
}
