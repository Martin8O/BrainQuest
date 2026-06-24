"use client";

// The vault-switcher form. You type/paste an absolute path, "Check" validates it and shows what was
// found (note counts) without changing anything, then "Save & switch" writes it to vault.config.json.
// Two-step on purpose: confirm you pointed at the right brain before committing the switch.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, AlertCircle, Search, Save } from "lucide-react";
import { previewVault, saveVaultPath, type PreviewResult, type SaveResult } from "./actions";

export default function SettingsClient({
  currentPath,
  envOverride,
}: {
  currentPath: string;
  envOverride: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentPath);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onCheck() {
    setSaved(null);
    startTransition(async () => setPreview(await previewVault(value)));
  }

  function onSave() {
    startTransition(async () => {
      const res = await saveVaultPath(value);
      setPreview(res);
      if (res.ok) {
        setSaved(res);
        router.refresh(); // re-read the (now updated) config across the app
      }
    });
  }

  const valid = preview?.ok === true;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 text-sm font-semibold">Switch vault</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Enter the absolute path to the vault’s root folder (the one containing the note subfolders).
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setPreview(null);
            setSaved(null);
          }}
          spellCheck={false}
          placeholder="D:\\Projekty\\vault"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="button"
          onClick={onCheck}
          disabled={pending || !value.trim()}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Search className="h-4 w-4" /> Check
        </button>
      </div>

      {preview && !preview.ok && (
        <p className="mt-3 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {preview.error}
        </p>
      )}

      {preview && preview.ok && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/50">
          <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Looks like a vault
          </p>
          <p className="mt-1 text-emerald-800/90 dark:text-emerald-200/80">
            Found <span className="font-semibold">{preview.learningCount}</span> notes in{" "}
            <code className="rounded bg-emerald-100 px-1 dark:bg-emerald-900/60">{preview.learningFolder}/</code> and{" "}
            <span className="font-semibold">{preview.conceptCount}</span> in{" "}
            <code className="rounded bg-emerald-100 px-1 dark:bg-emerald-900/60">{preview.conceptFolder}/</code>.
          </p>
        </div>
      )}

      {valid && !saved && (
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Save className="h-4 w-4" /> Save &amp; switch
        </button>
      )}

      {saved?.ok && (
        <p className="mt-3 flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Saved. BrainQuest now reads <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{saved.saved}</code>.
            {saved.envOverride && (
              <span className="text-amber-600 dark:text-amber-400">
                {" "}Note: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">BRAINQUEST_VAULT_PATH</code> is set
                and overrides the file — unset it for this to take effect.
              </span>
            )}
          </span>
        </p>
      )}

      {envOverride && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Heads-up: the <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">BRAINQUEST_VAULT_PATH</code> env var is
          set, so it currently wins over whatever you save here.
        </p>
      )}
    </section>
  );
}
