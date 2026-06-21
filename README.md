# BrainQuest (BrainQuest)

Turn an Obsidian knowledge vault into an active learning game — **spaced repetition + a skill-tree of
concepts + an AI tutor** — so you actually *absorb* what you've written down, not just store it.

Built as a learning project by Martin (a learner learning toward an AI/tech career) together with an AI
coding agent. It reads a cross-project "second brain" vault **read-only** and turns its dated learning notes
and atomic concept notes into scheduled flashcards, recall prompts, and a visual mastery map.

> Status: **early — scaffolding.** Build plan and design live in the project docs (`docs/`) and the private
> `local/` working area.

## What's inside
- **Skill tree + progress** — see how much you already know vs. everything still ahead (which grows as the
  vault grows). Concepts unlock along a dependency-ordered path.
- **Daily session** — a short spaced-repetition review of what's due today.
- **AI tutor** — grades your free-text answers and explains the misses (optional; uses the Claude API).

## Stack
Next.js + TypeScript + Tailwind. Review/progress state is JSON under `data/`.

## Run
_(added once scaffolded — `npm install` then `npm run dev`.)_

## Docs
- `docs/architecture.md` — how it works.
- `docs/adr.md` — the key decisions and why.
- `dev_history.md` — changelog.
