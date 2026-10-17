"use client";

import { motion } from "framer-motion";
import { Clock, Info, Radio } from "lucide-react";
import type { Pick } from "@/lib/analysis/sports";
import { SPORT_LABELS } from "@/lib/types";
import { Card, RiskBadge, SafetyRing, pct } from "./ui";

export function formatTime(t?: string) {
  if (!t) return undefined;
  if (/^\d{1,2}:\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  return d.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function PickCard({ pick, rank }: { pick: Pick; rank: number }) {
  const m = pick.match;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(rank, 10) * 0.04 }}>
      <Card className="group h-full p-4 transition hover:border-emerald-400/25">
        <div className="flex items-start gap-3">
          <SafetyRing value={pick.safety} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
              <span>{SPORT_LABELS[m.sport]}</span>
              {m.league && <span className="truncate normal-case tracking-normal text-slate-500">· {m.league}</span>}
            </div>
            <div className="mt-1 truncate font-medium text-slate-200">
              {m.home} <span className="text-slate-500">vs</span> {m.away}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="font-display text-base font-bold text-white">{pick.description}</div>
              <div className="rounded-lg bg-emerald-400/10 px-2.5 py-1 font-display text-base font-bold tabular-nums text-emerald-300">
                {pick.odds.toFixed(2)}
                {pick.estimated && <span title="Cote estimée">*</span>}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <RiskBadge risk={pick.risk} />
          <span className="tabular-nums">Probabilité {pct(pick.probability)}</span>
          {m.live && (
            <span className="flex items-center gap-1 text-rose-300">
              <Radio className="h-3 w-3" /> Live
            </span>
          )}
          {formatTime(m.startTime) && (
            <span className="ml-auto flex items-center gap-1">
              <Clock className="h-3 w-3" /> {formatTime(m.startTime)}
            </span>
          )}
        </div>
        {pick.reasons.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-white/5 pt-3 text-xs text-slate-400">
            {pick.reasons.slice(0, 3).map((r) => (
              <li key={r} className="flex gap-1.5">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" /> {r}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </motion.div>
  );
}
