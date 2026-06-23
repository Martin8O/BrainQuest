# BrainQuest

Turn an Obsidian knowledge vault into an active learning game — **spaced repetition + a skill-tree of
concepts + an AI tutor** — so you actually *absorb* what you've written down, not just store it.

Built as a learning project by Martin (a learner learning toward an AI/tech career) together with an AI
coding agent. It reads a cross-project "second brain" vault **read-only** and turns its dated learning notes
and atomic concept notes into scheduled flashcards, recall prompts, and a visual mastery map.

> Status: **working through Phase E (generalize + harden).** Phases A–D are live: the vault reader, harvested
> cards + concept graph, an SM-2 spaced-repetition scheduler, a daily session, a mastery model, a visual
> skill tree, gamification, and a local-LLM tutor. Build plan + design live in `docs/` and the private
> `local/` working area.

## What's inside
- **Skill tree + progress** — see how much you already know vs. everything still ahead (which grows as the
  vault grows). Concepts unlock along a dependency-ordered path.
- **Daily session** — a short spaced-repetition review (SM-2) of what's due today.
- **AI tutor** — grades your free-text recall answers and generates fresh question phrasings, running on a
  **local LLM via Ollama** (no cloud API, no key). Optional — every other page works without it.

## Stack
Next.js (App Router) + TypeScript + Tailwind. Review/progress state is JSON under `data/` (committed, synced).
The vault stays read-only. The AI tutor talks to a local [Ollama](https://ollama.com) server. Unit tests run
on [Vitest](https://vitest.dev).

## Run
```
npm install
npm run dev            # http://localhost:3000
```
The vault path comes from `vault.config.json` (override per-machine with the `BRAINQUEST_VAULT_PATH` env var).
For the AI tutor, run a local Ollama with the configured model (defaults to `qwen2.5`); without it, the rest
of the app still works and the tutor shows a friendly "offline" message.

## Point at another vault
BrainQuest defaults to one specific `vault`, but it reads *how* to read a vault from `vault.config.json` —
so you can point it at a different Obsidian brain by editing config, not code. No data migration: your review
progress in `data/` is untouched, and the vault itself is only ever read.

Edit `vault.config.json`:
- `vaultPath` — the vault folder (or set the `BRAINQUEST_VAULT_PATH` env var per-machine, which wins).
- `folders` — the subfolders holding learning notes and concept notes.
- `harvest` — the section headings to harvest: cards, recall prompts, and the related-concepts list.
- `tags` — `hubPrefix` (the line naming a note's hub, e.g. `Patří k:`) and `projectTagPrefix` (e.g. `project/`).
- `areas` — friendly `labels` per project slug for the tutor's category filter, and `offByDefault` slugs hidden
  until you opt in.

Any section you omit falls back to the built-in `vault` defaults, so a minimal config still boots.

## Quality gate
One command runs the whole gate — types, lint, unit tests, production build — and must be green before a commit:
```
npm run check          # tsc --noEmit  +  eslint  +  vitest run  +  next build
```
Individual steps: `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`.

### Tests
Unit tests cover the **pure, risky logic** — the markdown parser, the SM-2 scheduler, mastery/progress
aggregation, the gamification engine (XP/levels/streaks), the tutor's difficulty ladder + cache, and the
skill-tree lock derivation — colocated as `lib/**/*.test.ts`. They are deterministic (every clock and seed is
injected) and need no network, so the gate is reproducible.
```
npm test               # run once
npm run test:watch     # re-run on change
```
The tutor's **live** LLM round-trip is non-deterministic and needs a running Ollama, so it's intentionally not
unit-tested — it's exercised by hand in the tutor UI.

## Docs
- `docs/architecture.md` — how it works.
- `docs/adr.md` — the key decisions and why.
- `dev_history.md` — changelog.
