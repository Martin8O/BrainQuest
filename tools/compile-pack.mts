// BrainQuest pack compiler (M1) — turn content into a validated, distributable pack.json.
//
// Inputs (auto-detected from --in; defaults to the configured Obsidian vault):
//   • vault mode  — a directory holding learning/ + concepts/ subfolders (an Obsidian vault).
//   • folder mode — any other directory of .md files (each classified learning/concept by its content).
//   • doc mode    — a single .md file split into notes on its H1 headings.
// It parses with packages/core (so a pack can never drift from what the app reads), validates the content
// (missing links, orphan concepts, empty notes, duplicate slugs, dependency cycles — helpful messages),
// prints a report, and emits pack.json. Exit code is non-zero when errors exist (or, with --strict, warnings).
//
//   npm run pack:build                          → compile the configured vault → local/dev-pack.json
//   npm run pack:build -- out.json              → …to a custom output path
//   tsx tools/compile-pack.mts --in <path> --out <path> [--strict] [--check] [manifest flags]
//
// Manifest flags: --id --name --lang --version --author --license --description
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { loadVaultConfig } from "@brainquest/core/vault/config";
import { readFolder } from "@brainquest/core/vault/folders";
import {
  classifyNote,
  parseConceptNote,
  parseLearningNote,
  splitDocIntoNotes,
} from "@brainquest/core/vault/parse";
import type { ConceptNote, LearningNote } from "@brainquest/core/vault/types";
import { buildPack } from "@brainquest/core/pack/build";
import type { PackManifest } from "@brainquest/core/pack/types";
import { formatIssues, packStats, summarize, validatePackContent } from "@brainquest/core/pack/validate";

type Mode = "vault" | "folder" | "doc";

/** Parsed CLI arguments (flags + a backward-compatible positional output path). */
interface Args {
  in: string | null;
  out: string;
  strict: boolean;
  check: boolean;
  help: boolean;
  manifest: Partial<PackManifest>;
}

const FLAG_KEYS = ["in", "out", "id", "name", "lang", "version", "author", "license", "description"] as const;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    in: null,
    out: path.join("local", "dev-pack.json"),
    strict: false,
    check: false,
    help: false,
    manifest: {},
  };
  let positionalOut: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") args.strict = true;
    else if (a === "--check") args.check = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const value = argv[++i];
      if (value === undefined) throw new Error(`Flag --${key} needs a value.`);
      if (key === "in") args.in = value;
      else if (key === "out") args.out = value;
      else if ((FLAG_KEYS as readonly string[]).includes(key)) {
        (args.manifest as Record<string, string>)[key] = value;
      } else throw new Error(`Unknown flag: ${a}`);
    } else if (positionalOut === null) positionalOut = a; // back-compat: `pack:build -- out.json`
  }
  if (positionalOut !== null) args.out = positionalOut;
  return args;
}

const HELP = `BrainQuest pack compiler

Usage:
  tsx tools/compile-pack.mts [--in <path>] [--out <path>] [--strict] [--check] [manifest flags]

  --in <path>    Vault dir (learning/ + concepts/), a folder of .md, or a single .md doc.
                 Defaults to the vault in vault.config.json.
  --out <path>   Output pack.json (default: local/dev-pack.json). Also settable positionally.
  --strict       Treat warnings as failures (non-zero exit).
  --check        Validate only; do not write the pack.

Manifest: --id --name --lang --version --author --license --description
`;

/** A parsed note plus the source text to store in the pack (keyed later by the note's path). */
interface Collected {
  learning: LearningNote[];
  concepts: ConceptNote[];
  bodies: Map<string, string>;
}

/** Read the input in the detected mode into parsed notes + their bodies. */
async function collect(
  mode: Mode,
  inPath: string,
  cfg: ReturnType<typeof loadVaultConfig>,
): Promise<Collected> {
  const learning: LearningNote[] = [];
  const concepts: ConceptNote[] = [];
  const bodies = new Map<string, string>();

  if (mode === "vault") {
    const [learnFiles, conceptFiles] = await Promise.all([
      readFolder(path.join(inPath, cfg.folders.learning)),
      readFolder(path.join(inPath, cfg.folders.concepts)),
    ]);
    for (const f of learnFiles) {
      learning.push(parseLearningNote(f.slug, f.path, f.md, cfg));
      bodies.set(f.path, f.md);
    }
    for (const f of conceptFiles) {
      concepts.push(parseConceptNote(f.slug, f.path, f.md, cfg));
      bodies.set(f.path, f.md);
    }
    return { learning, concepts, bodies };
  }

  if (mode === "folder") {
    for (const f of await readFolder(inPath)) {
      if (classifyNote(f.md, cfg) === "learning") learning.push(parseLearningNote(f.slug, f.path, f.md, cfg));
      else concepts.push(parseConceptNote(f.slug, f.path, f.md, cfg));
      bodies.set(f.path, f.md);
    }
    return { learning, concepts, bodies };
  }

  // doc mode: one file → many notes split on H1.
  const md = await fsp.readFile(inPath, "utf8");
  for (const s of splitDocIntoNotes(md)) {
    const synthPath = `${inPath}#${s.slug}`; // unique per section, so bodies don't collide
    if (classifyNote(s.body, cfg) === "learning") learning.push(parseLearningNote(s.slug, synthPath, s.body, cfg));
    else concepts.push(parseConceptNote(s.slug, synthPath, s.body, cfg));
    bodies.set(synthPath, s.body);
  }
  return { learning, concepts, bodies };
}

/** Detect the input mode from a path (a .md file → doc; a vault-shaped dir → vault; else folder). */
function detectMode(inPath: string, cfg: ReturnType<typeof loadVaultConfig>): Mode {
  const stat = fs.statSync(inPath);
  if (stat.isFile()) return inPath.endsWith(".md") ? "doc" : "folder";
  const hasVaultShape =
    fs.existsSync(path.join(inPath, cfg.folders.learning)) &&
    fs.existsSync(path.join(inPath, cfg.folders.concepts));
  return hasVaultShape ? "vault" : "folder";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const cfg = loadVaultConfig();
  const inPath = args.in ?? cfg.vaultPath;
  const mode = args.in ? detectMode(inPath, cfg) : "vault";

  const { learning, concepts, bodies } = await collect(mode, inPath, cfg);

  const manifest: PackManifest = {
    id: args.manifest.id ?? "brainquest-dev",
    name: args.manifest.name ?? "BrainQuest Dev Pack",
    lang: args.manifest.lang ?? "cs",
    version: args.manifest.version ?? "0.0.0-dev",
    author: args.manifest.author ?? "Martin",
    license: args.manifest.license ?? "All rights reserved",
    description: args.manifest.description ?? `Pack compiled from ${inPath} (${mode} mode).`,
  };

  const pack = buildPack(manifest, learning, concepts, (n) => bodies.get(n.path) ?? "");
  const stats = packStats(pack);
  const issues = validatePackContent(pack);
  const { errors, warnings } = summarize(issues);

  console.log("BrainQuest pack compiler");
  console.log(`  input:  ${inPath} (${mode} mode)`);
  console.log(`  output: ${args.check ? "(validate only — not written)" : args.out}`);
  console.log(
    `Content: ${stats.notes} notes · ${stats.concepts} concepts · ` +
      `${stats.cards} cards · ${stats.recall} recall · ${stats.edges} edges`,
  );
  console.log(`Validation: ${errors} error(s), ${warnings} warning(s)`);
  console.log(formatIssues(issues));

  if (!args.check) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(pack, null, 2) + "\n", "utf8");
    console.log(`Wrote ${args.out}`);
  }

  const failed = errors > 0 || (args.strict && warnings > 0);
  if (failed) {
    console.error(
      `\nCompile ${errors > 0 ? "failed" : "failed (--strict)"}: ` +
        `${errors} error(s), ${warnings} warning(s).`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
