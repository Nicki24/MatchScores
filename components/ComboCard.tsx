"use client";

import { Layers } from "lucide-react";
import type { Combo } from "@/lib/analysis/sports";
import { Card, RiskBadge, pct } from "./ui";

export function ComboCard({ combo, stake }: { combo: Combo; stake: number }) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-display text-lg font-bold">
          <Layers className="h-5 w-5 text-cyan-300" /> {combo.name}
        </div>
        <RiskBadge risk={combo.risk} />
      </div>
      <ul className="mt-4 flex-1 space-y-2.5">
        {combo.legs.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{l.description}</div>
              <div className="truncate text-xs text-slate-500">
                {l.match.home} – {l.match.away}
              </div>
            </div>
            <span className="tabular-nums text-slate-300">{l.odds.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/5 pt-4 text-center">
        <div>
          <div className="text-[11px] uppercase text-slate-500">Cote</div>
          <div className="font-display text-lg font-bold text-emerald-300 tabular-nums">{combo.odds.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase text-slate-500">Réussite</div>
          <div className="font-display text-lg font-bold tabular-nums">{pct(combo.probability)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase text-slate-500">Gain ({stake.toLocaleString("fr-FR")})</div>
          <div className="font-display text-lg font-bold tabular-nums">{Math.round(stake * combo.odds).toLocaleString("fr-FR")}</div>
        </div>
      </div>
    </Card>
  );
}
