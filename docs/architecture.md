# Architecture — BrainQuest

A Next.js + TypeScript app that turns an Obsidian vault (`<vault>`, read-only) into an
active learning game. This doc is the durable mental model; the "why"
of decisions in `docs/adr.md`, the backlog in `local/all-prompts.md`.

## Data flow (end to end)
```
vault/*.md  ──►  Vault reader  ──►  Harvester  ──►  Scheduler (SRS)  ──►  Daily session UI
(read-only)       (parse md +        (cards from        (per-card due/        + Skill-tree map
                   frontmatter)       Nové pojmy,         stability, in         + Gamification
                                      recall from         data/*.json)          + AI tutor (Claude API)
                                      K probrání;
                                      edges from
                                      Související)
```

## Components
- **Vault reader** (server) — reads the vault folder; parses frontmatter, tags, headings, `[[wikilinks]]`.
  Configurable path/headings/tags via `vault.config.json` (with sensible built-in defaults).
- **Harvester** — turns note structure into a typed model:
  - `📘 Nové pojmy` bullets → **flashcards** (front = term/question, back = CZ gloss + link).
  - `❓ K probrání příště` → **recall prompts** (open-ended; AI-graded later).
  - `Související` links + cluster order → the **concept graph** edges.
- **Scheduler** — spaced repetition. SM-2 first (simple, testable); FSRS later. Per-card review state persisted
  to `data/reviews.json`. Pure, seedable, unit-tested.
- **Mastery model** — per-concept mastery derived from its cards' retention; overall + per-cluster progress
  ("umím vs. co mě čeká", grows as the vault grows). Derived, not stored.
- **UI** — daily session (flip card, grade), skill-tree map (nodes = concepts, color = mastery, locked/unlocked
  by prerequisites), gamification (streak, XP/levels, attractive theme).
- **AI tutor** (server route → Claude API) — grades free-text recall answers, explains misses using the note's
  own text, generates question variations. API key in `local/.env` (never committed).

## State & boundaries
- **Read-only:** the Obsidian vault. The app never writes to it (the teaching layer is a separate, manual path).
- **Local state:** `data/*.json` (review history, progress) — per-device, gitignored (not shipped).
- **Private:** `local/` (memory, secrets, plan) — gitignored, never leaves the machine.

## Generalization (lean)
`vault.config.json` makes the vault path, harvested headings, and tag scheme configurable so BrainQuest can run
on *other* Obsidian brains — with good built-in defaults. Kept to config + defaults, not a plugin platform
(never inflate generality at the cost of learning speed).
