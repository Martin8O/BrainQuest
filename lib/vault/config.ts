import fs from "node:fs";
import path from "node:path";

/** Shape of vault.config.json (only the keys the reader uses — no dead config). */
export interface VaultConfig {
  vaultPath: string;
  folders: { learning: string; concepts: string };
  harvest: { cardsHeading: string; recallHeading: string; relatedHeading: string };
}

let cached: VaultConfig | null = null;

/**
 * Load vault.config.json from the repo root, once per process.
 * BRAINQUEST_VAULT_PATH overrides the path so the synced config still works on another machine.
 */
export function loadVaultConfig(): VaultConfig {
  if (cached) return cached;
  const file = path.join(process.cwd(), "vault.config.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as VaultConfig;
  cached = { ...raw, vaultPath: process.env.BRAINQUEST_VAULT_PATH ?? raw.vaultPath };
  return cached;
}
