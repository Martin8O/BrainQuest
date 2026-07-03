"use client";

// The interactive skill-tree canvas — the only client component in C2. The server hands it a fully
// positioned, mastery-coloured SkillMap (pure, computed once per request): topic territories, nodes,
// edges. This component owns ONLY the view (pan / zoom) and the selection. Clicking a node selects it
// and the side panel shows that concept's cards + the notes they came from. No layout math runs here.
//
// M3 touch redesign: the gestures are pointer-based and multi-touch — one-finger drag pans, two fingers
// pinch-zoom around their midpoint, double-tap zooms in, wheel zooms toward the cursor. The zoom/pan
// arithmetic lives in the pure `viewport` module (unit-tested); this file only translates raw pointer
// events into viewBox coordinates and feeds them in. On phones the detail panel is a bottom sheet.
import { useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { focalZoom, pinchStep, type View } from "@brainquest/core/graph/viewport";
import type { MasteryLevel } from "@brainquest/core/progress/types";
import type { MapNode, PanelCard, SkillMap } from "@brainquest/core/graph/types";

// A gradual progression that reads at a glance: grey → orange → yellow → green
// (not started → learning → almost → mastered). Each adjacent pair is clearly distinct.
const LEVEL: Record<MasteryLevel, { fill: string; label: string }> = {
  mastered: { fill: "#22c55e", label: "Mastered" }, // green
  young: { fill: "#facc15", label: "Almost" }, // yellow
  learning: { fill: "#f97316", label: "Learning" }, // orange
  untouched: { fill: "#94a3b8", label: "Not started" }, // grey
};

const ACCENT = "#818cf8"; // selection / related-edge highlight

/** Distinct hues for the topic territories (used faint behind the nodes + for the region label). */
const REGION_HUES = [
  "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6",
  "#ef4444", "#14b8a6", "#f97316", "#84cc16", "#3b82f6", "#d946ef",
];
const hue = (id: number) => REGION_HUES[((id % REGION_HUES.length) + REGION_HUES.length) % REGION_HUES.length];

const MUTED_HUE = "#71717a"; // the "Unlinked" catch-all region (no topic)

const pct = (x: number) => Math.round(x * 100);

/** Smallest tappable radius (viewBox units): dots can be tiny, but a finger needs a comfortable target —
 *  a transparent hit circle at least this big sits over every node. It also makes hollow *locked* rings
 *  tappable, which a `fill:none` visual circle is not. */
const MIN_HIT_R = 12;

export default function MapClient({
  map,
  cardsByConcept,
  initialFocus = null,
}: {
  map: SkillMap;
  cardsByConcept: Record<string, PanelCard[]>;
  /** Concept to pre-select (from `/map?focus=…`) — resolved case-insensitively to a node. */
  initialFocus?: string | null;
}) {
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<string | null>(
    () => map.nodes.find((n) => n.concept.toLowerCase() === (initialFocus ?? "").toLowerCase())?.concept ?? null,
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  // Active pointers by id → their current client coordinates. Size drives the gesture: 1 = pan, 2 = pinch.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Live pinch baseline (viewBox units): the last frame's finger distance + midpoint.
  const pinchRef = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);
  // Single-finger pan bookkeeping: last client point (for incremental deltas) + origin (to tell a drag
  // from a tap) + whether it moved past the tap threshold.
  const dragRef = useRef<{ lastX: number; lastY: number; ox: number; oy: number; moved: boolean } | null>(null);
  // Last background tap (for double-tap-to-zoom) — timestamp comes from the event, never Date.now().
  const tapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const nodeByConcept = useMemo(() => new Map(map.nodes.map((nd) => [nd.concept, nd])), [map.nodes]);

  // Neighbours of the selected concept (for highlighting + the panel's "Related" list).
  const neighbours = useMemo(() => {
    if (!selected) return new Set<string>();
    const set = new Set<string>();
    for (const e of map.edges) {
      if (e.from === selected) set.add(e.to);
      else if (e.to === selected) set.add(e.from);
    }
    return set;
  }, [selected, map.edges]);

  // Screen (client) pixel → viewBox coordinate, via the live CTM. This accounts for the SVG's
  // preserveAspectRatio letterboxing, so pan/zoom stay accurate whatever the element's aspect ratio.
  function clientToViewBox(clientX: number, clientY: number): { x: number; y: number } {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  // A client-pixel delta → viewBox units. The CTM scale is uniform (preserveAspectRatio), so `a` suffices.
  function clientDeltaToViewBox(dxPx: number, dyPx: number): { x: number; y: number } {
    const k = svgRef.current?.getScreenCTM()?.a || 1;
    return { x: dxPx / k, y: dyPx / k };
  }
  // Pointer capture keeps a gesture bound to the SVG even if the finger slides off it. Both calls can
  // throw (e.g. the pointer is no longer active, or a synthetic event carries no active pointer) — guard
  // them so one bad pointer never aborts a handler mid-gesture.
  function capturePointer(id: number) {
    try {
      svgRef.current?.setPointerCapture(id);
    } catch {
      /* no active pointer to capture */
    }
  }
  function releasePointer(id: number) {
    try {
      svgRef.current?.releasePointerCapture(id);
    } catch {
      /* already released */
    }
  }

  // Current two-finger distance + midpoint, in viewBox units.
  function pinchState(): { dist: number; mid: { x: number; y: number } } | null {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return null;
    const a = clientToViewBox(pts[0].x, pts[0].y);
    const b = clientToViewBox(pts[1].x, pts[1].y);
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  // Wheel zoom toward the cursor via a native non-passive listener (React's onWheel is passive → can't
  // preventDefault). Registered once; the handler reads live state through refs + the functional setter.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = clientToViewBox(e.clientX, e.clientY);
      setView((v) => focalZoom(v, f.x, f.y, e.deltaY < 0 ? 1.12 : 0.89));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Toolbar / reset zoom around the canvas centre.
  function zoomBy(factor: number) {
    setView((v) => focalZoom(v, map.width / 2, map.height / 2, factor));
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    capturePointer(e.pointerId);
    const p = pointersRef.current;
    p.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (p.size === 2) {
      dragRef.current = null; // a second finger ends any pan and starts a pinch
      pinchRef.current = pinchState();
    } else if (p.size === 1) {
      dragRef.current = { lastX: e.clientX, lastY: e.clientY, ox: e.clientX, oy: e.clientY, moved: false };
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = pointersRef.current;
    if (!p.has(e.pointerId)) return;
    p.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (p.size >= 2 && pinchRef.current) {
      const ns = pinchState();
      if (!ns) return;
      const prev = pinchRef.current;
      const factor = prev.dist > 0 && ns.dist > 0 ? ns.dist / prev.dist : 1;
      setView((v) => pinchStep(v, ns.mid.x, ns.mid.y, prev.mid.x, prev.mid.y, factor));
      pinchRef.current = ns;
    } else if (p.size === 1 && dragRef.current) {
      const d = dragRef.current;
      const dv = clientDeltaToViewBox(e.clientX - d.lastX, e.clientY - d.lastY);
      if (Math.hypot(e.clientX - d.ox, e.clientY - d.oy) > 4) d.moved = true;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x + dv.x, y: v.y + dv.y }));
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const p = pointersRef.current;
    const had = p.has(e.pointerId);
    p.delete(e.pointerId);
    releasePointer(e.pointerId);

    if (p.size >= 2) {
      pinchRef.current = pinchState(); // re-baseline the pinch on the fingers that remain
    } else if (p.size === 1) {
      // Dropped from a pinch to one finger — keep panning with it, no jump, and never treat as a tap.
      pinchRef.current = null;
      const only = [...p.values()][0];
      dragRef.current = { lastX: only.x, lastY: only.y, ox: -1e9, oy: -1e9, moved: true };
    } else {
      const d = dragRef.current;
      pinchRef.current = null;
      dragRef.current = null;
      if (had && d && !d.moved) handleBackgroundTap(e); // a clean tap on empty canvas
    }
  }

  // A tap on the empty canvas: a second tap in quick succession zooms in there; otherwise it clears the
  // selection and arms the double-tap.
  function handleBackgroundTap(e: React.PointerEvent<SVGSVGElement>) {
    const last = tapRef.current;
    if (last && e.timeStamp - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
      const f = clientToViewBox(e.clientX, e.clientY);
      setView((v) => focalZoom(v, f.x, f.y, 1.8));
      tapRef.current = null;
    } else {
      tapRef.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      setSelected(null);
    }
  }

  const selectedNode = selected ? nodeByConcept.get(selected) ?? null : null;
  const dim = selected !== null; // when something is selected, fade the unrelated parts

  // Shared detail-panel props, rendered as a full card in the desktop sidebar and as a bare (chrome-less)
  // body inside the mobile bottom sheet — the sheet supplies its own border/background.
  const detailProps = selectedNode
    ? {
        node: selectedNode,
        related: [...neighbours].sort((a, b) => a.localeCompare(b)),
        cards: cardsByConcept[selectedNode.concept.toLowerCase()] ?? [],
        onPick: setSelected,
        onClose: () => setSelected(null),
      }
    : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        {/* Toolbar */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <label className="hidden cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/90 px-2 py-1 text-xs text-zinc-600 backdrop-blur sm:flex dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="accent-indigo-600"
            />
            Labels
          </label>
          <div className="flex overflow-hidden rounded-lg border border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
            <ToolBtn onClick={() => zoomBy(1 / 1.25)} label="Zoom out">
              −
            </ToolBtn>
            <ToolBtn onClick={() => setView({ x: 0, y: 0, scale: 1 })} label="Reset view">
              ⤢
            </ToolBtn>
            <ToolBtn onClick={() => zoomBy(1.25)} label="Zoom in">
              +
            </ToolBtn>
          </div>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${map.width} ${map.height}`}
          className="h-[68vh] w-full cursor-grab touch-none select-none active:cursor-grabbing lg:h-[74vh]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {/* Topic territories — faint background circles only; their headings are drawn in the label
                layer below, so a node dot can never paint over a region title. */}
            {map.regions.map((rg) => (
              <circle
                key={rg.id}
                cx={rg.x}
                cy={rg.y}
                r={rg.r}
                fill={rg.muted ? MUTED_HUE : hue(rg.id)}
                opacity={0.08}
                style={{ pointerEvents: "none" }}
              />
            ))}

            {/* Edges */}
            {map.edges.map((e) => {
              const active = selected !== null && (e.from === selected || e.to === selected);
              return (
                <line
                  key={`${e.from}::${e.to}`}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke={active ? "#818cf8" : "#64748b"}
                  strokeWidth={active ? 1.6 : 0.6}
                  strokeOpacity={dim ? (active ? 0.9 : 0.08) : 0.18}
                  style={{ pointerEvents: "none" }}
                />
              );
            })}

            {/* Node dots (no text here — labels are a separate layer on top, so no dot covers a label) */}
            {map.nodes.map((nd) => (
              <NodeDot
                key={nd.concept}
                node={nd}
                r={nd.r}
                selected={nd.concept === selected}
                related={neighbours.has(nd.concept)}
                dim={dim && nd.concept !== selected && !neighbours.has(nd.concept)}
                onSelect={() => setSelected(nd.concept)}
                onHover={setHovered}
              />
            ))}

            {/* LABEL LAYER — drawn above every dot. Region headings first, then node labels on top. */}
            {map.regions.map((rg) => (
              <text
                key={`rl-${rg.id}`}
                x={rg.x}
                y={rg.y - rg.r + 18}
                textAnchor="middle"
                fontSize={14}
                fontWeight={700}
                fill={rg.muted ? MUTED_HUE : hue(rg.id)}
                opacity={dim ? 0.3 : rg.muted ? 0.6 : 0.85}
                stroke="var(--background)"
                strokeWidth={3}
                paintOrder="stroke"
                style={{ pointerEvents: "none" }}
              >
                {rg.label}
              </text>
            ))}
            {map.nodes.map((nd) => {
              // (D) With a selection active, the global "Labels" toggle is suppressed for unrelated nodes;
              // only the selected node, its neighbours, and a hovered node keep their label.
              const show =
                (showLabels && !dim) || hovered === nd.concept || nd.concept === selected || neighbours.has(nd.concept);
              if (!show) return null;
              return (
                <NodeLabel
                  key={`nl-${nd.concept}`}
                  node={nd}
                  r={nd.r}
                  scale={view.scale}
                  selected={nd.concept === selected}
                />
              );
            })}
          </g>
        </svg>

        {/* Touch hint (mobile only — desktop has the legend + its own hint line). */}
        <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-zinc-400 lg:hidden">
          Drag to pan · pinch or double-tap to zoom · tap a node
        </p>
      </div>

      {/* Detail panel / legend — a sidebar on desktop… */}
      <aside className="hidden shrink-0 lg:block lg:w-80">
        {detailProps ? <NodeDetail {...detailProps} /> : <Legend />}
      </aside>

      {/* …and a bottom sheet on phones, shown only when a node is selected. */}
      {detailProps && (
        <div className="fixed inset-x-0 bottom-0 z-30 lg:hidden">
          <div
            className="mx-auto max-h-[62vh] max-w-2xl overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="sticky top-0 flex justify-center bg-white pt-2 pb-1 dark:bg-zinc-900">
              <span className="h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" aria-hidden />
            </div>
            <NodeDetail {...detailProps} bare />
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="px-3.5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

function NodeDot({
  node,
  r,
  selected,
  related,
  dim,
  onSelect,
  onHover,
}: {
  node: MapNode;
  r: number;
  selected: boolean;
  related: boolean;
  dim: boolean;
  onSelect: () => void;
  onHover: (concept: string | null) => void;
}) {
  const color = LEVEL[node.level].fill;
  const opacity = dim ? 0.22 : 1;
  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      style={{ cursor: "pointer", opacity }}
      // Stop the pointer-down from starting a background pan/pinch, so a touch on a node just selects it.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseEnter={() => onHover(node.concept)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Transparent, finger-sized hit target over the (possibly tiny, possibly hollow) visible dot. */}
      <circle r={Math.max(r + 6, MIN_HIT_R)} fill="transparent" />
      {selected && <circle r={r + 5} fill="none" stroke={ACCENT} strokeWidth={2} />}
      {/* Locked = hollow ring (gated — can't reach yet); unlocked = solid dot (available / started). */}
      <circle
        r={r}
        fill={node.locked ? "none" : color}
        stroke={node.locked ? color : selected || related ? ACCENT : "transparent"}
        strokeOpacity={node.locked ? 0.6 : 1}
        strokeWidth={1.5}
        style={{ pointerEvents: "none" }}
      />
    </g>
  );
}

/**
 * A node's text label, rendered in the label layer ABOVE every dot (so no filled circle — orange or grey
 * — can paint over a name). Non-interactive: clicks fall through to the dot beneath.
 * (A) Counter-scaled by 1/scale so it keeps a fixed on-screen size while clusters spread on zoom; at the
 * deepest zooms it grows a little (labelBoost) for legibility, where nodes are far enough apart to fit it.
 */
function NodeLabel({ node, r, scale, selected }: { node: MapNode; r: number; scale: number; selected: boolean }) {
  const DEEP_ZOOM = 3.5;
  const labelBoost = scale <= DEEP_ZOOM ? 1 : 1 + (scale - DEEP_ZOOM) * 0.13; // 1× ≤3.5 → ~1.45× at 7
  const fontPx = (selected ? 13 : 11) * labelBoost;
  return (
    <g transform={`translate(${node.x} ${node.y}) scale(${1 / scale})`} style={{ pointerEvents: "none" }}>
      <text
        x={r * scale + 4}
        y={3}
        fontSize={fontPx}
        fontWeight={selected ? 700 : 500}
        fill="currentColor"
        stroke="var(--background)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {node.concept}
      </text>
    </g>
  );
}

function NodeDetail({
  node,
  related,
  cards,
  onPick,
  onClose,
  bare = false,
}: {
  node: MapNode;
  related: string[];
  cards: PanelCard[];
  onPick: (concept: string) => void;
  onClose: () => void;
  /** In the mobile bottom sheet the sheet supplies the card chrome, so drop this panel's own border/bg. */
  bare?: boolean;
}) {
  const notes = [...new Set(cards.map((c) => c.sourceSlug))];
  return (
    <div className={bare ? "px-5 pb-5 pt-1" : "rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold leading-tight">{node.concept}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded px-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ✕
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LEVEL[node.level].fill }} />
          {LEVEL[node.level].label}
        </span>
        {node.cardCount > 0 && (
          <span className="rounded-full bg-zinc-100 px-2 py-1 tabular-nums dark:bg-zinc-800">
            {pct(node.avgStrength)}% · {node.cardCount} {node.cardCount === 1 ? "card" : "cards"}
          </span>
        )}
        {node.locked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-zinc-500 dark:bg-zinc-800" title="All neighbours are still untouched">
            <Lock className="h-3 w-3" /> Locked
          </span>
        )}
      </div>

      {related.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-medium text-zinc-500">Related ({related.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {related.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onPick(r)}
                className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-indigo-500"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-xs font-medium text-zinc-500">
          Cards {cards.length > 0 && `(${cards.length})`}
        </div>
        {cards.length === 0 ? (
          <p className="text-sm text-zinc-500">No cards harvested for this concept yet — it&apos;s on the &ldquo;ahead&rdquo; side of the map.</p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {cards.map((c) => (
              <li key={c.id} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
                <div className="text-sm font-medium">{c.front}</div>
                <p className="mt-0.5 line-clamp-3 text-xs text-zinc-500">{c.back}</p>
              </li>
            ))}
          </ul>
        )}
        {notes.length > 0 && (
          <p className="mt-3 text-xs text-zinc-400">
            From {notes.length} {notes.length === 1 ? "note" : "notes"}: <span className="font-mono">{notes.join(", ")}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold">Legend</h2>
      <ul className="space-y-2 text-sm">
        {(["mastered", "young", "learning", "untouched"] as MasteryLevel[]).map((lvl) => (
          <li key={lvl} className="flex items-center gap-2.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: LEVEL[lvl].fill }} />
            <span>{LEVEL[lvl].label}</span>
          </li>
        ))}
      </ul>
      <hr className="my-3 border-zinc-200 dark:border-zinc-800" />
      <ul className="space-y-2 text-sm text-zinc-500">
        <li className="flex items-start gap-2.5">
          <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full border-2 border-zinc-400" />
          <span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Locked</span> — hollow ring; every neighbour still untouched
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full bg-zinc-400" />
          <span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Available</span> — solid dot; reachable from what you know
          </span>
        </li>
      </ul>
      <hr className="my-3 border-zinc-200 dark:border-zinc-800" />
      <p className="text-xs leading-relaxed text-zinc-500">
        Coloured areas are <span className="font-medium">topics</span> (related concepts cluster together); the grey{" "}
        <span className="font-medium">Unlinked</span> area holds concepts with no relations yet.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        Drag to pan · scroll or <span className="font-medium">+ / −</span> to zoom · click a node for its cards. Dots turn
        green as you review.
      </p>
    </div>
  );
}
