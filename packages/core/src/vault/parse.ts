// Pure markdown parsing + harvesting for vault notes — NO file-system access, so it stays
// unit-testable (E2). The vault uses inline #tags and a `Patří k: [[Hub]]` line; the M1 compiler also
// tolerates YAML frontmatter (see frontmatter.ts) as an alternative metadata source, merged additively.
import type { VaultConfig } from "./config";
import { frontmatterList, frontmatterScalar, splitFrontmatter } from "./frontmatter";
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

/** Escape a config-supplied literal so it's safe to drop into a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `<hubPrefix> [[Hub]]` → "Hub", or null. Prefix is config-driven; a list accepts aliases (any matches). */
export function parseHub(md: string, hubPrefix: string | string[]): string | null {
  for (const prefix of Array.isArray(hubPrefix) ? hubPrefix : [hubPrefix]) {
    const m = md.match(new RegExp(`${escapeRegExp(prefix)}\\s*\\[\\[([^\\]]+)\\]\\]`));
    if (m) return m[1].trim();
  }
  return null;
}

/** First concept definition line (`**term** (česky: …) — …`), markdown stripped, or null. */
export function parseGloss(md: string): string | null {
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("**")) return line.replace(/\*\*/g, "").trim();
  }
  return null;
}

/**
 * The lines belonging to the section under a given heading (until the next heading), or null if absent.
 * `heading` may be a single heading or a list of accepted aliases (the section matches ANY of them), so a
 * vault can use English, Czech, emoji/no-emoji headings interchangeably.
 */
function sectionBody(md: string, heading: string | string[]): string | null {
  const accepted = new Set(Array.isArray(heading) ? heading : [heading]);
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (m && accepted.has(m[1].trim())) {
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

/** Top-level bullets ("- …" / "* …") under a heading (or any of its aliases), skipping italic helpers. */
export function sectionItems(md: string, heading: string | string[]): string[] {
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

/** Merge inline #tags with any frontmatter `tags`, preserving insertion order and de-duplicating. */
function mergeTags(inline: string[], fmTags: string[]): string[] {
  return [...new Set([...inline, ...fmTags])];
}

/** Strip surrounding `[[…]]` from a value so a frontmatter `hub: "[[X]]"` matches an inline `X` hub. */
function unwrapLink(s: string | null): string | null {
  if (s == null) return null;
  const m = s.match(/^\[\[([^\]]+)\]\]$/);
  return m ? m[1].trim() : s;
}

/** Assemble a learning note (incl. its harvested cards + recall prompts) from its file contents. */
export function parseLearningNote(slug: string, path: string, md: string, cfg: VaultConfig): LearningNote {
  const { data, body } = splitFrontmatter(md);
  const tags = mergeTags(parseTags(body), frontmatterList(data, "tags"));
  const cards: Card[] = [];
  for (const line of sectionItems(body, cfg.harvest.cardsHeading)) {
    const parsed = parseCardBullet(line);
    if (parsed) cards.push({ id: `${slug}#c${cards.length}`, sourceSlug: slug, sourcePath: path, ...parsed });
  }
  const recall: RecallPrompt[] = sectionItems(body, cfg.harvest.recallHeading).map((line, i) => ({
    id: `${slug}#r${i}`,
    question: cleanItemText(line),
    sourceSlug: slug,
    sourcePath: path,
  }));
  const fmHub = unwrapLink(frontmatterScalar(data, "hub") ?? frontmatterScalar(data, "belongs_to"));
  return {
    kind: "learning",
    slug,
    path,
    title: parseTitle(body) ?? frontmatterScalar(data, "title") ?? slug,
    tags,
    date: parseDateFromSlug(slug) ?? frontmatterScalar(data, "date"),
    hub: parseHub(body, cfg.tags.hubPrefix) ?? fmHub,
    projects: tags.filter((t) => t.startsWith(cfg.tags.projectTagPrefix)),
    cards,
    recall,
  };
}

/** Assemble a concept note (incl. its outgoing graph edges) from its file contents. */
export function parseConceptNote(slug: string, path: string, md: string, cfg: VaultConfig): ConceptNote {
  const { data, body } = splitFrontmatter(md);
  const title = parseTitle(body) ?? frontmatterScalar(data, "title") ?? slug;
  const edges: ConceptEdge[] = [];
  for (const line of sectionItems(body, cfg.harvest.relatedHeading)) {
    const parsed = parseRelatedBullet(line);
    if (parsed) edges.push({ from: title, to: parsed.to, reason: parsed.reason });
  }
  return {
    kind: "concept",
    slug,
    path,
    title,
    tags: mergeTags(parseTags(body), frontmatterList(data, "tags")),
    gloss: parseGloss(body),
    edges,
  };
}

/**
 * Classify a standalone markdown note as a learning note or a concept note by its content: a note that
 * harvests any card or recall prompt is "learning", otherwise "concept". Used by the compiler's folder/doc
 * input modes, where notes aren't already sorted into learning/ and concepts/ folders.
 */
export function classifyNote(md: string, cfg: VaultConfig): "learning" | "concept" {
  const { body } = splitFrontmatter(md);
  const hasCards = sectionItems(body, cfg.harvest.cardsHeading).some((l) => parseCardBullet(l) !== null);
  const hasRecall = sectionItems(body, cfg.harvest.recallHeading).length > 0;
  return hasCards || hasRecall ? "learning" : "concept";
}

/** Filename-safe slug from a title: lowercased, spaces → "-", non-alphanumerics dropped. */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** One note carved out of a single multi-note document (doc input mode). */
export interface DocSection {
  title: string;
  slug: string;
  /** The section's markdown, starting at its `# Title` line so the note parsers see a normal note. */
  body: string;
}

/**
 * Split one long structured document into notes on its H1 (`# `) headings — each H1 section becomes a note
 * (title = the heading, body = everything until the next H1). Content before the first H1 is ignored.
 * Lets the compiler turn a single authored/AI-generated doc into a pack.
 */
export function splitDocIntoNotes(md: string): DocSection[] {
  const { body } = splitFrontmatter(md);
  const lines = body.split(/\r?\n/);
  const raw: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1) {
      if (current) raw.push(current);
      current = { title: h1[1].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) raw.push(current);

  // Slugs must be unique — they key card ids (`slug#cN`) and pack paths. Two H1s that slugify to the same
  // value (or to nothing, e.g. an emoji-only title) get a numeric suffix / a positional fallback.
  const used = new Map<string, number>();
  return raw.map((s, i) => {
    const base = slugify(s.title) || `section-${i + 1}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const slug = seen === 0 ? base : `${base}-${seen + 1}`;
    return { title: s.title, slug, body: s.lines.join("\n") };
  });
}
