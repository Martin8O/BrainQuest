# CLAUDE.md — BrainQuest (BrainQuest)

Lean, current guidance. Pointers, not prose. History → `dev_history.md`; rationale → `docs/adr.md`;
session resume → `local/SESSION_BOOTSTRAP.md`; teaching layer → `LEARNING_PROTOCOL.md` (§11).

## 1. What this is
**BrainQuest** builds **BrainQuest** — a Next.js learning app that reads Martin's cross-project Obsidian
vault `<vault>` (read-only) and turns it into an active learning game: spaced-repetition review,
a dependency-ordered **skill tree** with mastery/progress, a daily session, and an AI tutor. Goal: Martin
*absorbs* the 82 learning notes + 93 concepts fast, durably, and with momentum. "career" = his path into
AI-assisted software development. **Building it is itself his next learning project** (see §11).

## 2. Status
Phase 0 done (analysis + locked design + plan). Building from **A1**. Plan: `local/all-prompts.md`.

## 3. Key paths
- **This repo** `D:\Projekty\BrainQuest` → GitHub
  `https://github.com/Martin8O/BrainQuest.git` (repo + local folder renamed from `BrainQuest`; old URL still redirects).
- **`local/`** (gitignored) — the ONLY private home: Claude's memory, bootstrap, plan, prompt standard, scratch.
- **`<vault>`** — the CONTENT SOURCE (Obsidian vault). App reads it; the teaching layer writes
  learning/concept/hub notes into it (§11) **freely — no need to ask** (Martin authorized 2026-06-22). Just
  don't wholesale-refactor unrelated existing notes without a heads-up.
- **`data/`** (in repo) — app review state + progress (synced). **Secrets/API keys → `local/` only.**

## 4. Architecture (see `docs/architecture.md`)
Vault reader → harvest cards (`📘 Nové pojmy`) + recall prompts (`❓ K probrání příště`) + concept graph
(`Související`) → SRS scheduler (SM-2 → FSRS) persisted to `data/` → daily session UI + skill-tree map +
gamification → AI tutor via Claude API. Generalized to other vaults via `vault.config.json` (lean).

## 5. Stack & conventions
- **Next.js + TypeScript** (App Router) + Tailwind. Reuses the web skills from Example Project.
- Contracts in one place; data-driven extension (a registry/config as single source of truth).
- ONE-command quality gate (lint + types + tests + build) green before commit; but green ≠ correct — drive
  every feature end-to-end before "done".
- Reproducibility: any nondeterministic path takes an explicit seed.

## 6. Run commands
_(filled in at A1 once scaffolded)_ — `npm run dev`, `npm run build`, the quality-gate command.

## 7. Language & style
Explain in **Czech**, plain, **English-term-first** (term in English, gloss in Czech once). Code,
identifiers, comments, commit messages → **English**. In any `vault`-bound markdown: one physical line per
paragraph/bullet (Obsidian renders raw newlines as breaks).

## 8. The loop (how we work)
1. Martin: **"run X" / "let's start X"** (an ID from `local/all-prompts.md`) → I re-check the real repo state,
   finalize X against `local/Prompts requirements.md`, then **execute it directly — no approval pause**
   (Martin's standing call: the pause wastes context). I stop only if genuinely blocked / ambiguous / irreversible.
2. Execute X, doing the HEAVY verification DURING the prompt (quality gate + drive it live). Martin reviews; we iterate.
3. Martin: **"X is done"** → LEAN wrap-up: re-run gate, `/code-review` on substantial diffs, add the ADR row
   (`docs/adr.md`), changelog entry on top of `dev_history.md`, update the `SESSION_BOOTSTRAP.md` "Now" head,
   model-fit retro line, scoped commit (+ push only when authorized). Docs land at wrap-up, never silently mid-prompt.

## 9. Memory — HARD RULE
Martin's explicit standing instruction OVERRIDES the default: store **NOTHING** in `C:\Users\…\.claude\…`,
`%APPDATA%\Claude\memory`, or `~/.claude`. ALL durable memory + working files live under
`D:\Projekty\BrainQuest\local\` only. Index: `local/memory/MEMORY.md`.

## 10. Hard rules
- `local/` NEVER goes to git. `data/` **IS** committed (synced app state — see §3; never secrets). No
  secrets/keys/`.env`/`node_modules` committed. Scope every commit (`git status` first; no blind `git add -A`).
- Teaching-layer writes to `vault` are free (§11); avoid wholesale refactors of unrelated notes without a heads-up.
- **"X is done" pre-authorizes commit + push** (Martin's confirmed workflow, 2026-06-22). Still scope every commit.

## 11. Teaching layer — ALWAYS ON
Martin is a motivated **learner** learning toward an AI/tech career; the build must teach him. Governed by
**`LEARNING_PROTOCOL.md`** (read it). In short: during coding, do NOT explain teaching content in chat — as
each meaningful step finishes, WRITE a Czech, English-term-first teaching note to `<vault>\learning\`
(+ project-agnostic concept notes to `concepts\`), tag `#learning #project/brainquest`, link the hub
`[[BrainQuest]]`, and output ONLY the note's path in chat. Deeper discussion happens in a separate Phase-2
learning session that Martin starts himself.
