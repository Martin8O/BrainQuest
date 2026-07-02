// Pure queue-ordering helper for the daily session. New cards all become due at the same instant, so
// without this they'd come out in harvest order — every card from one note, then the next note — which
// makes a session feel monotonous ("the same note over and over"). Round-robin interleaving by source
// note samples breadth instead: one card from each note, then the next from each, and so on. Stable:
// the relative order within a note is preserved, so it stays deterministic (no clock, no randomness).

/** Round-robin items across their `sourceSlug` groups, preserving first-seen group + within-group order. */
export function interleaveBySource<T extends { sourceSlug: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const g = groups.get(item.sourceSlug);
    if (g) g.push(item);
    else groups.set(item.sourceSlug, [item]);
  }
  const lists = [...groups.values()];
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}
