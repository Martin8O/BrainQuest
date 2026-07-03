// Browser-safe tutor backend config — types, defaults, and URL normalizers with NO fs and NO env access,
// so both the Node tools and the client app can share them. WHERE the config comes from differs by host
// (the client reads the user's own choice + key from local device storage; a Node caller could read env),
// but the SHAPE and the normalizers are one source of truth here. The three providers:
//   • "ollama"    — a free local server on the user's machine (no key, nothing leaves the box)
//   • "anthropic" — the paid Claude API
//   • "openai"    — any OpenAI-compatible API (OpenAI, Groq, OpenRouter, Together, a local proxy…)
export type TutorProvider = "ollama" | "anthropic" | "openai";

/** Fully-resolved tutor backend config that the transport (llm.ts) consumes. */
export interface TutorConfig {
  provider: TutorProvider;
  /** Ollama host, or the OpenAI-compatible API base. Anthropic uses its fixed base when this is empty. */
  baseUrl: string;
  /** Model id/tag for the chosen provider. */
  model: string;
  /** API key for a paid provider; undefined for ollama (or when no key is configured yet). */
  apiKey?: string;
}

export const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";
export const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
export const DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com";

/** Sensible default model per provider when none is chosen. */
export const DEFAULT_MODEL: Record<TutorProvider, string> = {
  ollama: "qwen2.5",
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
};

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Turn an Ollama host value into a URL we can connect TO. Ollama allows a bare "host:port" (no scheme)
 * and a bind-all "0.0.0.0" — neither works as a client target — so add http://, rewrite 0.0.0.0/:: to
 * loopback, and default the port. Returns "scheme://host:port".
 */
export function normalizeOllamaUrl(raw: string): string {
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

/** The base URL to actually call for a resolved config (fills the provider default when none is set). */
export function effectiveBaseUrl(cfg: TutorConfig): string {
  if (cfg.provider === "ollama") return normalizeOllamaUrl(cfg.baseUrl || DEFAULT_OLLAMA_BASE);
  if (cfg.provider === "openai") return stripTrailingSlash(cfg.baseUrl || DEFAULT_OPENAI_BASE);
  return stripTrailingSlash(cfg.baseUrl || DEFAULT_ANTHROPIC_BASE);
}
