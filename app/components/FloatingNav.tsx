"use client";

// One floating menu shown on every page (rendered once in the root layout), so you can jump
// anywhere from anywhere. A centered pill at the top of the viewport: a brand mark, an icon per
// route with the current one highlighted, then the theme switch. Tooltips name each icon on hover.
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  BookOpenCheck,
  TrendingUp,
  Network,
  GraduationCap,
  Library,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

const NAV: { href: string; icon: LucideIcon; label: string }[] = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/session", icon: BookOpenCheck, label: "Daily session" },
  { href: "/progress", icon: TrendingUp, label: "Progress" },
  { href: "/map", icon: Network, label: "Skill tree" },
  { href: "/tutor", icon: GraduationCap, label: "AI tutor" },
  { href: "/packs", icon: Library, label: "Packs" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function FloatingNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-zinc-200/80 bg-white/80 px-1.5 py-1.5 shadow-lg shadow-zinc-900/5 backdrop-blur-md dark:border-zinc-700/70 dark:bg-zinc-900/80"
    >
      {NAV.map(({ href, icon: Icon, label }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`group relative grid h-9 w-9 place-items-center rounded-full transition ${
              active
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            <span className="pointer-events-none absolute top-11 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 shadow-md transition group-hover:opacity-100 dark:bg-white dark:text-zinc-900">
              {label}
            </span>
          </Link>
        );
      })}
      <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
      <ThemeToggle />
    </nav>
  );
}
