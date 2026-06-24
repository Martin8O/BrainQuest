"use client";

// Light/dark switch — an inline icon button meant to sit inside the FloatingNav. The source
// of truth is the `.dark` class on <html>; a pre-paint script in the layout sets it before
// React mounts (no flash). We read that class via useSyncExternalStore — the React-blessed
// way to subscribe to an external system — which also keeps SSR and hydration in sync (it
// uses the server snapshot during hydration, then updates to the real value, so there's no
// flicker warning and no setState-in-effect).
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const THEME_EVENT = "themechange";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function isDark() {
  return document.documentElement.classList.contains("dark");
}

export function ThemeToggle() {
  // Server snapshot is `false` (the OS/saved theme is browser-only); useSyncExternalStore
  // corrects it right after hydration without a mismatch.
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Private mode / blocked storage: the toggle still works for this page view.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {/* Icon shows the theme you'd switch TO. */}
      {dark ? <Sun className="h-[18px] w-[18px]" strokeWidth={2} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={2} />}
    </button>
  );
}
