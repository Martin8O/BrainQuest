// Server-only: resolve WHICH LLM backend the tutor uses and how to reach it. Three providers:
//   • "ollama"    — a free local server on the learner's machine (no key, nothing leaves the box)
//   • "anthropic" — the paid Claude API
//   • "openai"    — any OpenAI-compatible API (OpenAI, Groq, OpenRouter, Together, a local proxy…)
// The non-secret choice (provider / model / base URL) is persisted in vault.config.json and editable
// from the Settings page. The API KEY for a paid provider is read from local/.env or the environment
// and NEVER stored in the committed config. For "ollama" there is no key and no outbound network.
import fs from "node:fs";
import path from "node:path";
import { loadVaultConfig } from "../vault/config";

export type TutorProvider = "ollama" | "anthropic" | "openai";

/** Fully-resolved tutor backend config. */
export interface TutorConfig {
  provider: TutorProvider;
  /** Ollama host, or the OpenAI-compatible API base. Unused for anthropic (it has a fixed base). */
  baseUrl: string;
  /** Model id/tag for the chosen provider. */
  model: string;
  /** API key for a paid provider; undefined for ollama (or when no key is configured yet). */
  apiKey?: string;
}

const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";
const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";

/** Sensible default model per provider when neither config nor env names one. */
const DEFAULT_MODEL: Record<TutorProvider, string> = {
  ollama: "qwen2.5",
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
};

let cached: TutorConfig | null = null;

/** Parse a tiny KEY=VALUE .env file (no deps): ignores blanks/#comments, strips quotes. */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Resolve the tutor backend once per process.
 * Persisted choice (vault.config.json `tutor`) is the base; env vars override per setting:
 *   TUTOR_PROVIDER · TUTOR_MODEL · OLLAMA_HOST (ollama base) · TUTOR_BASE_URL (openai base).
 * The key is picked from local/.env or process.env: TUTOR_API_KEY, then provider-specific names.
 */
export function loadTutorConfig(): TutorConfig {
  if (cached) return cached;

  let fileVars: Record<string, string> = {};
  try {
    fileVars = parseEnvFile(fs.readFileSync(path.join(process.cwd(), "local", ".env"), "utf8"));
  } catch {
    // no local/.env → fine; ollama needs no key, paid providers will report a missing key when called
  }
  const pick = (key: string): string | undefined => process.env[key]?.trim() || fileVars[key]?.trim() || undefined;

  const persisted = loadVaultConfig().tutor;
  const provider = (pick("TUTOR_PROVIDER") ?? persisted.provider) as TutorProvider;
  const model = pick("TUTOR_MODEL") ?? persisted.model ?? DEFAULT_MODEL[provider];

  let baseUrl: string;
  if (provider === "ollama") {
    baseUrl = normalizeOllamaUrl(pick("OLLAMA_HOST") ?? persisted.baseUrl ?? DEFAULT_OLLAMA_BASE);
  } else if (provider === "openai") {
    baseUrl = stripTrailingSlash(pick("TUTOR_BASE_URL") ?? persisted.baseUrl ?? DEFAULT_OPENAI_BASE);
  } else {
    baseUrl = stripTrailingSlash(pick("TUTOR_BASE_URL") ?? "https://api.anthropic.com");
  }

  const apiKey =
    provider === "ollama"
      ? undefined
      : pick("TUTOR_API_KEY") ??
        (provider === "anthropic" ? pick("ANTHROPIC_API_KEY") : pick("OPENAI_API_KEY") ?? pick("GROQ_API_KEY"));

  cached = { provider, baseUrl, model, apiKey };
  return cached;
}

/** Drop the per-process cache so the next read re-resolves (used after the Settings page writes config). */
export function invalidateTutorConfig(): void {
  cached = null;
}

/**
 * Whether SOME tutor API key is available (in process.env or local/.env) — for the Settings UI to show
 * "key detected" without ever revealing the value. Provider-agnostic: any of the known key names counts.
 */
export function hasTutorApiKey(): boolean {
  let fileVars: Record<string, string> = {};
  try {
    fileVars = parseEnvFile(fs.readFileSync(path.join(process.cwd(), "local", ".env"), "utf8"));
  } catch {
    // no local/.env
  }
  return ["TUTOR_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY"].some(
    (k) => (process.env[k]?.trim() || fileVars[k]?.trim()) !== undefined && (process.env[k]?.trim() || fileVars[k]?.trim()) !== "",
  );
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Turn an OLLAMA_HOST value into a URL we can connect TO. Ollama allows a bare "host:port" (no scheme)
 * and a bind-all "0.0.0.0" — neither works as a client target — so add http://, rewrite 0.0.0.0/:: to
 * loopback, and default the port. Returns "scheme://host:port".
 */
function normalizeOllamaUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.hostname === "0.0.0.0" || u.hostname === "::") u.hostname = "127.0.0.1";
    if (!u.port) u.port = "11434";
    return u.origin;
  } catch {
    return DEFAULT_OLLAMA_BASE;
  }
}
