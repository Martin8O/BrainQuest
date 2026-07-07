"use client";

import Link from "next/link";
import {
  Brain,
  FolderOpen,
  BookOpenCheck,
  TrendingUp,
  Network,
  GraduationCap,
  FileText,
  Lightbulb,
  Layers,
  HelpCircle,
  Share2,
  Link2,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import type { Card, ConceptNote, LearningNote } from "@brainquest/core/vault/types";
import { ensureStates, selectDue } from "@brainquest/core/srs/scheduler";
import { computeProgress, gamificationFor } from "@brainquest/core/progress/mastery";
import { Hud } from "./components/Hud";
import { useBrain } from "./lib/BrainProvider";
import { PageError, PageLoading } from "./lib/PageStatus";

const CARD_PREVIEW_COUNT = 12;

export default function Home() {
  const { status, error, snapshot, config, store } = useBrain();
  if (status === "loading") return <PageLoading label="Loading your content…" />;
  if (status === "error" || !snapshot || !config) return <PageError error={error} />;

  const now = new Date();
  const vault = snapshot;
  const { cards, recall, graph } = vault.harvest;

  // How many cards are due right now — drives the "start session" call to action.
  const dueCount = selectDue(
    ensureStates(
      store,
      cards.map((c) => c.id),
      now,
    ),
    now,
  ).length;

  // Overall mastery — the "how much do I know" headline, links to the full progress view.
  const progress = computeProgress(vault.harvest, vault.learning, store);
  const masteryPct = Math.round(progress.overall.avgStrength * 100);

  // The motivation HUD: level, XP, streak — derived from the lifetime activity log + mastery (C3).
  const gamification = gamificationFor(progress, store, now);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-10 text-center">
        <div className="mb-3 inline-flex items-center gap-3">
          <span className="level-gem grid h-12 w-12 place-items-center rounded-2xl text-white">
            <Brain className="h-6 w-6" strokeWidth={2} />
          </span>
          <h1 className="text-gradient text-4xl font-extrabold tracking-tight sm:text-5xl">BrainQuest</h1>
        </div>
        <p className="mx-auto max-w-2xl text-zinc-600 dark:text-zinc-400">
          Your <code className="rounded-md bg-zinc-900/5 px-1.5 py-0.5 text-[0.85em] dark:bg-white/10">vault</code> vault,
          harvested into cards, recall prompts, and a concept graph — the raw material for the spaced-repetition game.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-zinc-900/5 bg-zinc-900/[0.03] px-3 py-1 font-mono text-xs text-zinc-400 dark:border-white/5 dark:bg-white/5">
          <FolderOpen className="h-3.5 w-3.5" /> {vault.vaultPath}
        </p>
      </header>

      <Hud g={gamification} className="mb-8" />

      <div className="mb-12 grid gap-4 sm:grid-cols-2">
        <NavCard
          href="/session"
          icon={BookOpenCheck}
          tone="indigo"
          title="Daily session"
          desc={dueCount > 0 ? "Flip, recall, grade what's due today." : "You're all caught up — nothing due."}
          stat={dueCount}
          unit="due"
        />
        <NavCard
          href="/progress"
          icon={TrendingUp}
          tone="emerald"
          title="Progress"
          desc="How much you know vs. what's still ahead."
          stat={`${masteryPct}%`}
          unit="mastery"
        />
        <NavCard
          href="/map"
          icon={Network}
          tone="violet"
          title="Skill tree"
          desc="Every concept and how they connect."
          stat={vault.concepts.length}
          unit="concepts"
        />
        <NavCard
          href="/tutor"
          icon={GraduationCap}
          tone="fuchsia"
          title="AI tutor"
          desc="Answer in your words — an AI grades it."
          stat={recall.length}
          unit="prompts"
        />
      </div>

      {!vault.ok && (
        <div className="mb-8 rounded-xl border border-red-300/70 bg-red-50/80 p-4 text-sm text-red-800 backdrop-blur dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-200">
          Could not read the vault. {vault.error}
        </div>
      )}

      <section className="mb-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat icon={FileText} label="Learning notes" value={vault.learning.length} tone="sky" />
        <Stat icon={Lightbulb} label="Concepts" value={vault.concepts.length} tone="amber" />
        <Stat icon={Layers} label="Cards" value={cards.length} tone="indigo" />
        <Stat icon={HelpCircle} label="Recall prompts" value={recall.length} tone="fuchsia" />
        <Stat icon={Share2} label="Graph edges" value={graph.edges.length} tone="violet" />
      </section>

      <section className="mb-12">
        <SectionHeading icon={Layers} title="Harvested cards">
          First {Math.min(CARD_PREVIEW_COUNT, cards.length)} of {cards.length}, parsed from your notes.
        </SectionHeading>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.slice(0, CARD_PREVIEW_COUNT).map((c) => (
            <CardPreview key={c.id} card={c} />
          ))}
        </ul>
      </section>

      <section className="mb-12">
        <SectionHeading icon={FileText} title="Learning notes" count={vault.learning.length} />
        <ul className="space-y-2">
          {vault.learning.map((n) => (
            <LearningRow key={n.slug} note={n} />
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading icon={Lightbulb} title="Concepts" count={vault.concepts.length}>
          {graph.nodes.length} nodes · {graph.edges.length} edges in the concept graph.
        </SectionHeading>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vault.concepts.map((c) => (
            <ConceptCard key={c.slug} note={c} />
          ))}
        </ul>
      </section>
    </main>
  );
}

/** Per-accent class sets — written as literal strings so Tailwind's JIT keeps them. */
const TONES = {
  indigo: {
    border: "border-indigo-200/80 hover:border-indigo-400/70 dark:border-indigo-500/25 dark:hover:border-indigo-400/50",
    bg: "bg-white/70 dark:bg-indigo-950/20",
    glow: "hover:shadow-xl hover:shadow-indigo-500/15",
    blob: "bg-indigo-500/15 group-hover:bg-indigo-500/25",
    icon: "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/30",
    stat: "text-indigo-600 dark:text-indigo-300",
  },
  emerald: {
    border: "border-emerald-200/80 hover:border-emerald-400/70 dark:border-emerald-500/25 dark:hover:border-emerald-400/50",
    bg: "bg-white/70 dark:bg-emerald-950/20",
    glow: "hover:shadow-xl hover:shadow-emerald-500/15",
    blob: "bg-emerald-500/15 group-hover:bg-emerald-500/25",
    icon: "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30",
    stat: "text-emerald-600 dark:text-emerald-300",
  },
  violet: {
    border: "border-violet-200/80 hover:border-violet-400/70 dark:border-violet-500/25 dark:hover:border-violet-400/50",
    bg: "bg-white/70 dark:bg-violet-950/20",
    glow: "hover:shadow-xl hover:shadow-violet-500/15",
    blob: "bg-violet-500/15 group-hover:bg-violet-500/25",
    icon: "bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-md shadow-violet-500/30",
    stat: "text-violet-600 dark:text-violet-300",
  },
  fuchsia: {
    border: "border-fuchsia-200/80 hover:border-fuchsia-400/70 dark:border-fuchsia-500/25 dark:hover:border-fuchsia-400/50",
    bg: "bg-white/70 dark:bg-fuchsia-950/20",
    glow: "hover:shadow-xl hover:shadow-fuchsia-500/15",
    blob: "bg-fuchsia-500/15 group-hover:bg-fuchsia-500/25",
    icon: "bg-gradient-to-br from-fuchsia-500 to-fuchsia-600 text-white shadow-md shadow-fuchsia-500/30",
    stat: "text-fuchsia-600 dark:text-fuchsia-300",
  },
} as const;

function NavCard({
  href,
  icon: Icon,
  tone,
  title,
  desc,
  stat,
  unit,
}: {
  href: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  title: string;
  desc: string;
  stat: number | string;
  unit: string;
}) {
  const t = TONES[tone];
  return (
    <Link
      href={href}
      className={`bq-lift group relative flex flex-col gap-4 overflow-hidden rounded-2xl border ${t.border} ${t.bg} ${t.glow} p-5 shadow-sm`}
    >
      {/* Soft accent glow drifting out of the corner — brightens on hover. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl transition-colors duration-300 ${t.blob}`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${t.icon} transition-transform duration-200 group-hover:scale-105`}
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="text-right leading-none">
          <div className={`text-3xl font-bold tabular-nums ${t.stat}`}>{stat}</div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">{unit}</div>
        </div>
      </div>
      <div className="relative">
        <div className="flex items-center gap-1 text-base font-semibold">
          {title}
          <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{desc}</p>
      </div>
    </Link>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Icon className="h-5 w-5 text-zinc-400" strokeWidth={2} />
        {title}
        {count != null && <span className="font-normal text-zinc-400">({count})</span>}
      </h2>
      {children && <p className="mt-1 text-sm text-zinc-500">{children}</p>}
    </div>
  );
}

/** Tinted icon chip per stat — literal class strings so Tailwind's JIT keeps them. */
const STAT_TONES: Record<string, string> = {
  sky: "bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  amber: "bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-400",
  fuchsia: "bg-fuchsia-500/10 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-400",
  violet: "bg-violet-500/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400",
};

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: keyof typeof STAT_TONES }) {
  return (
    <div className="bq-lift rounded-2xl border border-zinc-200/80 bg-white/70 p-4 shadow-sm hover:border-zinc-300 hover:shadow-md dark:border-white/10 dark:bg-zinc-900/60 dark:hover:border-white/20">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${STAT_TONES[tone]}`}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="mt-3 text-[1.75rem] font-bold leading-none tabular-nums">{value}</div>
      <div className="mt-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  );
}

function CardPreview({ card }: { card: Card }) {
  return (
    <li className="flex flex-col rounded-xl border border-zinc-200/80 bg-white/70 p-3.5 shadow-sm transition duration-200 hover:border-indigo-300/70 hover:shadow-md dark:border-white/10 dark:bg-zinc-900/60 dark:hover:border-indigo-400/40">
      <div className="font-medium">{card.front}</div>
      <p className="mt-1 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{card.back}</p>
      {card.conceptLink && (
        <span className="mt-2 inline-flex items-center gap-1 self-start rounded-md bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300">
          <Link2 className="h-3 w-3" /> {card.conceptLink}
        </span>
      )}
    </li>
  );
}

function LearningRow({ note }: { note: LearningNote }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-200/80 bg-white/70 p-3.5 shadow-sm transition duration-200 hover:border-zinc-300 hover:shadow-md dark:border-white/10 dark:bg-zinc-900/60 dark:hover:border-white/20 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="truncate font-medium">{note.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {note.date && <span className="font-mono">{note.date}</span>}
          {note.projects.map((p) => (
            <span key={p} className="rounded-md bg-zinc-900/5 px-1.5 py-0.5 dark:bg-white/10">
              #{p}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1" title="harvested cards">
          <Layers className="h-3.5 w-3.5" /> {note.cards.length}
        </span>
        <span className="inline-flex items-center gap-1" title="recall prompts">
          <HelpCircle className="h-3.5 w-3.5" /> {note.recall.length}
        </span>
      </div>
    </li>
  );
}

function ConceptCard({ note }: { note: ConceptNote }) {
  return (
    <li className="flex flex-col rounded-xl border border-zinc-200/80 bg-white/70 p-3.5 shadow-sm transition duration-200 hover:border-violet-300/70 hover:shadow-md dark:border-white/10 dark:bg-zinc-900/60 dark:hover:border-violet-400/40">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{note.title}</span>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500"
          title="related concepts"
        >
          <Share2 className="h-3 w-3" /> {note.edges.length}
        </span>
      </div>
      {note.gloss && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{note.gloss}</p>}
    </li>
  );
}
