import fs from "node:fs";
import path from "node:path";

/** Shape of vault.config.json — the single source of truth for where the vault is and how to read it. */
export interface VaultConfig {
  vaultPath: string;
  folders: { learning: string; concepts: string };
  harvest: { cardsHeading: string; recallHeading: string; relatedHeading: string };
  /** Tag scheme — the conventions a vault uses to mark hubs and projects (E1: configurable per brain). */
  tags: {
    /** Line prefix that names a note's hub, e.g. "Patří k:" → `Patří k: [[Hub]]`. */
    hubPrefix: string;
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
}

/**
 * Baked structural defaults. vault.config.json is the canonical, full `vault` example a new brain copies;
 * these defaults only fill in any section a partial config omits, so the app boots instead of crashing on
 * an undefined key. `vault`-specific data (the area `labels` map) lives solely in the JSON — not duplicated here.
 */
const DEFAULTS: VaultConfig = {
  vaultPath: "D:/path/to/your/vault",
  folders: { learning: "learning", concepts: "concepts" },
  harvest: { cardsHeading: "📘 Nové pojmy", recallHeading: "❓ K probrání příště", relatedHeading: "Související" },
  tags: { hubPrefix: "Patří k:", projectTagPrefix: "project/" },
  areas: { labels: {}, offByDefault: [] },
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
  };
  return cached;
}
