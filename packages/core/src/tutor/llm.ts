// The ONE entry point both tutor features (grade D1, variations D2) use to get a schema-shaped JSON
// object from the configured LLM — whichever provider is selected. It dispatches to:
//   • ollama    → the local transport (./ollama.ts)
//   • anthropic → the Claude Messages API, using a forced tool call for structured output
//   • openai    → any OpenAI-compatible /chat/completions endpoint in JSON mode
// Callers stay provider-agnostic: they pass {system, user, schema} + the resolved TutorConfig and get
// back a parsed object, or one of the typed errors below. Browser-safe (fetch only, config injected —
// no fs/env): the client passes the user's own device-stored config. Ollama needs no key.
import { callOllamaJson, parseModelJson, OllamaOfflineError, ModelMissingError } from "./ollama";
import { effectiveBaseUrl, type TutorConfig } from "./clientConfig";

export { OllamaOfflineError, ModelMissingError };

/** Thrown when a paid provider rejects the request for auth reasons (missing/invalid API key). */
export class TutorAuthError extends Error {
  constructor(public provider: string) {
    super(`The ${provider} API key is missing or invalid — set TUTOR_API_KEY in local/.env.`);
    this.name = "TutorAuthError";
  }
}

/** Paid APIs are fast; cap a call so a hang can't wedge the request. */
const PAID_TIMEOUT_MS = 60_000;
/** Zero temperature everywhere → as reproducible as each provider allows (ollama also pins a seed). */
const TEMPERATURE = 0;

export interface TutorCall {
  system: string;
  user: string;
  /** JSON Schema the reply must match. */
  schema: unknown;
}

/** Get a schema-shaped JSON object from the given tutor backend config. */
export async function callTutorJson(args: TutorCall, cfg: TutorConfig): Promise<unknown> {
  const baseUrl = effectiveBaseUrl(cfg);
  switch (cfg.provider) {
    case "anthropic":
      return callAnthropicJson(args, baseUrl, cfg.model, cfg.apiKey);
    case "openai":
      return callOpenAiJson(args, baseUrl, cfg.model, cfg.apiKey);
    default:
      return callOllamaJson(args, { baseUrl, model: cfg.model });
  }
}

/** Claude Messages API: a single forced tool whose input_schema = our schema → the tool input IS the object. */
async function callAnthropicJson(args: TutorCall, baseUrl: string, model: string, apiKey?: string): Promise<unknown> {
  if (!apiKey) throw new TutorAuthError("Anthropic");
  const res = await paidFetch(`${baseUrl}/v1/messages`, {
    // `anthropic-dangerous-direct-browser-access` lets the call run from the browser (M2 is client-only);
    // it's a no-op on the server. The key is the user's own, kept in their device storage.
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: {
      model,
      max_tokens: 2048,
      temperature: TEMPERATURE,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      tools: [{ name: "emit", description: "Return the result in the required shape.", input_schema: args.schema }],
      tool_choice: { type: "tool", name: "emit" },
    },
    provider: "Anthropic",
  });
  const data = (await res.json()) as { content?: Array<{ type: string; input?: unknown; text?: string }> };
  const tool = data.content?.find((b) => b.type === "tool_use");
  if (tool?.input !== undefined) return tool.input;
  // Fallback: a model that answered in plain text rather than the tool.
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (text) return parseModelJson(text);
  throw new Error("Anthropic returned no structured output");
}

/** OpenAI-compatible /chat/completions in JSON mode. The schema is given in the system prompt as guidance. */
async function callOpenAiJson(args: TutorCall, baseUrl: string, model: string, apiKey?: string): Promise<unknown> {
  if (!apiKey) throw new TutorAuthError("OpenAI-compatible");
  const system = `${args.system}\n\nReturn ONLY a single JSON object matching this JSON schema (no prose):\n${JSON.stringify(
    args.schema,
  )}`;
  const res = await paidFetch(`${baseUrl}/chat/completions`, {
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: {
      model,
      temperature: TEMPERATURE,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: args.user },
      ],
    },
    provider: "OpenAI-compatible",
  });
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty response from the model");
  return parseModelJson(content);
}

/** Shared POST for paid providers: JSON body, timeout, and auth/error mapping. */
async function paidFetch(
  url: string,
  opts: { headers: Record<string, string>; body: unknown; provider: string },
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: opts.headers,
      signal: AbortSignal.timeout(PAID_TIMEOUT_MS),
      body: JSON.stringify(opts.body),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`${opts.provider} request timed out after ${PAID_TIMEOUT_MS / 1000}s.`);
    }
    throw new Error(`Could not reach the ${opts.provider} API. Check the base URL and your connection.`);
  }
  if (res.status === 401 || res.status === 403) throw new TutorAuthError(opts.provider);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${opts.provider} request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res;
}
