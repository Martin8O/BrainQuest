"use client";

// The interactive skill-tree canvas — the only client component in C2. The server hands it a fully
// positioned, mastery-coloured SkillMap (pure, computed once per request): topic territories, nodes,
// edges. This component owns ONLY the view (pan / zoom) and the selection. Clicking a node selects it
// and the side panel shows that concept's cards + the notes they came from. No layout math runs here.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MasteryLevel } from "@/lib/progress/types";
import type { MapNode, PanelCard, SkillMap } from "@/lib/graph/types";

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

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

const pct = (x: number) => Math.round(x * 100);

interface View {
  x: number;
  y: number;
  scale: number;
}

export default function MapClient({
  map,
  cardsByConcept,
}: {
  map: SkillMap;
  cardsByConcept: Record<string, PanelCard[]>;
}) {
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

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

  // Wheel zoom via a native non-passive listener (React's onWheel is passive → can't preventDefault).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const s = clampScale(v.scale * (e.deltaY < 0 ? 1.12 : 0.89));
        return { x: v.x + (v.scale - s) * (map.width / 2), y: v.y + (v.scale - s) * (map.height / 2), scale: s };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [map.width, map.height]);

  // Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function zoomTo(nextScale: number) {
    const s = clampScale(nextScale);
    setView((v) => ({
      x: v.x + (v.scale - s) * (map.width / 2),
      y: v.y + (v.scale - s) * (map.height / 2),
      scale: s,
    }));
  }

  // Pan: pointer drag on the background. Screen pixels → user units via the live viewBox/clientWidth ratio.
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = dragRef.current;
    if (!d) return;
    const ratio = map.width / (svgRef.current?.clientWidth || map.width);
    const ddx = (e.clientX - d.sx) * ratio;
    const ddy = (e.clientY - d.sy) * ratio;
    if (Math.abs(ddx) + Math.abs(ddy) > 3) d.moved = true;
    setView((v) => ({ ...v, x: d.ox + ddx, y: d.oy + ddy }));
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    if (d && !d.moved) setSelected(null); // a click on empty canvas clears the selection
  }

  const selectedNode = selected ? nodeByConcept.get(selected) ?? null : null;
  const dim = selected !== null; // when something is selected, fade the unrelated parts

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        {/* Toolbar */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/90 px-2 py-1 text-xs text-zinc-600 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="accent-indigo-600"
            />
            Labels
          </label>
          <div className="flex overflow-hidden rounded-lg border border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
            <ToolBtn onClick={() => zoomTo(view.scale / 1.25)} label="Zoom out">
              −
            </ToolBtn>
            <ToolBtn onClick={() => setView({ x: 0, y: 0, scale: 1 })} label="Reset view">
              ⤢
            </ToolBtn>
            <ToolBtn onClick={() => zoomTo(view.scale * 1.25)} label="Zoom in">
              +
            </ToolBtn>
          </div>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${map.width} ${map.height}`}
          className="h-[62vh] w-full cursor-grab touch-none select-none active:cursor-grabbing lg:h-[74vh]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {/* Topic territories (faint regions behind everything) */}
            {map.regions.map((rg) => (
              <g key={rg.id} style={{ pointerEvents: "none" }}>
                <circle cx={rg.x} cy={rg.y} r={rg.r} fill={rg.muted ? MUTED_HUE : hue(rg.id)} opacity={0.08} />
                <text
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
                >
                  {rg.label}
                </text>
              </g>
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

            {/* Nodes */}
            {map.nodes.map((nd) => (
              <NodeDot
                key={nd.concept}
                node={nd}
                r={nd.r}
                selected={nd.concept === selected}
                related={neighbours.has(nd.concept)}
                dim={dim && nd.concept !== selected && !neighbours.has(nd.concept)}
                showLabel={showLabels || hovered === nd.concept || nd.concept === selected || neighbours.has(nd.concept)}
                onSelect={() => setSelected(nd.concept)}
                onHover={setHovered}
              />
            ))}
          </g>
        </svg>
      </div>

      {/* Detail panel / legend */}
      <aside className="w-full shrink-0 lg:w-80">
        {selectedNode ? (
          <NodeDetail
            node={selectedNode}
            related={[...neighbours].sort((a, b) => a.localeCompare(b))}
            cards={cardsByConcept[selectedNode.concept.toLowerCase()] ?? []}
            onPick={setSelected}
            onClose={() => setSelected(null)}
          />
        ) : (
          <Legend />
        )}
      </aside>
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
      className="px-3 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
  showLabel,
  onSelect,
  onHover,
}: {
  node: MapNode;
  r: number;
  selected: boolean;
  related: boolean;
  dim: boolean;
  showLabel: boolean;
  onSelect: () => void;
  onHover: (concept: string | null) => void;
}) {
  const color = LEVEL[node.level].fill;
  const opacity = dim ? 0.22 : 1;
  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      style={{ cursor: "pointer", opacity }}
      // Stop the pointer-down from starting a background pan, so a click on a node just selects it.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseEnter={() => onHover(node.concept)}
      onMouseLeave={() => onHover(null)}
    >
      {selected && <circle r={r + 5} fill="none" stroke={ACCENT} strokeWidth={2} />}
      {/* Locked = hollow ring (gated — can't reach yet); unlocked = solid dot (available / started). */}
      <circle
        r={r}
        fill={node.locked ? "none" : color}
        stroke={node.locked ? color : selected || related ? ACCENT : "transparent"}
        strokeOpacity={node.locked ? 0.6 : 1}
        strokeWidth={1.5}
      />
      {showLabel && (
        <text
          x={r + 4}
          y={3}
          fontSize={selected ? 13 : 11}
          fontWeight={selected ? 700 : 500}
          fill="currentColor"
          stroke="var(--background)"
          strokeWidth={3}
          paintOrder="stroke"
          style={{ pointerEvents: "none" }}
        >
          {node.concept}
        </text>
      )}
    </g>
  );
}

function NodeDetail({
  node,
  related,
  cards,
  onPick,
  onClose,
}: {
  node: MapNode;
  related: string[];
  cards: PanelCard[];
  onPick: (concept: string) => void;
  onClose: () => void;
}) {
  const notes = [...new Set(cards.map((c) => c.sourceSlug))];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
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
          <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-500 dark:bg-zinc-800" title="All neighbours are still untouched">
            🔒 Locked
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
          <li key={lvl} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: LEVEL[lvl].fill }} />
            {LEVEL[lvl].label}
          </li>
        ))}
        <li className="flex items-center gap-2 text-zinc-500">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-zinc-400" />
          🔒 Locked — hollow ring; every neighbour still untouched
        </li>
        <li className="flex items-center gap-2 text-zinc-500">
          <span className="inline-block h-3 w-3 rounded-full bg-zinc-400" />
          Available — solid dot; reachable from what you know
        </li>
      </ul>
      <hr className="my-4 border-zinc-200 dark:border-zinc-800" />
      <p className="text-xs leading-relaxed text-zinc-500">
        Coloured areas are <span className="font-medium">topics</span> (related concepts cluster together); the grey
        <span className="font-medium"> Unlinked</span> area holds concepts with no relations yet. Drag to pan · scroll or
        <span className="font-medium"> + / −</span> to zoom · click a node for its cards. Dots turn green as you review.
      </p>
    </div>
  );
}
