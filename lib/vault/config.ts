import fs from "node:fs";
import path from "node:path";

/** Shape of vault.config.json — the single source of truth for where the vault is and how to read it. */
export interface VaultConfig {
  vaultPath: string;
  folders: { learning: string; concepts: string };
  /**
   * Section headings to harvest. Each may be a single heading OR a list of accepted aliases — the parser
   * matches a note's heading against ANY of them, so one vault can mix languages and a new brain works in
   * English out of the box while a Czech brain ([[vault]]) keeps using its headings. The FIRST entry is
   * the "primary" one the UI shows when telling you which heading to add.
   */
  harvest: {
    cardsHeading: string | string[];
    recallHeading: string | string[];
    relatedHeading: string | string[];
  };
  /** Tag scheme — the conventions a vault uses to mark hubs and projects (E1: configurable per brain). */
  tags: {
    /** Line prefix(es) that name a note's hub, e.g. "Belongs to:" → `Belongs to: [[Hub]]`. A list accepts aliases. */
    hubPrefix: string | string[];
    /** Tag prefix that marks a note's project, e.g. "project/" → `#project/brainquest`. */
    projectTagPrefix: string;
  };
  /** Tutor area presentation — how project slugs surface as focusable categories. */
  areas: {
    /** Friendly labels per project slug (without the project-tag prefix); unknown slugs are prettified. */
    labels: Record<string, string>;
    /** Slugs hidden by default in the tutor (niche/deep material the learner opts into). */
    offByDefault: string[];
  };
  /** AI tutor backend (NON-secret bits only — the API key lives in local/.env, never here). */
  tutor: {
    /** Which LLM backend grades/varies: free local "ollama", or a paid "anthropic" / "openai" API. */
    provider: "ollama" | "anthropic" | "openai";
    /** Model id/tag for the chosen provider (e.g. "qwen2.5", "claude-haiku-4-5-20251001", "gpt-4o-mini"). */
    model: string;
    /** Ollama host, or the OpenAI-compatible API base URL (OpenAI / Groq / OpenRouter / …). Unused for anthropic. */
    baseUrl: string;
  };
}

/**
 * Baked structural defaults. vault.config.json is the canonical, full `vault` example a new brain copies;
 * these defaults only fill in any section a partial config omits, so the app boots instead of crashing on
 * an undefined key. `vault`-specific data (the area `labels` map) lives solely in the JSON — not duplicated here.
 */
const DEFAULTS: VaultConfig = {
  vaultPath: "D:/path/to/your/vault",
  folders: { learning: "learning", concepts: "concepts" },
  // English headings are primary (so a fresh brain works with no config); the no-emoji and Czech variants
  // are accepted aliases so existing notes — and other-language vaults — keep harvesting without changes.
  harvest: {
    cardsHeading: ["📘 New concepts", "New concepts", "📘 Nové pojmy"],
    recallHeading: ["❓ To review next", "To review next", "❓ K probrání příště"],
    relatedHeading: ["Related", "Související"],
  },
  tags: { hubPrefix: ["Belongs to:", "Patří k:"], projectTagPrefix: "project/" },
  areas: { labels: {}, offByDefault: [] },
  tutor: { provider: "ollama", model: "qwen2.5", baseUrl: "http://127.0.0.1:11434" },
};

let cached: VaultConfig | null = null;

/**
 * Load vault.config.json from the repo root, once per process, merged over DEFAULTS so a partial config
 * (another brain that omits a section) still boots.
 * BRAINQUEST_VAULT_PATH overrides the path so the synced config still works on another machine.
 */
export function loadVaultConfig(): VaultConfig {
  if (cached) return cached;
  const file = path.join(process.cwd(), "vault.config.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<VaultConfig>;
  cached = {
    vaultPath: process.env.BRAINQUEST_VAULT_PATH ?? raw.vaultPath ?? DEFAULTS.vaultPath,
    folders: { ...DEFAULTS.folders, ...raw.folders },
    harvest: { ...DEFAULTS.harvest, ...raw.harvest },
    tags: { ...DEFAULTS.tags, ...raw.tags },
    areas: { ...DEFAULTS.areas, ...raw.areas },
    tutor: { ...DEFAULTS.tutor, ...raw.tutor },
  };
  return cached;
}

/**
 * Drop the per-process cache so the next loadVaultConfig() re-reads the file. Call this right after
 * writing vault.config.json (the Settings page) so a vault switch takes effect without a restart.
 */
export function invalidateVaultConfig(): void {
  cached = null;
}

/** Normalize a heading-or-aliases value to the list of accepted headings. */
export function headingList(h: string | string[]): string[] {
  return Array.isArray(h) ? h : [h];
}

/** The primary (first) heading — what the UI shows when telling the user which heading to add. */
export function primaryHeading(h: string | string[]): string {
  return Array.isArray(h) ? (h[0] ?? "") : h;
}
