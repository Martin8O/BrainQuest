"use client";

// Configures the AI tutor's LLM backend, stored on THIS device (localStorage) — the client-only model:
// free local Ollama, or a paid API (Anthropic, or any OpenAI-compatible service). The tutor is OFF by
// default; nothing is sent anywhere until you enable it and pick a backend. Your API key is entered here
// and kept in this browser only (it is sent solely to the backend you choose). For local Ollama in the
// browser, Ollama must allow this app's origin via the OLLAMA_ORIGINS environment variable.
import { useState } from "react";
import { Cpu, Sparkles, Globe, CheckCircle2, AlertCircle, Save } from "lucide-react";
import type { TutorProvider } from "@brainquest/core/tutor/clientConfig";
import { loadTutorConfig, saveTutorConfig, type TutorClientConfig } from "../lib/tutorClient";

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

export default function TutorSettingsClient() {
  const [cfg, setCfg] = useState<TutorClientConfig>(() => loadTutorConfig());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = PROVIDERS.find((p) => p.id === cfg.provider)!;
  const showBase = cfg.provider !== "anthropic";

  function patch(next: Partial<TutorClientConfig>) {
    setCfg((c) => ({ ...c, ...next }));
    setSaved(false);
    setError(null);
  }

  function onSave() {
    setError(null);
    if (!cfg.model.trim()) {
      setError("Enter a model name.");
      return;
    }
    if (cfg.provider === "openai" && cfg.baseUrl.trim() && !/^https?:\/\//i.test(cfg.baseUrl.trim())) {
      setError("Base URL must start with http:// or https://.");
      return;
    }
    saveTutorConfig({ ...cfg, model: cfg.model.trim(), baseUrl: cfg.baseUrl.trim(), apiKey: cfg.apiKey?.trim() ?? "" });
    setSaved(true);
  }

  return (
    <section className="my-8 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">AI tutor</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Grade answers and generate question variations.</p>
        </div>
        {/* Master on/off — off by default; nothing is sent anywhere until this is on. */}
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <span className={cfg.enabled ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}>
            {cfg.enabled ? "On" : "Off"}
          </span>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-4 w-4 accent-indigo-600"
          />
        </label>
      </div>

      {/* Provider picker */}
      <div className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const Icon = p.icon;
          const on = cfg.provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => patch({ provider: p.id })}
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

      {/* Model + base URL + key */}
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Model</span>
          <input
            type="text"
            value={cfg.model}
            onChange={(e) => patch({ model: e.target.value })}
            spellCheck={false}
            placeholder={active.modelHint}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        {showBase && (
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {cfg.provider === "ollama" ? "Ollama host" : "API base URL"}
            </span>
            <input
              type="text"
              value={cfg.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              spellCheck={false}
              placeholder={active.baseHint}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        )}

        {active.paid && (
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">API key (stored on this device only)</span>
            <input
              type="password"
              value={cfg.apiKey ?? ""}
              onChange={(e) => patch({ apiKey: e.target.value })}
              spellCheck={false}
              autoComplete="off"
              placeholder="sk-…"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        )}
      </div>

      {cfg.provider === "ollama" && (
        <p className="mt-3 text-xs text-zinc-500">
          Browser → Ollama needs Ollama to allow this origin: set{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">OLLAMA_ORIGINS</code> (e.g.{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">*</code>) and restart Ollama.
        </p>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={!cfg.model.trim()}
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
          <CheckCircle2 className="h-4 w-4" /> Saved{cfg.enabled ? ` — the tutor now uses ${active.label}.` : " — the tutor is off."}
        </p>
      )}
    </section>
  );
}
