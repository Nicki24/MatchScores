"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { MousePointerClick, PlayCircle, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { Button } from "./ui";

/** Fenêtre affichée à l'ouverture tant qu'aucune donnée n'est chargée. */
export function Onboarding() {
  const { snapshot, onboarded, loadDemo, setOnboarded } = useStore();
  const open = !snapshot && !onboarded;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            initial={{ scale: 0.94, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0 }}
            className="glass relative w-full max-w-lg rounded-3xl bg-ink-900/90 p-7"
          >
            <button className="absolute right-4 top-4 text-slate-500 hover:text-slate-200" onClick={() => setOnboarded(true)} aria-label="Fermer">
              <X className="h-5 w-5" />
            </button>
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-400 text-emerald-950">
              <MousePointerClick className="h-6 w-6" />
            </div>
            <h2 className="font-display text-2xl font-bold">Ouvre l&apos;assistant flottant Bet261</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Pour analyser les vrais matchs, ouvre Bet261 et active le panneau flottant MatchScores : il lit les cotes
              affichées (sports et virtuels) et te renvoie ici les meilleurs paris à faible risque.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link href="/connecter" className="flex-1" onClick={() => setOnboarded(true)}>
                <Button variant="primary" className="w-full">
                  <MousePointerClick className="h-4 w-4" /> Activer l&apos;assistant
                </Button>
              </Link>
              <Button variant="outline" className="flex-1" onClick={loadDemo}>
                <PlayCircle className="h-4 w-4" /> Voir une démo
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
