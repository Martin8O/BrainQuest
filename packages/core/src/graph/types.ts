// Skill-tree map contracts — the positioned, mastery-coloured shape the /map page renders. Like the
// progress layer (C1), this layer COMPUTES, it never stores: positions + lock state are a pure function
// of the concept graph (B1) + mastery (C1) + a fixed seed. Contracts live here so the layout module and
// the client renderer read the same model.
import type { MasteryLevel } from "../progress/types";

/** A concept placed on the 2-D canvas, with the mastery + lock state that drives how its node looks. */
export interface MapNode {
  concept: string;
  /** Canvas coordinates inside [0, width] × [0, height]. */
  x: number;
  y: number;
  /** Mastery level from C1 → the node's colour. */
  level: MasteryLevel;
  /** Mean card strength 0..1 (for the tooltip / panel). */
  avgStrength: number;
  /** Cards pointing at this concept (0 for concepts with no cards yet). */
  cardCount: number;
  /** Edges touching this node (either direction) — sizes the node; 0 = isolated. */
  degree: number;
  /**
   * Locked = gated behind concepts you haven't touched yet: the node has neighbours and NONE of them
   * is started. It unlocks the moment any neighbour is touched (you have a bridge to it). Isolated
   * nodes (no neighbours) and nodes you've already started are never locked.
   */
  locked: boolean;
  /** Topic-cluster id this node belongs to (a "territory" on the map). */
  community: number;
  /** Visual radius in viewBox units — set by the layout so dots stay spaced and never overlap. */
  r: number;
}

/** A topic territory — a faint coloured region behind one cluster of related concepts. */
export interface MapRegion {
  id: number;
  /** Centre + radius of the region halo. */
  x: number;
  y: number;
  r: number;
  /** Landmark label = the cluster's most-connected concept. */
  label: string;
  /** How many concepts live in this territory. */
  size: number;
  /** True for the catch-all "Unlinked" region (concepts with no relations yet) → drawn neutral grey. */
  muted: boolean;
}

/** A relation edge resolved to both endpoints' coordinates, ready to draw as a line. */
export interface MapEdge {
  from: string;
  to: string;
  /** Why they relate — the "Související" reason, if any. */
  reason: string | null;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The full positioned skill-tree map. */
export interface SkillMap {
  nodes: MapNode[];
  /** Undirected, de-duplicated relation links (both endpoints are known concepts). */
  edges: MapEdge[];
  /** Topic territories (one per connected cluster) drawn faintly behind the nodes. */
  regions: MapRegion[];
  /** The canvas the coordinates live in — also the SVG viewBox. */
  width: number;
  height: number;
  unlockedCount: number;
  lockedCount: number;
}

/** Tunables for the layout — all defaulted; `seed` makes the layout reproducible. */
export interface LayoutOptions {
  width: number;
  height: number;
  padding: number;
  iterations: number;
  seed: number;
  /** Louvain resolution: >1 yields smaller, more even topic clusters. */
  resolution: number;
}

/** One card shown in the detail panel when a concept node is selected. */
export interface PanelCard {
  id: string;
  front: string;
  back: string;
  sourceSlug: string;
}
