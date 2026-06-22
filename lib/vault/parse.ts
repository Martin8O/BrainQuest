// Pure markdown parsing for vault notes — NO file-system access, so it stays unit-testable (E2).
// The vault uses inline #tags and a `Patří k: [[Hub]]` line, not YAML frontmatter.
import type { VaultConfig } from "./config";
import type { ConceptNote, LearningNote } from "./types";

/** First H1 ("# Title"), or null. */
export function parseTitle(md: string): string | null {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * Inline #tags from dedicated tag lines (e.g. "#learning #project/brainquest").
 * Only lines that start with "#<letter>" are scanned, so markdown headings ("# …", "## …")
 * and stray "#" in prose/URLs are never mistaken for tags.
 */
export function parseTags(md: string): string[] {
  const tags = new Set<string>();
  for (const line of md.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^#[A-Za-z]/.test(trimmed)) continue;
    for (const m of trimmed.matchAll(/#([A-Za-z][\w/-]*)/g)) tags.add(m[1]);
  }
  return [...tags];
}

/** YYYY-MM-DD prefix of a filename slug, or null. */
export function parseDateFromSlug(slug: string): string | null {
  const m = slug.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** `Patří k: [[Hub]]` → "Hub", or null. */
export function parseHub(md: string): string | null {
  const m = md.match(/Patří k:\s*\[\[([^\]]+)\]\]/);
  return m ? m[1].trim() : null;
}

/** First concept definition line (`**term** (česky: …) — …`), markdown stripped, or null. */
export function parseGloss(md: string): string | null {
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("**")) return line.replace(/\*\*/g, "").trim();
  }
  return null;
}

/** The lines belonging to the section under a given heading (until the next heading), or null if absent. */
function sectionBody(md: string, heading: string): string | null {
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (m && m[1].trim() === heading) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) break; // next heading closes the section
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Count top-level bullets ("- …" / "* …") in a section, skipping the italic template-helper bullet. */
export function countSectionItems(md: string, heading: string): number {
  const body = sectionBody(md, heading);
  if (body === null) return 0;
  return body
    .split(/\r?\n/)
    .filter((l) => /^[-*]\s+\S/.test(l) && !/^[-*]\s+_/.test(l)).length;
}

/** Count [[wikilinks]] in a section. */
export function countSectionLinks(md: string, heading: string): number {
  const body = sectionBody(md, heading);
  if (body === null) return 0;
  return (body.match(/\[\[[^\]]+\]\]/g) ?? []).length;
}

/** Assemble a learning note from its file contents. */
export function parseLearningNote(slug: string, path: string, md: string, cfg: VaultConfig): LearningNote {
  const tags = parseTags(md);
  return {
    kind: "learning",
    slug,
    path,
    title: parseTitle(md) ?? slug,
    tags,
    date: parseDateFromSlug(slug),
    hub: parseHub(md),
    projects: tags.filter((t) => t.startsWith("project/")),
    cardCount: countSectionItems(md, cfg.harvest.cardsHeading),
    recallCount: countSectionItems(md, cfg.harvest.recallHeading),
  };
}

/** Assemble a concept note from its file contents. */
export function parseConceptNote(slug: string, path: string, md: string, cfg: VaultConfig): ConceptNote {
  return {
    kind: "concept",
    slug,
    path,
    title: parseTitle(md) ?? slug,
    tags: parseTags(md),
    gloss: parseGloss(md),
    relatedCount: countSectionLinks(md, cfg.harvest.relatedHeading),
  };
}
