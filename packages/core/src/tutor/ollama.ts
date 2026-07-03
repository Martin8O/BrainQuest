// The SINGLE transport to an Ollama server. Both the grader (D1) and the question-variation generator
// (D2) talk to Ollama through here, so the offline / model-missing / timeout handling and the
// structured-output (JSON schema) request shape live in ONE place instead of being forked per feature.
// No API key. Browser-safe: it takes the resolved {baseUrl, model} as an argument (no fs, no env), so it
// runs on the server OR in the client (M2). The fixed seed + zero temperature make every call
// reproducible (the §5 fence). NOTE for the browser: Ollama must allow the app's origin via OLLAMA_ORIGINS.

/** Fixed seed + zero temperature → identical input grades / generates the same way (reproducibility). */
const SEED = 7;
/** Local models on CPU can be slow on the first token; give one call plenty of room. */
const TIMEOUT_MS = 180_000;

/** Thrown when the local Ollama server can't be reached (it isn't running). */
export class OllamaOfflineError extends Error {
  constructor(public baseUrl: string) {
    super(`Ollama is not reachable at ${baseUrl}`);
    this.name = "OllamaOfflineError";
  }
}

/** Thrown when Ollama is up but the configured model hasn't been pulled. */
export class ModelMissingError extends Error {
  constructor(public model: string) {
    super(`Model "${model}" is not available in Ollama`);
    this.name = "ModelMissingError";
  }
}

/** Shape of the bits of Ollama's /api/chat response we read. */
interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

/**
 * Parse the model's reply into an object, tolerating a "thinking" model that prepends reasoning.
 * Ollama's `format` schema normally keeps message.content as clean JSON, but if a model leaks a
 * `<think>…</think>` block or stray prose, strip it and grab the outermost {…} so the call still works.
 */
export function parseModelJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error("Model did not return parseable JSON");
  }
}

/**
 * One schema-constrained chat turn against the local model; returns the parsed JSON object.
 * @throws OllamaOfflineError when the server is down · ModelMissingError when the model isn't pulled
 *         · Error on timeout or any other request/parse failure. Callers validate the object's shape.
 */
export async function callOllamaJson(
  args: {
    system: string;
    user: string;
    /** JSON Schema the reply is constrained to (Ollama "structured outputs"). */
    schema: unknown;
  },
  cfg: { baseUrl: string; model: string },
): Promise<unknown> {
  const { baseUrl, model } = cfg;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        stream: false,
        format: args.schema, // Ollama structured outputs: constrain the reply to the schema
        options: { temperature: 0, seed: SEED },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
    });
  } catch (err) {
    // A timed-out abort means the server IS up but too slow — don't mislabel that as "offline".
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`Request timed out after ${TIMEOUT_MS / 1000}s — the model is too slow. Try a smaller TUTOR_MODEL.`);
    }
    // Otherwise the fetch was refused (ECONNREFUSED) → Ollama isn't listening.
    throw new OllamaOfflineError(baseUrl);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Ollama answers 404 with "model '…' not found" when the tag hasn't been pulled.
    if (res.status === 404 || /not found|try pulling/i.test(body)) throw new ModelMissingError(model);
    throw new Error(`Ollama request failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (data.error) {
    if (/not found|try pulling/i.test(data.error)) throw new ModelMissingError(model);
    throw new Error(`Ollama error: ${data.error}`);
  }
  const content = data.message?.content?.trim();
  if (!content) throw new Error("Empty response from the model");
  return parseModelJson(content);
}
