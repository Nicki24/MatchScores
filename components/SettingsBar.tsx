"use client";

import { SlidersHorizontal } from "lucide-react";
import { useStore } from "@/lib/store";
import { Card } from "./ui";

export function SettingsBar() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 text-sm">
      <div className="flex items-center gap-2 font-medium text-slate-300">
        <SlidersHorizontal className="h-4 w-4 text-emerald-300" /> Filtres
      </div>
      <label className="flex items-center gap-2 text-slate-400">
        Cote min
        <input type="range" min={1.01} max={1.6} step={0.01} value={settings.minOdds} onChange={(e) => update({ minOdds: Number(e.target.value) })} />
        <span className="w-9 tabular-nums text-slate-200">{settings.minOdds.toFixed(2)}</span>
      </label>
      <label className="flex items-center gap-2 text-slate-400">
        Cote max
        <input type="range" min={1.3} max={5} step={0.05} value={settings.maxOdds} onChange={(e) => update({ maxOdds: Number(e.target.value) })} />
        <span className="w-9 tabular-nums text-slate-200">{settings.maxOdds.toFixed(2)}</span>
      </label>
      <label className="flex items-center gap-2 text-slate-400">
        <input type="checkbox" checked={settings.includeEstimated} onChange={(e) => update({ includeEstimated: e.target.checked })} />
        Doubles chances estimées
      </label>
      <label className="flex items-center gap-2 text-slate-400">
        <input type="checkbox" checked={settings.includeLive} onChange={(e) => update({ includeLive: e.target.checked })} />
        Matchs en direct
      </label>
    </Card>
  );
}
