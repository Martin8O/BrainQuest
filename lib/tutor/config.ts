// Server-only: resolve where the local LLM lives and which model to use. Ollama runs an
// unauthenticated HTTP server on the learner's own machine, so there is NO secret here — just a
// host + model name, both overridable from local/.env or the environment. Nothing reaches the network.
import fs from "node:fs";
import path from "node:path";

/** Where to reach Ollama and which model grades answers. */
export interface TutorConfig {
  /** Base URL of the local Ollama server (no trailing slash). */
  baseUrl: string;
  /** Model tag to run, e.g. "llama3.1" — must be pulled (`ollama pull <model>`). */
  model: string;
}

/** Built-in defaults — a stock local Ollama on its default port. qwen2.5 (7B) is a strong
 *  multilingual NON-thinking model with reliable schema-constrained JSON, which fits Czech grading.
 *  (Thinking models like qwen3.x proved flaky here: thinking-on drops the heavy constrained request,
 *  thinking-off ignores the JSON schema and returns prose. A bigger non-thinking model — e.g.
 *  qwen2.5:14b via TUTOR_MODEL — is the safe upgrade path.) */
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5";

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
 * Resolve the tutor (Ollama) config once per process.
 * Precedence per setting: process.env wins, then local/.env, then the built-in default.
 * `OLLAMA_HOST` sets the server URL; `TUTOR_MODEL` sets the model tag.
 */
export function loadTutorConfig(): TutorConfig {
  if (cached) return cached;
  let fileVars: Record<string, string> = {};
  try {
    fileVars = parseEnvFile(fs.readFileSync(path.join(process.cwd(), "local", ".env"), "utf8"));
  } catch {
    // no local/.env → defaults are fine for a stock local Ollama
  }
  const pick = (key: string, fallback: string) =>
    process.env[key]?.trim() || fileVars[key]?.trim() || fallback;
  cached = {
    baseUrl: normalizeBaseUrl(pick("OLLAMA_HOST", DEFAULT_BASE_URL)),
    model: pick("TUTOR_MODEL", DEFAULT_MODEL),
  };
  return cached;
}

/**
 * Turn an OLLAMA_HOST value into a URL we can actually connect TO. Ollama's convention allows a
 * bare "host:port" (no scheme) and a bind-all "0.0.0.0" — neither works as a client target — so we
 * add http://, rewrite 0.0.0.0/:: to loopback, and default the port. Returns "scheme://host:port".
 */
function normalizeBaseUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.hostname === "0.0.0.0" || u.hostname === "::") u.hostname = "127.0.0.1";
    if (!u.port) u.port = "11434";
    return u.origin;
  } catch {
    return DEFAULT_BASE_URL;
  }
}
