"use client";

// Picks the AI tutor's LLM backend: free local Ollama, or a paid API (Anthropic, or any OpenAI-compatible
// service — OpenAI / Groq / OpenRouter / …). Saves the NON-secret choice to vault.config.json; the API key
// itself stays in local/.env and is never typed here — we only show whether one was detected.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Cpu, Sparkles, Globe, CheckCircle2, AlertCircle, KeyRound, Save } from "lucide-react";
import { saveTutorSettings, type TutorSettings } from "./actions";
import type { TutorProvider } from "@/lib/tutor/config";

const PROVIDERS: {
  id: TutorProvider;
  label: string;
  blurb: string;
  icon: typeof Cpu;
  paid: boolean;
  modelHint: string;
  baseHint?: string;
}[] = [
  { id: "ollama", label: "Local (Ollama)", blurb: "Free · private · no key", icon: Cpu, paid: false, modelHint: "qwen2.5", baseHint: "http://127.0.0.1:11434" },
  { id: "anthropic", label: "Anthropic (Claude)", blurb: "Paid API", icon: Sparkles, paid: true, modelHint: "claude-haiku-4-5-20251001" },
  { id: "openai", label: "OpenAI-compatible", blurb: "OpenAI · Groq · OpenRouter…", icon: Globe, paid: true, modelHint: "gpt-4o-mini", baseHint: "https://api.openai.com/v1" },
];

export default function TutorSettingsClient({
  current,
  keyPresent,
}: {
  current: TutorSettings;
  keyPresent: boolean;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<TutorProvider>(current.provider);
  const [model, setModel] = useState(current.model);
  const [baseUrl, setBaseUrl] = useState(current.baseUrl);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = PROVIDERS.find((p) => p.id === provider)!;
  const showBase = provider !== "anthropic";

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveTutorSettings({ provider, model, baseUrl });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save.");
      }
    });
  }

  return (
    <section className="my-8 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 text-sm font-semibold">AI tutor backend</h2>
      <p className="mb-4 text-xs text-zinc-500">
        Grade answers and generate question variations with a free local model, or a paid API.
      </p>

      {/* Provider picker */}
      <div className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const Icon = p.icon;
          const on = provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProvider(p.id);
                setSaved(false);
                setError(null);
              }}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                on
                  ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/40"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
              }`}
            >
              <Icon className={`h-5 w-5 ${on ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-400"}`} strokeWidth={2} />
              <span className="text-sm font-medium">{p.label}</span>
              <span className="text-xs text-zinc-500">{p.blurb}</span>
            </button>
          );
        })}
      </div>

      {/* Model + base URL */}
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Model</span>
          <input
            type="text"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setSaved(false);
            }}
            spellCheck={false}
            placeholder={active.modelHint}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        {showBase && (
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {provider === "ollama" ? "Ollama host" : "API base URL"}
            </span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setSaved(false);
              }}
              spellCheck={false}
              placeholder={active.baseHint}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        )}
      </div>

      {/* Key status for paid providers */}
      {active.paid && (
        <p
          className={`mt-3 flex items-center gap-2 text-xs ${
            keyPresent ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
          }`}
        >
          <KeyRound className="h-4 w-4 shrink-0" />
          {keyPresent ? (
            <span>API key detected in your environment / local/.env.</span>
          ) : (
            <span>
              No API key found — add <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">TUTOR_API_KEY=…</code> to{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">local/.env</code> (never committed).
            </span>
          )}
        </p>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={pending || !model.trim()}
        className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <Save className="h-4 w-4" /> Save tutor settings
      </button>

      {error && (
        <p className="mt-3 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {saved && (
        <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Saved — the tutor now uses {active.label}.
        </p>
      )}
    </section>
  );
}
