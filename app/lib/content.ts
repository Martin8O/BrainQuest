// Client-side content loading (M2): the app fetches its compiled pack + presentation config as static
// assets instead of reading the vault from a server. `npm run app:data` writes these into public/:
//   • /pack.json        — the compiled content bundle (loaded into the same VaultSnapshot the app always used)
//   • /app-config.json  — the non-secret vault.config.json (area labels, tag scheme, harvest headings)
//   • /reviews.seed.json — optional one-time seed of existing review progress (see BrainProvider)
// Everything here runs in the browser (fetch), never on a server.
import { loadPack } from "@brainquest/core/pack/loader";
import { validatePack, type Pack } from "@brainquest/core/pack/types";
import { resolveVaultConfig, type VaultConfig } from "@brainquest/core/vault/configTypes";
import { parseReviewStore } from "@brainquest/core/srs/reviewStore";
import type { ReviewStore } from "@brainquest/core/srs/types";
import type { VaultSnapshot } from "@brainquest/core/vault/types";

/** Everything one content load yields: the raw pack (for note bodies) + its assembled snapshot + config. */
export interface LoadedContent {
  pack: Pack;
  snapshot: VaultSnapshot;
  config: VaultConfig;
}

/** Fetch + validate the pack and app config, producing the model the app renders. Throws with a helpful
 *  message when the pack asset is missing (i.e. `npm run app:data` hasn't been run). */
export async function loadContent(): Promise<LoadedContent> {
  const packRes = await fetch("/pack.json", { cache: "no-store" }).catch(() => null);
  if (!packRes || !packRes.ok) {
    throw new Error("No content pack found. Run `npm run app:data` to compile one into public/pack.json.");
  }
  const rawPack: unknown = await packRes.json();
  validatePack(rawPack);
  const pack = rawPack;
  const snapshot = loadPack(pack);

  // App config is best-effort: defaults boot the app if the file is absent.
  let config: VaultConfig;
  try {
    const cfgRes = await fetch("/app-config.json", { cache: "no-store" });
    const rawCfg: unknown = cfgRes.ok ? await cfgRes.json() : {};
    config = resolveVaultConfig((rawCfg ?? {}) as Partial<VaultConfig>);
  } catch {
    config = resolveVaultConfig({});
  }

  return { pack, snapshot, config };
}

/** Fetch the optional review-progress seed (the migrated data/reviews.json). Null when absent. */
export async function loadReviewSeed(): Promise<ReviewStore | null> {
  try {
    const res = await fetch("/reviews.seed.json", { cache: "no-store" });
    if (!res.ok) return null;
    return parseReviewStore(await res.json());
  } catch {
    return null;
  }
}
