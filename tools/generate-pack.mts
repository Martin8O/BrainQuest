// BrainQuest AI pack generator (M4.1) — turn a brief into DRAFT vault-shaped markdown a human then curates.
//
// It does NOT emit pack.json. It writes editable `.md` notes (learning/ + concepts/) in the exact harvest
// convention, so you review/fix them in Obsidian and then run the EXISTING compiler on them:
//     npm run pack:generate -- --topic "LLM literacy" --out local/generated/llm-literacy
//     # …curate the drafts in Obsidian…
//     npm run pack:build -- --in local/generated/llm-literacy --out local/packs/llm-literacy.json \
//        --id llm-literacy --name "LLM Literacy" --lang en
//
// Generation is staged (outline+DAG → per-concept bodies → per-lesson cards+recall) via the SAME
// provider-abstracted LLM transport the tutor uses (Ollama free / Anthropic / OpenAI). Pick the provider with
// --provider (default: the tutor block in vault.config.json). A paid key comes from TUTOR_API_KEY (local/.env).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { loadVaultConfig } from "@brainquest/core/vault/config";
import { slugify } from "@brainquest/core/vault/parse";
import {
  DEFAULT_MODEL,
  type TutorConfig,
  type TutorProvider,
} from "@brainquest/core/tutor/clientConfig";
import {
  callTutorJson,
  ModelMissingError,
  OllamaOfflineError,
  TutorAuthError,
} from "@brainquest/core/tutor/llm";
import {
  buildDraftFiles,
  conceptSystem,
  conceptUser,
  CONCEPT_SCHEMA,
  lessonSchema,
  lessonSystem,
  lessonUser,
  normalizeOutline,
  outlineSystem,
  outlineUser,
  OUTLINE_SCHEMA,
  parseConceptBody,
  parseGenLesson,
  parseOutline,
  type ConceptBody,
  type GenLesson,
  type PackOutline,
} from "@brainquest/core/pack/generate";

const PROVIDERS: readonly TutorProvider[] = ["ollama", "anthropic", "openai"];

interface Args {
  topic: string | null;
  audience: string;
  lang: string;
  concepts: number;
  out: string | null;
  seed: string | null;
  id: string | null;
  name: string | null;
  provider: TutorProvider | null;
  model: string | null;
  baseUrl: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    topic: null,
    audience: "curious beginners",
    lang: "en",
    concepts: 12,
    out: null,
    seed: null,
    id: null,
    name: null,
    provider: null,
    model: null,
    baseUrl: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") { a.help = true; continue; }
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const key = flag.slice(2);
    const value = argv[++i];
    if (value === undefined) throw new Error(`Flag --${key} needs a value.`);
    switch (key) {
      case "topic": a.topic = value; break;
      case "audience": a.audience = value; break;
      case "lang": a.lang = value; break;
      case "concepts": {
        a.concepts = Number(value);
        if (!Number.isInteger(a.concepts) || a.concepts <= 0) {
          throw new Error(`--concepts must be a positive integer, got "${value}".`);
        }
        break;
      }
      case "out": a.out = value; break;
      case "seed": a.seed = value; break;
      case "id": a.id = value; break;
      case "name": a.name = value; break;
      case "provider": {
        if (!(PROVIDERS as readonly string[]).includes(value)) {
          throw new Error(`--provider must be one of ${PROVIDERS.join(" | ")}, got "${value}".`);
        }
        a.provider = value as TutorProvider;
        break;
      }
      case "model": a.model = value; break;
      case "base-url": a.baseUrl = value; break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return a;
}

const HELP = `BrainQuest AI pack generator — brief → draft vault-shaped markdown (then curate + compile).

Usage:
  tsx tools/generate-pack.mts --topic "<topic>" [--out <dir>] [options]

  --topic <t>       REQUIRED. What the pack teaches, e.g. "LLM literacy for non-engineers".
  --audience <a>    Who it's for (default: "curious beginners").
  --lang <code>     Content language (default: en).
  --concepts <n>    Target concept count, positive integer (default: 12).
  --seed <file>     Optional source material (.md/.txt) to ground the pack in.
  --out <dir>       Output folder for the drafts (default: local/generated/<id>).
  --id <slug>       Pack id → the project/<id> tag (default: slug of the topic).
  --name <name>     Pack display name → the note hub (default: the topic).

  --provider <p>    ollama | anthropic | openai (default: vault.config.json tutor block).
  --model <m>       Model id (default: provider's default).
  --base-url <u>    Override the provider base URL / Ollama host.
                    A paid key is read from TUTOR_API_KEY (local/.env).
`;

/** A transport error that means EVERY subsequent call will fail too → abort the run instead of skipping items. */
function isSystemicError(err: unknown): boolean {
  return err instanceof OllamaOfflineError || err instanceof ModelMissingError || err instanceof TutorAuthError;
}

/** Load KEY=VALUE lines from local/.env into process.env (no dep) so TUTOR_API_KEY resolves per convention. */
function loadLocalEnv(): void {
  const file = path.join(process.cwd(), "local", ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

/** Resolve the LLM backend: CLI flags win, else the vault.config.json tutor block, key from TUTOR_API_KEY. */
function resolveTutorConfig(a: Args): TutorConfig {
  const cfg = loadVaultConfig();
  const provider = a.provider ?? (cfg.tutor.provider as TutorProvider);
  // Derive model/baseUrl from the EFFECTIVE provider so they can't disagree (a CLI --provider without --model
  // takes that provider's default; the config block is used only when no --provider was given).
  const model = a.model ?? (a.provider ? DEFAULT_MODEL[provider] : cfg.tutor.model);
  const baseUrl = a.baseUrl ?? (a.provider ? "" : cfg.tutor.baseUrl);
  const apiKey = process.env.TUTOR_API_KEY;
  return { provider, model, baseUrl, apiKey: apiKey || undefined };
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(HELP); return; }
  if (!a.topic) { console.error("Missing --topic. Run with --help for usage.\n"); process.exit(2); }

  loadLocalEnv();
  const id = a.id ?? slugFromTopic(a.topic);
  const name = a.name ?? a.topic;
  const outDir = a.out ?? path.join("local", "generated", id);
  const tutor = resolveTutorConfig(a);
  if (tutor.provider !== "ollama" && !tutor.apiKey) {
    console.error(`Provider "${tutor.provider}" needs an API key — set TUTOR_API_KEY in local/.env.\n`);
    process.exit(2);
  }
  const seed = a.seed ? await fsp.readFile(a.seed, "utf8") : undefined;

  console.log("BrainQuest AI pack generator");
  console.log(`  topic:    ${a.topic}`);
  console.log(`  provider: ${tutor.provider} (${tutor.model})`);
  console.log(`  output:   ${outDir}`);
  console.log("");

  // --- Stage 1: outline + prerequisite DAG (unguarded — nothing to lose yet; a failure aborts the run) ------
  console.log("① Outlining concepts + prerequisite graph…");
  const raw: PackOutline = parseOutline(
    await callTutorJson(
      {
        system: outlineSystem(a.lang),
        user: outlineUser({ topic: a.topic, audience: a.audience, conceptCount: a.concepts, seed }),
        schema: OUTLINE_SCHEMA,
      },
      tutor,
    ),
  );
  const { outline, dropped } = normalizeOutline(raw);
  console.log(`   → ${outline.concepts.length} concepts, ${outline.lessons.length} lessons.`);
  if (outline.concepts.length === 0) throw new Error("The outline has no concepts — nothing to generate.");
  for (const d of dropped) {
    console.warn(`   ⚠ ${d.kind} "${d.slug}" on "${d.owner}" references no known concept — dropped.`);
  }

  const titleBySlug = new Map(outline.concepts.map((c) => [c.slug, c.title]));
  const glossBySlug = new Map(outline.concepts.map((c) => [c.slug, c.gloss]));
  let skipped = 0;

  // --- Stage 2: one body per concept --------------------------------------------------------------------
  const conceptBodies: Record<string, ConceptBody> = {};
  for (const [i, c] of outline.concepts.entries()) {
    process.stdout.write(`② Concept ${i + 1}/${outline.concepts.length}: ${c.title}… `);
    try {
      conceptBodies[c.slug] = parseConceptBody(
        await callTutorJson(
          {
            system: conceptSystem(a.lang),
            user: conceptUser({
              title: c.title,
              gloss: c.gloss,
              topic: a.topic,
              prereqTitles: c.prerequisites.map((s) => titleBySlug.get(s)).filter((t): t is string => Boolean(t)),
            }),
            schema: CONCEPT_SCHEMA,
          },
          tutor,
        ),
      );
      console.log("ok");
    } catch (err) {
      if (isSystemicError(err)) throw err; // offline / bad key / missing model → abort, don't skip N times
      console.log(`skipped (${(err as Error).message})`);
      skipped++;
    }
  }

  // --- Stage 3: one lesson (cards + recall) per lesson --------------------------------------------------
  const lessons: Record<string, GenLesson> = {};
  for (const [i, l] of outline.lessons.entries()) {
    process.stdout.write(`③ Lesson ${i + 1}/${outline.lessons.length}: ${l.title}… `);
    if (l.conceptSlugs.length === 0) {
      console.log("skipped (no concepts)");
      skipped++;
      continue;
    }
    const conceptsForLesson = l.conceptSlugs.map((s) => ({
      slug: s,
      title: titleBySlug.get(s) ?? s,
      gloss: glossBySlug.get(s) ?? "",
    }));
    try {
      lessons[l.slug] = parseGenLesson(
        await callTutorJson(
          {
            system: lessonSystem(a.lang),
            user: lessonUser({ title: l.title, topic: a.topic, concepts: conceptsForLesson }),
            schema: lessonSchema(l.conceptSlugs),
          },
          tutor,
        ),
      );
      console.log(`ok (${lessons[l.slug].cards.length} cards)`);
    } catch (err) {
      if (isSystemicError(err)) throw err;
      console.log(`skipped (${(err as Error).message})`);
      skipped++;
    }
  }

  // --- Emit draft files (fresh: clear prior generated notes so a re-run can't leave stale files behind) ---
  const files = buildDraftFiles({ outline, conceptBodies, lessons, packId: id, packName: name, lang: a.lang });
  if (files.length === 0) throw new Error("No notes were generated (every stage was skipped).");
  await fsp.rm(path.join(outDir, "learning"), { recursive: true, force: true });
  await fsp.rm(path.join(outDir, "concepts"), { recursive: true, force: true });
  await fsp.mkdir(path.join(outDir, "learning"), { recursive: true });
  await fsp.mkdir(path.join(outDir, "concepts"), { recursive: true });
  await Promise.all(files.map((f) => fsp.writeFile(path.join(outDir, f.relPath), f.content, "utf8")));

  console.log("");
  console.log(`Wrote ${files.length} draft note(s) to ${outDir}${skipped ? ` (${skipped} stage(s) skipped)` : ""}`);
  console.log("Next: curate the drafts in Obsidian, then compile them:");
  console.log(
    `  npm run pack:build -- --in ${outDir} --out local/packs/${id}.json ` +
      `--id ${id} --name "${name}" --lang ${a.lang}`,
  );
  if (skipped) process.exitCode = 1; // partial output is a loud, non-zero outcome, not silent success
}

/** Slug a free-text topic into a stable pack id via core's slugify (kept consistent with the compiler). */
function slugFromTopic(topic: string): string {
  return slugify(topic) || "pack";
}

main().catch((err) => {
  console.error(`\nGeneration failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
