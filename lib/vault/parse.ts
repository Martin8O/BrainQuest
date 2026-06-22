// Pure markdown parsing + harvesting for vault notes — NO file-system access, so it stays
// unit-testable (E2). The vault uses inline #tags and a `Patří k: [[Hub]]` line, not YAML frontmatter.
import type { VaultConfig } from "./config";
import type { Card, ConceptEdge, ConceptNote, LearningNote, RecallPrompt } from "./types";

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

/** Top-level bullets ("- …" / "* …") under a heading, skipping the italic template-helper bullet. */
export function sectionItems(md: string, heading: string): string[] {
  const body = sectionBody(md, heading);
  if (body === null) return [];
  return body
    .split(/\r?\n/)
    .filter((l) => /^[-*]\s+\S/.test(l) && !/^[-*]\s+_/.test(l));
}

/** Strip list marker, wikilink brackets, and bold markers from a bullet → plain readable text. */
function cleanItemText(line: string): string {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

/**
 * Parse one "📘 Nové pojmy" bullet (`- **term** (gloss) — def → [[concept]]`) into a card.
 * Returns null for non-term bullets (no leading bold), which are skipped rather than mis-harvested.
 */
export function parseCardBullet(line: string): Omit<Card, "id" | "sourceSlug" | "sourcePath"> | null {
  const body = line.replace(/^[-*]\s+/, "");
  const term = body.match(/^\*\*(.+?)\*\*/);
  if (!term) return null;
  const front = term[1].trim();
  const rest = body.slice(term[0].length);
  const linkM = rest.match(/→\s*\[\[([^\]]+)\]\]/);
  const conceptLink = linkM ? linkM[1].trim() : null;
  const back = rest
    .replace(/→\s*\[\[[^\]]+\]\]\s*\.?\s*$/, "") // drop the trailing "→ [[concept]]" pointer
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // inline [[x]] -> x
    .replace(/^\s*[—–-]\s*/, "") // drop a leading dash separator
    .replace(/\*\*/g, "")
    .trim();
  return { front, back, conceptLink };
}

/** Parse one "Související" bullet (`- [[Target]] — reason`) into an edge target, or null. */
export function parseRelatedBullet(line: string): { to: string; reason: string | null } | null {
  const body = line.replace(/^[-*]\s+/, "");
  const m = body.match(/\[\[([^\]]+)\]\]/);
  if (!m) return null;
  const to = m[1].trim();
  const after = body.slice(body.indexOf(m[0]) + m[0].length).replace(/^\s*[—–-]\s*/, "").trim();
  return { to, reason: after.length > 0 ? after : null };
}

/** Assemble a learning note (incl. its harvested cards + recall prompts) from its file contents. */
export function parseLearningNote(slug: string, path: string, md: string, cfg: VaultConfig): LearningNote {
  const tags = parseTags(md);
  const cards: Card[] = [];
  for (const line of sectionItems(md, cfg.harvest.cardsHeading)) {
    const parsed = parseCardBullet(line);
    if (parsed) cards.push({ id: `${slug}#c${cards.length}`, sourceSlug: slug, sourcePath: path, ...parsed });
  }
  const recall: RecallPrompt[] = sectionItems(md, cfg.harvest.recallHeading).map((line, i) => ({
    id: `${slug}#r${i}`,
    question: cleanItemText(line),
    sourceSlug: slug,
    sourcePath: path,
  }));
  return {
    kind: "learning",
    slug,
    path,
    title: parseTitle(md) ?? slug,
    tags,
    date: parseDateFromSlug(slug),
    hub: parseHub(md),
    projects: tags.filter((t) => t.startsWith("project/")),
    cards,
    recall,
  };
}

/** Assemble a concept note (incl. its outgoing graph edges) from its file contents. */
export function parseConceptNote(slug: string, path: string, md: string, cfg: VaultConfig): ConceptNote {
  const title = parseTitle(md) ?? slug;
  const edges: ConceptEdge[] = [];
  for (const line of sectionItems(md, cfg.harvest.relatedHeading)) {
    const parsed = parseRelatedBullet(line);
    if (parsed) edges.push({ from: title, to: parsed.to, reason: parsed.reason });
  }
  return {
    kind: "concept",
    slug,
    path,
    title,
    tags: parseTags(md),
    gloss: parseGloss(md),
    edges,
  };
}
