"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { motion } from "framer-motion";
import { Gauge, Plug, Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import { useHydrated } from "./useHydrated";

const LINKS = [
  { href: "/", label: "Sports", icon: Gauge },
  { href: "/virtuels", label: "Virtuels", icon: Sparkles },
  { href: "/connecter", label: "Connecter Bet261", short: "Connecter", icon: Plug },
];

const SOURCE: Record<string, string> = {
  demo: "Démo",
  scrape: "Scraping",
  assistant: "Assistant",
  paste: "Texte collé",
  file: "Fichier",
};

export function Nav() {
  const path = usePathname();
  const snapshot = useStore((s) => s.snapshot);
  const hydrated = useHydrated();

  if (path.startsWith("/bulle")) return null; // panneau de la bulle Android : pas de navigation

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 font-display text-sm font-extrabold text-emerald-950">
            MS
          </span>
          <span className="hidden font-display text-lg font-bold tracking-tight sm:block">MatchScores</span>
        </Link>
        <nav className="no-scrollbar ml-auto flex gap-1 overflow-x-auto sm:ml-6">
          {LINKS.map(({ href, label, short, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={clsx("relative flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium", active ? "text-white" : "text-slate-400 hover:text-slate-200")}
              >
                {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl bg-white/8" transition={{ type: "spring", duration: 0.45 }} />}
                <Icon className="relative h-4 w-4" />
                <span className="relative hidden sm:inline">{label}</span>
                <span className="relative sm:hidden">{short ?? label}</span>
              </Link>
            );
          })}
        </nav>
        {hydrated && snapshot && (
          <div className="ml-auto hidden items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 md:flex">
            <span className={clsx("h-2 w-2 rounded-full", snapshot.source === "demo" ? "bg-amber-400" : "bg-emerald-400 animate-pulse")} />
            {SOURCE[snapshot.source]} · {new Date(snapshot.capturedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
    </header>
  );
}
