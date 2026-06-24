"use client";

// One reusable category filter — a chip per area (project) with its item count. Active areas are filled,
// inactive are struck through. Used by both the AI tutor and the daily session so they focus the same way
// (skip the niche, drill one topic). Pure presentation: the parent owns the enabled-set + persistence.
interface AreaLike {
  key: string;
  label: string;
  count: number;
}

export function AreaFilter({
  areas,
  enabled,
  onToggle,
  label = "Areas",
}: {
  areas: AreaLike[];
  enabled: Set<string>;
  onToggle: (key: string) => void;
  label?: string;
}) {
  if (areas.length <= 1) return null; // nothing to filter
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</span>
        {areas.map((a) => {
          const on = enabled.has(a.key);
          return (
            <button
              key={a.key}
              onClick={() => onToggle(a.key)}
              aria-pressed={on}
              title={on ? `${a.label} — on (click to turn off)` : `${a.label} — off (click to turn on)`}
              className={[
                "rounded-full px-2.5 py-1 text-xs font-medium transition",
                on
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-100 text-zinc-400 line-through hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-700",
              ].join(" ")}
            >
              {a.label} <span className="tabular-nums opacity-70">{a.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
