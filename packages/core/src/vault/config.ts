// Node/fs loader for vault.config.json. The config CONTRACT (shape, defaults, pure merge, accessors) lives
// in ./configTypes.ts so it stays importable from the browser build too; this file only adds the on-disk
// read + the BRAINQUEST_VAULT_PATH env override. Re-exports the pure bits so existing Node importers keep
// their entry point.
import fs from "node:fs";
import path from "node:path";
import { resolveVaultConfig, type VaultConfig } from "./configTypes";

export { headingList, primaryHeading, resolveVaultConfig, type VaultConfig } from "./configTypes";

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
  cached = resolveVaultConfig(raw, process.env.BRAINQUEST_VAULT_PATH);
  return cached;
}

/**
 * Drop the per-process cache so the next loadVaultConfig() re-reads the file. Call this right after
 * writing vault.config.json (the Settings page) so a vault switch takes effect without a restart.
 */
export function invalidateVaultConfig(): void {
  cached = null;
}
