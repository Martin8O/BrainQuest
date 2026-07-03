// A short, stable fingerprint of a note's text, used to invalidate a cached question ladder when the note
// changes. Uses the Web Crypto API (`crypto.subtle`), which exists both in the browser and in Node ≥ 20,
// so the same hashing works in the client app and in any tooling. Async by nature of the API.
/** First 16 hex of the note text's SHA-256 — enough to detect any edit. */
export async function hashNoteText(noteText: string): Promise<string> {
  const bytes = new TextEncoder().encode(noteText);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
