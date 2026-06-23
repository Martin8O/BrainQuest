// Server-only: the one place that calls the local LLM. It reads the source note (READ-ONLY —
// never writes the vault) and asks a local Ollama model to grade the learner's answer against it,
// constraining the reply to our JSON schema (Ollama "structured outputs"). No API key, no network
// beyond localhost. Imported only by the "use server" tutor action.
import fs from "node:fs/promises";
import { loadTutorConfig } from "./config";
import { GRADE_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, isVerdict } from "./prompt";
import type { GradeResult } from "./types";

/** Fixed seed + zero temperature → the same answer grades the same way (reproducibility fence). */
const SEED = 7;
/** Local models on CPU can be slow on the first token; give the grade plenty of room. */
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

/** Read a learning note from disk (read-only). Bubbles up if the path is gone. */
async function readNote(sourcePath: string): Promise<string> {
  return fs.readFile(sourcePath, "utf8");
}

/**
 * Parse the model's reply into an object, tolerating a "thinking" model that prepends reasoning.
 * Ollama's `format` schema normally keeps message.content as clean JSON, but if a model leaks a
 * `<think>…</think>` block or stray prose, strip it and grab the outermost {…} so grading still works.
 */
function parseModelJson(content: string): unknown {
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

/** Validate the model's JSON into a GradeResult, clamping score and defaulting arrays. */
function toGradeResult(raw: unknown): GradeResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const verdict = isVerdict(o.verdict) ? o.verdict : "partial";
  const scoreNum = typeof o.score === "number" ? o.score : Number(o.score);
  const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : 0;
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    verdict,
    score,
    summary: typeof o.summary === "string" ? o.summary : "",
    gotRight: asStrings(o.gotRight),
    missed: asStrings(o.missed),
    modelAnswer: typeof o.modelAnswer === "string" ? o.modelAnswer : "",
  };
}

/**
 * Grade one free-text answer against its source note via a local Ollama model.
 * @throws OllamaOfflineError when the server is down · ModelMissingError when the model isn't pulled
 *         · Error on any other request/parse failure.
 */
export async function gradeAnswer(args: {
  question: string;
  sourcePath: string;
  answer: string;
}): Promise<GradeResult> {
  const { baseUrl, model } = loadTutorConfig();
  const noteText = await readNote(args.sourcePath);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        stream: false,
        format: GRADE_SCHEMA, // Ollama structured outputs: constrain the reply to our schema
        options: { temperature: 0, seed: SEED },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(args.question, noteText, args.answer) },
        ],
      }),
    });
  } catch (err) {
    // A timed-out abort means the server IS up but too slow — don't mislabel that as "offline".
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`Grading timed out after ${TIMEOUT_MS / 1000}s — the model is too slow. Try a smaller TUTOR_MODEL.`);
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
  if (!content) throw new Error("Empty grading response from the model");
  return toGradeResult(parseModelJson(content));
}
