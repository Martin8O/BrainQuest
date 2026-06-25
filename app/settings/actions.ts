"use server";

// Server actions for the Settings page: validate a candidate vault folder and (on confirm) write it
// into vault.config.json. This is the ONE place the app takes a filesystem path from the UI, so each
// action re-validates from scratch — absolute path, exists, is a directory, has the configured note
// folders — and only ever WRITES vault.config.json (a fixed path); the vault itself stays read-only.
import fs from "node:fs";
import path from "node:path";
import { loadVaultConfig, invalidateVaultConfig } from "@/lib/vault/config";
import { invalidateTutorConfig, type TutorProvider } from "@/lib/tutor/config";

export interface PreviewResult {
  ok: boolean;
  error?: string;
  /** Normalised absolute path we'd save (forward slashes), present when ok. */
  resolved?: string;
  learningFolder?: string;
  conceptFolder?: string;
  learningCount?: number;
  conceptCount?: number;
}

/**
 * Write vault.config.json atomically (temp file, then rename) so a crash mid-write can't truncate the
 * load-bearing config — a corrupt one makes loadVaultConfig() throw on every page. Mirrors the stores.
 */
function writeConfigAtomic(file: string, raw: Record<string, unknown>): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/** Count markdown notes in a folder; null if the folder doesn't exist / can't be read. */
function countMarkdown(dir: string): number | null {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "_index.md").length;
  } catch {
    return null;
  }
}

/** Shared validation — pure read-only checks against the candidate folder. */
function validate(candidate: string): PreviewResult {
  const p = (candidate ?? "").trim();
  if (!p) return { ok: false, error: "Enter a vault folder path." };
  if (!path.isAbsolute(p)) {
    return { ok: false, error: "Path must be absolute — e.g. D:\\Projekty\\vault or /home/you/brain." };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return { ok: false, error: "That folder doesn't exist or isn't readable." };
  }
  if (!stat.isDirectory()) return { ok: false, error: "That path is a file, not a folder." };

  const cfg = loadVaultConfig();
  const learningCount = countMarkdown(path.join(p, cfg.folders.learning));
  const conceptCount = countMarkdown(path.join(p, cfg.folders.concepts));
  if (learningCount === null && conceptCount === null) {
    return {
      ok: false,
      error: `No "${cfg.folders.learning}" or "${cfg.folders.concepts}" subfolder here — point at the vault root.`,
    };
  }

  return {
    ok: true,
    resolved: p.replace(/\\/g, "/"),
    learningFolder: cfg.folders.learning,
    conceptFolder: cfg.folders.concepts,
    learningCount: learningCount ?? 0,
    conceptCount: conceptCount ?? 0,
  };
}

/** Validate a candidate path and report what was found — no write. */
export async function previewVault(candidate: string): Promise<PreviewResult> {
  return validate(candidate);
}

export interface SaveResult extends PreviewResult {
  saved?: string;
  /** True when BRAINQUEST_VAULT_PATH is set — it wins over the file, so the save won't take effect. */
  envOverride?: boolean;
}

/** Validate, then write the new vaultPath into vault.config.json (preserving every other key). */
export async function saveVaultPath(candidate: string): Promise<SaveResult> {
  const v = validate(candidate);
  if (!v.ok) return v;

  const file = path.join(process.cwd(), "vault.config.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  raw.vaultPath = v.resolved;
  writeConfigAtomic(file, raw);

  invalidateVaultConfig(); // so the next page read picks up the new path without a restart
  return { ...v, saved: v.resolved, envOverride: !!process.env.BRAINQUEST_VAULT_PATH };
}

export interface TutorSettings {
  provider: TutorProvider;
  model: string;
  /** Ollama host / OpenAI-compatible base URL; ignored for anthropic. */
  baseUrl: string;
}

/** Persist the tutor backend choice (provider/model/baseUrl) into vault.config.json — never the API key. */
export async function saveTutorSettings(s: TutorSettings): Promise<{ ok: boolean; error?: string }> {
  if (!["ollama", "anthropic", "openai"].includes(s.provider)) return { ok: false, error: "Unknown provider." };
  const model = (s.model ?? "").trim();
  if (!model) return { ok: false, error: "Enter a model name." };
  const baseUrl = (s.baseUrl ?? "").trim();
  if (s.provider === "openai" && baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, error: "Base URL must start with http:// or https://." };
  }

  const file = path.join(process.cwd(), "vault.config.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  raw.tutor = { provider: s.provider, model, baseUrl };
  writeConfigAtomic(file, raw);

  invalidateVaultConfig();
  invalidateTutorConfig();
  return { ok: true };
}
