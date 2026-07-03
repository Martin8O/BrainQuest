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
import {
  DEFAULT_MODEL,
  type TutorConfig,
  type TutorProvider,
} from "@brainquest/core/tutor/clientConfig";
import { callTutorJson } from "@brainquest/core/tutor/llm";
import {
  buildDraftFiles,
  conceptSystem,
  conceptUser,
  CONCEPT_SCHEMA,
  lessonSystem,
  lessonUser,
  LESSON_SCHEMA,
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
      case "concepts": a.concepts = Number(value); break;
      case "out": a.out = value; break;
      case "seed": a.seed = value; break;
      case "id": a.id = value; break;
      case "name": a.name = value; break;
      case "provider": a.provider = value as TutorProvider; break;
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
  --concepts <n>    Target concept count (default: 12).
  --seed <file>     Optional source material (.md/.txt) to ground the pack in.
  --out <dir>       Output folder for the drafts (default: local/generated/<id>).
  --id <slug>       Pack id → the project/<id> tag (default: slug of the topic).
  --name <name>     Pack display name → the note hub (default: the topic).

  --provider <p>    ollama | anthropic | openai (default: vault.config.json tutor block).
  --model <m>       Model id (default: provider's default).
  --base-url <u>    Override the provider base URL / Ollama host.
                    A paid key is read from TUTOR_API_KEY (local/.env).
`;

/** Slugify a free-text topic into a stable pack id (mirrors core's slugify rules — kept local to the tool). */
function slugifyTopic(s: string): string {
  return s.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
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
  const id = a.id ?? slugifyTopic(a.topic);
  const name = a.name ?? a.topic;
  const outDir = a.out ?? path.join("local", "generated", id);
  const tutor = resolveTutorConfig(a);
  const seed = a.seed ? await fsp.readFile(a.seed, "utf8") : undefined;

  console.log("BrainQuest AI pack generator");
  console.log(`  topic:    ${a.topic}`);
  console.log(`  provider: ${tutor.provider} (${tutor.model})`);
  console.log(`  output:   ${outDir}`);
  console.log("");

  // --- Stage 1: outline + prerequisite DAG ---------------------------------------------------------------
  console.log("① Outlining concepts + prerequisite graph…");
  const outline: PackOutline = parseOutline(
    await callTutorJson(
      {
        system: outlineSystem(a.lang),
        user: outlineUser({ topic: a.topic, audience: a.audience, conceptCount: a.concepts, seed }),
        schema: OUTLINE_SCHEMA,
      },
      tutor,
    ),
  );
  console.log(`   → ${outline.concepts.length} concepts, ${outline.lessons.length} lessons.`);

  const titleBySlug = new Map(outline.concepts.map((c) => [c.slug, c.title]));

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
      console.log(`skipped (${(err as Error).message})`);
    }
  }

  // --- Stage 3: one lesson (cards + recall) per lesson --------------------------------------------------
  const lessons: Record<string, GenLesson> = {};
  for (const [i, l] of outline.lessons.entries()) {
    process.stdout.write(`③ Lesson ${i + 1}/${outline.lessons.length}: ${l.title}… `);
    const conceptsForLesson = l.conceptSlugs
      .map((s) => outline.concepts.find((c) => c.slug === s))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({ title: c.title, gloss: c.gloss }));
    try {
      lessons[l.slug] = parseGenLesson(
        await callTutorJson(
          {
            system: lessonSystem(a.lang),
            user: lessonUser({ title: l.title, topic: a.topic, concepts: conceptsForLesson }),
            schema: LESSON_SCHEMA,
          },
          tutor,
        ),
      );
      console.log(`ok (${lessons[l.slug].cards.length} cards)`);
    } catch (err) {
      console.log(`skipped (${(err as Error).message})`);
    }
  }

  // --- Emit draft files ---------------------------------------------------------------------------------
  const files = buildDraftFiles({ outline, conceptBodies, lessons, packId: id, packName: name, lang: a.lang });
  for (const f of files) {
    const abs = path.join(outDir, f.relPath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, f.content, "utf8");
  }

  console.log("");
  console.log(`Wrote ${files.length} draft note(s) to ${outDir}`);
  console.log("Next: curate the drafts in Obsidian, then compile them:");
  console.log(
    `  npm run pack:build -- --in ${outDir} --out local/packs/${id}.json ` +
      `--id ${id} --name "${name}" --lang ${a.lang}`,
  );
}

main().catch((err) => {
  console.error(`\nGeneration failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
