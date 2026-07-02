// Deep, pure content validation for a compiled pack — the M1 compiler's job, run at author time so the
// device never has to. This is separate from `validatePack` (types.ts), which only sanity-checks a pack's
// SHAPE on the load path. Here we check the CONTENT makes sense: card/edge wikilinks resolve to a real
// concept, no concept is left disconnected, no learning note is empty, no slug collides, and the directed
// dependency graph has no cycles. Every finding is a PackIssue with a human-readable message the CLI prints.
//
// Link resolution is case-insensitive against concept titles AND slugs, matching how Obsidian (and the app,
// see the C1 mastery match) resolves [[wikilinks]].
//
// Cycles: BrainQuest's "Related"/"Související" edges are SYMMETRIC by convention (A relates to B usually
// implies B relates to A), which is not a dependency cycle. So we detect cycles only over the ASYMMETRIC
// residual — edges A→B where B→A is absent — the edges that actually express a one-way dependency. On
// today's symmetric vault this residual is empty (no false alarms); when a real prerequisite DAG arrives
// (M4) it lights up. Cycles are warnings, not errors, since the current edge semantics aren't strict prereqs.
import type { Pack } from "./types";

/** The kinds of content problem the compiler reports. */
export type IssueKind = "missing-link" | "orphan-concept" | "empty-note" | "duplicate-slug" | "cycle";

/** error = the pack is broken (fails the build); warning = worth surfacing but the pack still works. */
export type Severity = "error" | "warning";

/** One validation finding. */
export interface PackIssue {
  severity: Severity;
  kind: IssueKind;
  /** Human-readable, self-contained explanation (printed verbatim by the CLI). */
  message: string;
  /** The slug/title the issue is primarily about, for grouping/sorting. */
  ref?: string;
}

/** Content counts, for the compiler's summary line. */
export interface PackStats {
  notes: number;
  concepts: number;
  cards: number;
  recall: number;
  edges: number;
}

/** Canonicalize a wikilink target / title for case-insensitive matching (Obsidian-style). */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Summary counts of a validation run. */
export function summarize(issues: PackIssue[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) {
    if (i.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/** Count the pack's content, for the compiler summary. */
export function packStats(pack: Pack): PackStats {
  return {
    notes: pack.notes.length,
    concepts: pack.concepts.length,
    cards: pack.notes.reduce((s, n) => s + n.cards.length, 0),
    recall: pack.notes.reduce((s, n) => s + n.recall.length, 0),
    edges: pack.concepts.reduce((s, c) => s + c.edges.length, 0),
  };
}

/**
 * Find directed cycles in an adjacency map via colored DFS. Each distinct cycle (by its set of nodes) is
 * reported once, as the node sequence forming the loop. Pure; deterministic given a stable node order.
 */
function findCycles(nodes: string[], adj: Map<string, string[]>): string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n, WHITE]));
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  const visit = (u: string): void => {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) {
        const idx = stack.indexOf(v);
        const cycle = stack.slice(idx);
        const key = [...cycle].map(norm).sort().join(" → ");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...cycle]);
        }
      } else if (c === WHITE) {
        visit(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  };

  for (const n of nodes) if (color.get(n) === WHITE) visit(n);
  return cycles;
}

/**
 * Validate a pack's content and return every issue found (in a stable, grouped-by-kind order).
 * Pure — no fs, no throw; a caller decides what to do with errors vs warnings.
 */
export function validatePackContent(pack: Pack): PackIssue[] {
  const issues: PackIssue[] = [];

  // --- Resolver: any wikilink target → the concept's canonical title (or undefined if unknown). ---------
  // Concepts are addressable by title OR slug, case-insensitively.
  const resolve = new Map<string, string>();
  for (const c of pack.concepts) {
    resolve.set(norm(c.title), c.title);
    resolve.set(norm(c.slug), c.title);
  }
  const canonical = (target: string): string | undefined => resolve.get(norm(target));

  // --- Duplicate slugs (error): a collision breaks the `slug#cN` id scheme and pack: path resolution. ---
  const dupCheck = (items: { slug: string }[], label: string): void => {
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const it of items) {
      const key = norm(it.slug);
      if (seen.has(key) && !reported.has(key)) {
        reported.add(key);
        issues.push({
          severity: "error",
          kind: "duplicate-slug",
          ref: it.slug,
          message: `Duplicate ${label} slug "${it.slug}" — slugs must be unique (they key card ids and note paths).`,
        });
      }
      seen.add(key);
    }
  };
  dupCheck(pack.notes, "note");
  dupCheck(pack.concepts, "concept");

  // --- Empty learning notes (warning): a note that harvested nothing is dead weight. -------------------
  for (const n of pack.notes) {
    if (n.cards.length === 0 && n.recall.length === 0) {
      issues.push({
        severity: "warning",
        kind: "empty-note",
        ref: n.slug,
        message: `Learning note "${n.slug}" has no cards or recall prompts.`,
      });
    }
  }

  // --- Missing links (warning): a card/edge points at a concept that doesn't exist in this pack. --------
  // Warning, not error: forward-references to not-yet-written concepts are a normal authoring state.
  for (const n of pack.notes) {
    for (const card of n.cards) {
      if (card.conceptLink && !canonical(card.conceptLink)) {
        issues.push({
          severity: "warning",
          kind: "missing-link",
          ref: n.slug,
          message: `Card in note "${n.slug}" links to [[${card.conceptLink}]], but no such concept exists.`,
        });
      }
    }
  }
  for (const c of pack.concepts) {
    for (const e of c.edges) {
      if (!canonical(e.to)) {
        issues.push({
          severity: "warning",
          kind: "missing-link",
          ref: c.slug,
          message: `Concept "${c.title}" relates to [[${e.to}]], but no such concept exists.`,
        });
      }
    }
  }

  // --- Orphan concepts (warning): no card points at it and it has no edges in or out → disconnected. ---
  const referencedByCard = new Set<string>();
  for (const n of pack.notes) {
    for (const card of n.cards) {
      const t = card.conceptLink && canonical(card.conceptLink);
      if (t) referencedByCard.add(norm(t));
    }
  }
  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();
  for (const c of pack.concepts) {
    for (const e of c.edges) {
      const t = canonical(e.to);
      if (t) {
        hasOutgoing.add(norm(c.title));
        hasIncoming.add(norm(t));
      }
    }
  }
  for (const c of pack.concepts) {
    const key = norm(c.title);
    if (!referencedByCard.has(key) && !hasIncoming.has(key) && !hasOutgoing.has(key)) {
      issues.push({
        severity: "warning",
        kind: "orphan-concept",
        ref: c.slug,
        message: `Concept "${c.title}" is disconnected — no card links to it and it has no relations in or out.`,
      });
    }
  }

  // --- Cycles (warning): over the ASYMMETRIC residual only (see file header). ---------------------------
  const present = new Set<string>(); // "from→to" pairs by canonical title, for symmetry testing.
  for (const c of pack.concepts) {
    for (const e of c.edges) {
      const to = canonical(e.to);
      if (to) present.add(`${norm(c.title)} ${norm(to)}`);
    }
  }
  const adj = new Map<string, string[]>();
  const titles = pack.concepts.map((c) => c.title);
  const selfReported = new Set<string>();
  for (const c of pack.concepts) {
    for (const e of c.edges) {
      const to = canonical(e.to);
      if (!to) continue;
      if (norm(to) === norm(c.title)) {
        // A concept relating to itself is a degenerate cycle; the symmetric-pair skip below would hide it.
        if (!selfReported.has(norm(c.title))) {
          selfReported.add(norm(c.title));
          issues.push({
            severity: "warning",
            kind: "cycle",
            ref: c.title,
            message: `Dependency cycle among concepts: ${c.title} → ${c.title}.`,
          });
        }
        continue;
      }
      const reverse = `${norm(to)} ${norm(c.title)}`;
      if (present.has(reverse)) continue; // symmetric "related" pair → not a dependency edge
      const list = adj.get(c.title) ?? [];
      list.push(to);
      adj.set(c.title, list);
    }
  }
  for (const cycle of findCycles(titles, adj)) {
    issues.push({
      severity: "warning",
      kind: "cycle",
      ref: cycle[0],
      message: `Dependency cycle among concepts: ${cycle.join(" → ")} → ${cycle[0]}.`,
    });
  }

  // Stable ordering: group by kind (in a fixed order), then by ref, so CLI output and tests are deterministic.
  const kindOrder: IssueKind[] = ["duplicate-slug", "missing-link", "orphan-concept", "empty-note", "cycle"];
  issues.sort((a, b) => {
    const k = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
    return k !== 0 ? k : (a.ref ?? "").localeCompare(b.ref ?? "");
  });
  return issues;
}

/** Render a validation run as a readable report block (used by the CLI). */
export function formatIssues(issues: PackIssue[]): string {
  if (issues.length === 0) return "  ✓ no content issues";
  const byKind = new Map<IssueKind, PackIssue[]>();
  for (const i of issues) {
    const list = byKind.get(i.kind) ?? [];
    list.push(i);
    byKind.set(i.kind, list);
  }
  const lines: string[] = [];
  for (const [kind, list] of byKind) {
    const mark = list[0].severity === "error" ? "✗" : "⚠";
    lines.push(`  ${mark} ${kind} (${list.length})`);
    for (const i of list) lines.push(`      - ${i.message}`);
  }
  return lines.join("\n");
}
