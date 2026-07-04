// Client-side static-asset fetchers (M2, extended M4.3). The app ships a bundled "built-in" pack and its
// presentation config as static assets under public/ (written by `npm run app:data`):
//   • /pack.json        — the built-in content bundle (the free pilot / Martin's vault)
//   • /app-config.json  — the non-secret vault.config.json (area labels, tag scheme, harvest headings)
//   • /reviews.seed.json — optional one-time seed of existing review progress (see packStore)
// Everything here runs in the browser (fetch), never on a server. Imported packs live in IndexedDB
// (packStore.ts); these fetchers only concern the bundled/built-in assets.
import { loadPack } from "@brainquest/core/pack/loader";
import { validatePack, type Pack } from "@brainquest/core/pack/types";
import { resolveVaultConfig, type VaultConfig } from "@brainquest/core/vault/configTypes";
import { parseReviewStore } from "@brainquest/core/srs/reviewStore";
import type { ReviewStore } from "@brainquest/core/srs/types";

// loadPack is re-exported so callers can assemble a snapshot without a second import path.
export { loadPack };

/**
 * Fetch + validate the bundled built-in pack (public/pack.json). Returns null when the asset is missing
 * (i.e. `npm run app:data` hasn't been run) so the caller can fall back to imported packs only.
 */
export async function fetchBuiltinPack(): Promise<Pack | null> {
  const res = await fetch("/pack.json", { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return null;
  const raw: unknown = await res.json();
  validatePack(raw);
  return raw;
}

/** Fetch the app presentation config; defaults boot the app if the file is absent/unreadable. */
export async function loadAppConfig(): Promise<VaultConfig> {
  try {
    const res = await fetch("/app-config.json", { cache: "no-store" });
    const raw: unknown = res.ok ? await res.json() : {};
    return resolveVaultConfig((raw ?? {}) as Partial<VaultConfig>);
  } catch {
    return resolveVaultConfig({});
  }
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
