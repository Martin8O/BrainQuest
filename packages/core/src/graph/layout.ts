// Pure skill-tree layout — NO file system, NO clock, NO randomness beyond a seeded PRNG. Turns the
// concept graph (B1) + per-concept mastery (C1) into positioned nodes + topic territories + lock state.
//
// Why a "territory" layout instead of one big force-directed blob: 115 concepts in a single hairball
// is unreadable. So we:
//   1. cluster the concepts into topics (deterministic label propagation);
//   2. lay each cluster out on its OWN island, then SPACE the nodes inside it (collision relaxation) so
//      every concept is a distinct dot, not a clump;
//   3. pack the islands so related ones sit near each other and none overlap;
//   4. concepts with no links yet become one small "Unlinked" island packed in with the rest.
// Two invariants: deterministic (same graph + seed → identical map) and positions are MASTERY-
// INDEPENDENT (the map never reshuffles as you study — only colours + locks change).
import type { ConceptGraph } from "../vault/types";
import type { ConceptMastery, MasteryLevel } from "../progress/types";
import type { LayoutOptions, MapEdge, MapNode, MapRegion, SkillMap } from "./types";

const DEFAULTS: LayoutOptions = { width: 1100, height: 760, padding: 44, iterations: 300, seed: 42, resolution: 1.1 };

// Node sizing/spacing in "local" island units (the final normalise scales these into the canvas).
const NODE_R = 12; // base node radius
const DEG_BUMP = 8; // extra radius a max-degree hub gets
const NODE_GAP = 9; // clear space kept between two node edges
const ISLAND_PAD = 14; // breathing room between the outermost node and the island halo
const CLUSTER_GAP = 16; // clear space kept between two island halos

/** Small, fast, fully-deterministic PRNG (mulberry32) — the layout's only source of "randomness". */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates shuffle driven by the seeded PRNG (keeps label propagation deterministic). */
function shuffle(arr: number[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Fruchterman–Reingold force layout on `m` nodes with the given undirected local edges. Returns raw
 * coordinates (centred-ish, arbitrary scale) — the caller spaces + normalises. Reused for both
 * intra-cluster layout and the cluster-of-clusters layout.
 */
function forceLayout(m: number, edges: [number, number][], rng: () => number, iterations: number): { xs: Float64Array; ys: Float64Array } {
  const xs = new Float64Array(m);
  const ys = new Float64Array(m);
  const W = 1000;
  for (let i = 0; i < m; i++) {
    xs[i] = rng() * W;
    ys[i] = rng() * W;
  }
  if (m <= 1) {
    xs[0] = 0;
    ys[0] = 0;
    return { xs, ys };
  }
  const k = Math.sqrt((W * W) / m);
  let temp = W / 8;
  const cool = temp / (iterations + 1);
  const dx = new Float64Array(m);
  const dy = new Float64Array(m);
  for (let step = 0; step < iterations; step++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        const vx = xs[i] - xs[j];
        const vy = ys[i] - ys[j];
        const dist = Math.hypot(vx, vy) || 0.01;
        const rep = (k * k) / dist;
        dx[i] += (vx / dist) * rep;
        dy[i] += (vy / dist) * rep;
        dx[j] -= (vx / dist) * rep;
        dy[j] -= (vy / dist) * rep;
      }
    }
    for (const [a, b] of edges) {
      const vx = xs[a] - xs[b];
      const vy = ys[a] - ys[b];
      const dist = Math.hypot(vx, vy) || 0.01;
      const att = (dist * dist) / k;
      dx[a] -= (vx / dist) * att;
      dy[a] -= (vy / dist) * att;
      dx[b] += (vx / dist) * att;
      dy[b] += (vy / dist) * att;
    }
    const cx = W / 2;
    for (let i = 0; i < m; i++) {
      dx[i] += (cx - xs[i]) * 0.02;
      dy[i] += (cx - ys[i]) * 0.02;
      const d = Math.hypot(dx[i], dy[i]) || 0.01;
      const mv = Math.min(d, temp);
      xs[i] += (dx[i] / d) * mv;
      ys[i] += (dy[i] / d) * mv;
    }
    temp -= cool;
  }
  return { xs, ys };
}

/**
 * Circle collision relaxation: push the m circles (positions xs/ys, radii r[]) apart until none
 * overlap (each pair kept ≥ r[a]+r[b]+gap apart). Deterministic — no randomness. Used both to space
 * nodes inside an island and to keep island halos from overlapping.
 */
function relax(m: number, xs: Float64Array, ys: Float64Array, r: number[], gap: number, iterations: number): void {
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let a = 0; a < m; a++) {
      for (let b = a + 1; b < m; b++) {
        const vx = xs[a] - xs[b];
        const vy = ys[a] - ys[b];
        const dist = Math.hypot(vx, vy) || 0.01;
        const need = r[a] + r[b] + gap;
        if (dist < need) {
          const push = (need - dist) / 2;
          xs[a] += (vx / dist) * push;
          ys[a] += (vy / dist) * push;
          xs[b] -= (vx / dist) * push;
          ys[b] -= (vy / dist) * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/** A weighted undirected graph used by Louvain's aggregation levels. */
interface WGraph {
  size: number;
  /** neighbour → edge weight (symmetric; excludes self-loops). */
  adj: Map<number, number>[];
  /** self-loop weight per node (internal edges folded in during aggregation). */
  self: number[];
  /** weighted degree = Σ adj weights + 2·self. */
  k: number[];
}

/** One Louvain level: move each node into the neighbouring community that most raises modularity. */
function localMoving(g: WGraph, resolution: number, rng: () => number): number[] {
  const { size, adj, k } = g;
  const twoM = k.reduce((s, x) => s + x, 0);
  const comm = [...Array(size).keys()];
  if (twoM === 0) return comm;
  const sigmaTot = k.slice();
  const order = [...Array(size).keys()];
  for (let pass = 0; pass < 50; pass++) {
    shuffle(order, rng);
    let improved = false;
    for (const i of order) {
      if (k[i] === 0) continue;
      const ci = comm[i];
      const wTo = new Map<number, number>(); // total edge weight from i into each neighbour community
      for (const [j, w] of adj[i]) wTo.set(comm[j], (wTo.get(comm[j]) ?? 0) + w);
      sigmaTot[ci] -= k[i];
      let bestC = ci;
      let bestGain = (wTo.get(ci) ?? 0) - (resolution * k[i] * sigmaTot[ci]) / twoM;
      for (const [c, w] of wTo) {
        if (c === ci) continue;
        const gain = w - (resolution * k[i] * sigmaTot[c]) / twoM;
        if (gain > bestGain || (gain === bestGain && c < bestC)) {
          bestGain = gain;
          bestC = c;
        }
      }
      sigmaTot[bestC] += k[i];
      if (bestC !== ci) {
        comm[i] = bestC;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return comm;
}

/** Renumber arbitrary community labels to a dense 0..count-1 range. */
function renumber(comm: number[]): { map: number[]; count: number } {
  const idOf = new Map<number, number>();
  const map = comm.map((c) => {
    let id = idOf.get(c);
    if (id === undefined) {
      id = idOf.size;
      idOf.set(c, id);
    }
    return id;
  });
  return { map, count: idOf.size };
}

/** Collapse each community into a single super-node → the next Louvain level's graph. */
function aggregate(g: WGraph, comm: number[], count: number): WGraph {
  const adj: Map<number, number>[] = Array.from({ length: count }, () => new Map<number, number>());
  const self = new Array(count).fill(0);
  for (let i = 0; i < g.size; i++) {
    const ci = comm[i];
    self[ci] += g.self[i];
    for (const [j, w] of g.adj[i]) {
      const cj = comm[j];
      if (ci === cj) self[ci] += w / 2; // internal edge seen from both ends over the whole loop → w total
      else adj[ci].set(cj, (adj[ci].get(cj) ?? 0) + w);
    }
  }
  const k = new Array(count).fill(0);
  for (let c = 0; c < count; c++) {
    let s = 0;
    for (const [, w] of adj[c]) s += w;
    k[c] = s + 2 * self[c];
  }
  return { size: count, adj, self, k };
}

/**
 * Topic clusters via multi-level Louvain (modularity maximisation): local moving, then collapse each
 * community to a super-node and repeat, until a level merges nothing. `resolution` > 1 yields smaller,
 * more even communities. Far higher-quality + STABLER than label propagation (which lets one hub flood
 * its label across the whole graph → a single monster blob). Deterministic: seeded order + id tie-break.
 */
function louvain(n: number, adj0: Set<number>[], rng: () => number, resolution: number): number[] {
  let g: WGraph = {
    size: n,
    adj: adj0.map((s) => new Map([...s].map((j) => [j, 1]))),
    self: new Array(n).fill(0),
    k: adj0.map((s) => s.size),
  };
  const nodeComm = [...Array(n).keys()]; // original node → community at the current level
  for (let level = 0; level < 20; level++) {
    const { map, count } = renumber(localMoving(g, resolution, rng));
    if (count === g.size) break; // this level merged nothing → done
    for (let i = 0; i < n; i++) nodeComm[i] = map[nodeComm[i]];
    g = aggregate(g, map, count);
  }
  return nodeComm;
}

/** Build the positioned skill-tree map. */
export function buildSkillMap(
  graph: ConceptGraph,
  mastery: ConceptMastery[],
  opts: Partial<LayoutOptions> = {},
): SkillMap {
  const { width, height, padding, iterations, seed, resolution } = { ...DEFAULTS, ...opts };

  // Stable node order (by name) so POSITIONS don't depend on mastery — the map shouldn't move as you learn.
  const names = [...new Set(graph.nodes)].sort((a, b) => a.localeCompare(b));
  const n = names.length;
  const indexOf = new Map(names.map((name, i) => [name.toLowerCase(), i]));
  const masteryByConcept = new Map(mastery.map((m) => [m.concept.toLowerCase(), m]));

  if (n === 0) {
    return { nodes: [], edges: [], regions: [], width, height, unlockedCount: 0, lockedCount: 0 };
  }

  // Resolve + de-dupe edges into undirected index pairs; build adjacency for layout + lock + clustering.
  const adjacency: Set<number>[] = names.map(() => new Set<number>());
  const pairs = new Map<string, { i: number; j: number; reason: string | null }>();
  for (const e of graph.edges) {
    const i = indexOf.get(e.from.toLowerCase());
    const j = indexOf.get(e.to.toLowerCase());
    if (i === undefined || j === undefined || i === j) continue;
    adjacency[i].add(j);
    adjacency[j].add(i);
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (!pairs.has(key)) pairs.set(key, { i, j, reason: e.reason });
  }

  const rng = mulberry32(seed);

  // ── 1. Cluster the linked concepts into topics; gather the unlinked ones into one extra community ──
  const labels = louvain(n, adjacency, rng, resolution);
  const clustersByLabel = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (adjacency[i].size === 0) continue;
    const list = clustersByLabel.get(labels[i]);
    if (list) list.push(i);
    else clustersByLabel.set(labels[i], [i]);
  }
  const topicClusters = [...clustersByLabel.values()].sort(
    (a, b) => b.length - a.length || Math.min(...a) - Math.min(...b),
  );
  const isolated = [...Array(n).keys()].filter((i) => adjacency[i].size === 0);
  // The "Unlinked" catch-all is the last community (id = topicClusters.length) when it exists.
  const communities = isolated.length > 0 ? [...topicClusters, isolated] : topicClusters;
  const unlinkedId = isolated.length > 0 ? topicClusters.length : -1;
  const communityOf = new Map<number, number>();
  communities.forEach((members, cid) => members.forEach((g) => communityOf.set(g, cid)));

  // Per-node visual radius (hubs a touch bigger) — drives both spacing and the drawn dot size.
  const nodeR = names.map((_, i) => NODE_R + (DEG_BUMP * Math.min(8, adjacency[i].size)) / 8);

  // ── 2. Lay each community on its own island, then SPACE the nodes so none overlap ────────────────
  const local = new Float64Array(n * 2); // per-node offset from its island centre
  const radius = communities.map(() => 0);
  communities.forEach((members, cid) => {
    const m = members.length;
    const localIndex = new Map(members.map((g, li) => [g, li]));
    const localEdges: [number, number][] = [];
    for (const { i, j } of pairs.values()) {
      if (communityOf.get(i) === cid && communityOf.get(j) === cid) {
        localEdges.push([localIndex.get(i)!, localIndex.get(j)!]);
      }
    }
    const { xs, ys } = forceLayout(m, localEdges, rng, iterations);
    // Centre on the centroid.
    let mx = 0;
    let my = 0;
    for (let li = 0; li < m; li++) {
      mx += xs[li];
      my += ys[li];
    }
    mx /= m;
    my /= m;
    for (let li = 0; li < m; li++) {
      xs[li] -= mx;
      ys[li] -= my;
    }
    const r = members.map((g) => nodeR[g]);
    if (m > 1) {
      // Pre-scale the force output to roughly the right density, then collide so dots fan out evenly.
      let maxR = 1;
      for (let li = 0; li < m; li++) maxR = Math.max(maxR, Math.hypot(xs[li], ys[li]));
      const targetR = Math.sqrt(m) * (NODE_R + NODE_GAP) * 1.4;
      const pre = targetR / maxR;
      for (let li = 0; li < m; li++) {
        xs[li] *= pre;
        ys[li] *= pre;
      }
      relax(m, xs, ys, r, NODE_GAP, 120);
    }
    let maxD = 0;
    for (let li = 0; li < m; li++) maxD = Math.max(maxD, Math.hypot(xs[li], ys[li]) + r[li]);
    radius[cid] = maxD + ISLAND_PAD;
    members.forEach((g, li) => {
      local[g * 2] = xs[li];
      local[g * 2 + 1] = ys[li];
    });
  });

  // ── 3. Place the islands relative to each other, then push their halos apart until none overlap ──
  const numC = communities.length;
  const clusterEdges: [number, number][] = [];
  const seenCC = new Set<string>();
  for (const { i, j } of pairs.values()) {
    const a = communityOf.get(i)!;
    const b = communityOf.get(j)!;
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seenCC.has(key)) continue;
    seenCC.add(key);
    clusterEdges.push([a, b]);
  }
  const { xs: cxA, ys: cyA } = forceLayout(numC, clusterEdges, rng, 400);
  // The force layout fixes RELATIVE island positions but on an arbitrary (often huge) scale, and relax
  // only ever pushes circles APART — it never compacts. So first squeeze the centres to a target extent
  // (sized from the islands' own radii so they start slightly overlapping), then relax to a tight,
  // non-overlapping packing. Without this the arrangement stays enormous → scale tiny → dots vanish.
  let cMinX = Infinity;
  let cMaxX = -Infinity;
  let cMinY = Infinity;
  let cMaxY = -Infinity;
  for (let c = 0; c < numC; c++) {
    cMinX = Math.min(cMinX, cxA[c]);
    cMaxX = Math.max(cMaxX, cxA[c]);
    cMinY = Math.min(cMinY, cyA[c]);
    cMaxY = Math.max(cMaxY, cyA[c]);
  }
  const cSpan = Math.max(cMaxX - cMinX, cMaxY - cMinY) || 1;
  const extent = radius.reduce((s, r) => s + r, 0) * 0.8; // ≈ how wide the packed islands need to be
  const f = extent / cSpan;
  for (let c = 0; c < numC; c++) {
    cxA[c] = (cxA[c] - cMinX) * f;
    cyA[c] = (cyA[c] - cMinY) * f;
  }
  relax(numC, cxA, cyA, radius, CLUSTER_GAP, 600);
  // The "Unlinked" island has no edges → it doesn't belong INSIDE the cluster. Park it just past the
  // bottom margin of the packed topics (a tidy tray at the edge), centred horizontally: close, but aside.
  if (unlinkedId >= 0 && numC > 1) {
    let mx = 0;
    let bottom = -Infinity;
    for (let c = 0; c < numC; c++) {
      if (c === unlinkedId) continue;
      mx += cxA[c];
      bottom = Math.max(bottom, cyA[c] + radius[c]);
    }
    cxA[unlinkedId] = mx / (numC - 1);
    cyA[unlinkedId] = bottom + CLUSTER_GAP + radius[unlinkedId];
  }

  // Absolute (pre-normalise) positions for every node.
  const absX = new Float64Array(n);
  const absY = new Float64Array(n);
  for (let g = 0; g < n; g++) {
    const cid = communityOf.get(g)!;
    absX[g] = cxA[cid] + local[g * 2];
    absY[g] = cyA[cid] + local[g * 2 + 1];
  }

  // The island arrangement can come out portrait; the canvas is landscape. If it's taller than wide,
  // transpose the axes (a lossless 90° rotation — no distortion) so the long side fills the wide canvas.
  let sx = Infinity;
  let bx = -Infinity;
  let sy = Infinity;
  let by = -Infinity;
  for (let g = 0; g < n; g++) {
    sx = Math.min(sx, absX[g]);
    bx = Math.max(bx, absX[g]);
    sy = Math.min(sy, absY[g]);
    by = Math.max(by, absY[g]);
  }
  if (by - sy > bx - sx) {
    for (let g = 0; g < n; g++) {
      const t = absX[g];
      absX[g] = absY[g];
      absY[g] = t;
    }
    for (let c = 0; c < numC; c++) {
      const t = cxA[c];
      cxA[c] = cyA[c];
      cyA[c] = t;
    }
  }

  // ── 4. Normalise everything into the canvas ──────────────────────────────────────────────────────
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let g = 0; g < n; g++) {
    minX = Math.min(minX, absX[g]);
    maxX = Math.max(maxX, absX[g]);
    minY = Math.min(minY, absY[g]);
    maxY = Math.max(maxY, absY[g]);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offX = (width - spanX * scale) / 2 - minX * scale;
  const offY = (height - spanY * scale) / 2 - minY * scale;
  const posX = (g: number) => absX[g] * scale + offX;
  const posY = (g: number) => absY[g] * scale + offY;

  const levelOf = (i: number): MasteryLevel => masteryByConcept.get(names[i].toLowerCase())?.level ?? "untouched";

  // ── 5. Assemble nodes, edges, regions ────────────────────────────────────────────────────────────
  const nodes: MapNode[] = names.map((concept, i) => {
    const m = masteryByConcept.get(concept.toLowerCase());
    const level = m?.level ?? "untouched";
    const neighbours = [...adjacency[i]];
    const locked =
      level === "untouched" && neighbours.length > 0 && neighbours.every((j) => levelOf(j) === "untouched");
    return {
      concept,
      x: posX(i),
      y: posY(i),
      level,
      avgStrength: m?.avgStrength ?? 0,
      cardCount: m?.cardCount ?? 0,
      degree: neighbours.length,
      locked,
      community: communityOf.get(i) ?? -1,
      // Exactly the spaced radius (no upward clamp) → the within-island collision guarantee survives
      // the normalise, so dots never overlap. Small at full zoom-out by design; zoom in to read them.
      r: nodeR[i] * scale,
    };
  });

  const edges: MapEdge[] = [...pairs.values()].map(({ i, j, reason }) => ({
    from: names[i],
    to: names[j],
    reason,
    x1: posX(i),
    y1: posY(i),
    x2: posX(j),
    y2: posY(j),
  }));

  // One region per community: topic clusters labelled by their most-connected concept; the catch-all
  // "Unlinked" cluster drawn neutral grey. Skip halos around 1–2 node clusters (a halo round a dot is odd).
  const regions: MapRegion[] = communities
    .map((members, cid): MapRegion | null => {
      if (members.length < 3) return null;
      const muted = cid === unlinkedId;
      const landmark = muted
        ? null
        : members.reduce((best, g) => (adjacency[g].size > adjacency[best].size ? g : best), members[0]);
      return {
        id: cid,
        x: cxA[cid] * scale + offX,
        y: cyA[cid] * scale + offY,
        r: radius[cid] * scale,
        label: muted ? "Unlinked" : names[landmark!],
        size: members.length,
        muted,
      };
    })
    .filter((r): r is MapRegion => r !== null);

  const lockedCount = nodes.filter((node) => node.locked).length;
  return { nodes, edges, regions, width, height, unlockedCount: n - lockedCount, lockedCount };
}
