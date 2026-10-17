"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { MatchAnalysis } from "@/lib/analysis/sports";
import { OutcomeBar, RiskBadge, pct } from "./ui";
import { formatTime } from "./PickCard";

const COLORS: Record<string, string> = { "1": "#34d399", X: "#94a3b8", "2": "#22d3ee" };

export function MatchRow({ a }: { a: MatchAnalysis }) {
  const [open, setOpen] = useState(false);
  const m = a.match;
  return (
    <div className="border-b border-white/5 last:border-0">
      <button onClick={() => setOpen(!open)} className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 text-left hover:bg-white/[.02] md:grid-cols-[2fr_2fr_1fr_auto]">
        <div className="min-w-0">
          <div className="truncate font-medium">
            {m.home} <span className="text-slate-500">vs</span> {m.away}
          </div>
          <div className="truncate text-xs text-slate-500">
            {m.league ?? "—"} {formatTime(m.startTime) && `· ${formatTime(m.startTime)}`}
          </div>
        </div>
        <div className="hidden md:block">
          {a.main && (
            <OutcomeBar parts={a.main.market.selections.map((s, i) => ({ label: s.label, value: a.main!.fair[i], color: COLORS[s.label] ?? "#a5b4fc" }))} />
          )}
        </div>
        <div className="hidden md:block">{a.best ? <RiskBadge risk={a.best.risk} /> : <span className="text-xs text-slate-500">—</span>}</div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4">
              {a.main && (
                <div className="mb-3 text-xs text-slate-400 md:hidden">
                  <OutcomeBar parts={a.main.market.selections.map((s, i) => ({ label: s.label, value: a.main!.fair[i], color: COLORS[s.label] ?? "#a5b4fc" }))} />
                </div>
              )}
              <div className="mb-2 text-xs text-slate-500">
                Marge du bookmaker : {a.main ? `${(a.main.margin * 100).toFixed(1)} %` : "—"}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="py-1 font-medium">Pari</th>
                      <th className="py-1 font-medium">Cote</th>
                      <th className="py-1 font-medium">Probabilité</th>
                      <th className="py-1 font-medium">Sécurité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.picks.slice(0, 8).map((p) => (
                      <tr key={p.id} className="border-t border-white/5">
                        <td className="py-1.5">{p.description}</td>
                        <td className="py-1.5 tabular-nums">
                          {p.odds.toFixed(2)}
                          {p.estimated && "*"}
                        </td>
                        <td className="py-1.5 tabular-nums">{pct(p.probability)}</td>
                        <td className="py-1.5 tabular-nums">{Math.round(p.safety)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
