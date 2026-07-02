// Minimal YAML-frontmatter support — a format-tolerance win for the M1 compiler, so a pack can be built
// from notes that carry metadata as frontmatter (common outside Obsidian) instead of `vault`'s inline
// `#tags` + `Belongs to:` convention. Deliberately tiny (no YAML dependency): it understands scalars,
// inline `[a, b]` lists, and block `- item` lists — enough for `tags`, `hub`/`belongs_to`, and `date`.
// Additive: notes with no frontmatter are returned unchanged, so the existing vault keeps parsing identically.

/** Parsed frontmatter values: a scalar string or a list of strings, keyed by (lowercased) field name. */
export type FrontmatterData = Record<string, string | string[]>;

export interface Frontmatter {
  data: FrontmatterData;
  /** The note text with the leading `--- … ---` block removed (or the original text if there was none). */
  body: string;
}

/** Strip surrounding quotes from a scalar YAML value. */
function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse an inline `[a, b, c]` list, or return null if the value isn't one. */
function parseInlineList(value: string): string[] | null {
  const t = value.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const inner = t.slice(1, -1).trim();
  if (inner === "") return [];
  return inner.split(",").map((x) => unquote(x)).filter((x) => x.length > 0);
}

/**
 * Split a note into its frontmatter data and remaining body. A frontmatter block is a `---` line at the
 * very top, its YAML-ish content, and a closing `---` line. Only the small subset described above is parsed;
 * unrecognized lines are ignored rather than erroring (tolerance over strictness).
 */
export function splitFrontmatter(md: string): Frontmatter {
  const m = md.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, body: md };

  const data: FrontmatterData = {};
  const lines = m[1].split(/\r?\n/);
  let currentKey: string | null = null; // the key a following `- item` block belongs to
  let blockList: string[] = [];

  const flushBlock = (): void => {
    if (currentKey && blockList.length > 0) data[currentKey] = blockList;
    currentKey = null;
    blockList = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") continue;
    const itemM = line.match(/^\s*-\s+(.*)$/);
    if (itemM && currentKey) {
      blockList.push(unquote(itemM[1]));
      continue;
    }
    const kvM = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kvM) continue; // ignore anything we don't understand
    flushBlock();
    const key = kvM[1].toLowerCase();
    const value = kvM[2].trim();
    if (value === "") {
      currentKey = key; // a block list (`key:` then `- item` lines) may follow
      continue;
    }
    const inline = parseInlineList(value);
    data[key] = inline !== null ? inline : unquote(value);
  }
  flushBlock();

  return { data, body: md.slice(m[0].length) };
}

/**
 * Read a frontmatter field as a list, or [] if absent. A scalar is split on whitespace/commas; array items
 * are used as-is. Either way each item is trimmed and a leading `#` is dropped, so `tags: [learning,
 * "#project/x"]` and inline `#tags` (which parseTags stores without the `#`) normalize to the same shape.
 */
export function frontmatterList(data: FrontmatterData, key: string): string[] {
  const v = data[key];
  if (v === undefined) return [];
  const items = Array.isArray(v) ? v : v.split(/[\s,]+/);
  return items.map((x) => x.replace(/^#/, "").trim()).filter((x) => x.length > 0);
}

/** Read a frontmatter field as a scalar (the first element of a list), or null if absent. */
export function frontmatterScalar(data: FrontmatterData, key: string): string | null {
  const v = data[key];
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
