"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import { analyzeMatch, buildCombos, isEligible, type Pick } from "@/lib/analysis/sports";
import { SPORT_LABELS, type Sport } from "@/lib/types";
import { Onboarding } from "@/components/Onboarding";
import { EmptyState } from "@/components/EmptyState";
import { PickCard } from "@/components/PickCard";
import { ComboCard } from "@/components/ComboCard";
import { MatchRow } from "@/components/MatchRow";
import { SettingsBar } from "@/components/SettingsBar";
import { Button, Card, Chip, SectionTitle, Stat, pct } from "@/components/ui";
import { useHydrated } from "@/components/useHydrated";

export default function Dashboard() {
  const hydrated = useHydrated();
  const { snapshot, settings } = useStore();
  const [sport, setSport] = useState<Sport | "all">("all");
  const [stake, setStake] = useState(1000);

  const analyses = useMemo(
    () => (snapshot?.matches ?? []).filter((m) => !m.virtual).map((m) => analyzeMatch(m, settings)),
    [snapshot, settings],
  );
  const sports = useMemo(() => [...new Set(analyses.map((a) => a.match.sport))], [analyses]);
  const filtered = analyses.filter((a) => sport === "all" || a.match.sport === sport);
  const picks: Pick[] = filtered
    .map((a) => a.best)
    .filter((p): p is Pick => !!p && isEligible(p, settings))
    .sort((a, b) => b.safety - a.safety);
  const combos = buildCombos(picks);

  if (!hydrated) return null;
  if (!snapshot || analyses.length === 0) {
    return (
      <>
        <Onboarding />
        <EmptyState
          title={snapshot ? "Aucun match de sport dans la capture" : "Aucune donnée pour l'instant"}
          text={
            snapshot
              ? "La dernière capture ne contient que des virtuels, ou l'assistant n'a pas trouvé de cotes. Ouvre une liste de matchs sur Bet261 et relance l'analyse."
              : "Connecte Bet261 via l'assistant flottant, le scraping automatique ou en collant le texte de la page."
          }
        />
      </>
    );
  }

  const safest = picks[0];
  return (
    <div className="space-y-10">
      <Onboarding />
      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" /> Analyse des cotes sans marge du bookmaker
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Les paris <span className="text-gradient">les plus sûrs</span> du moment
          </h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Chaque match est noté de 0 à 100 selon la probabilité réelle estimée, la marge du bookmaker, le risque de nul
            et le direct. Plus la note est haute, plus le pari est sûr — jamais garanti.
          </p>
        </div>
        <Link href="/connecter">
          <Button variant="outline">
            <RefreshCw className="h-4 w-4" /> Mettre à jour les données
          </Button>
        </Link>
      </section>

      {snapshot.source === "demo" && (
        <Card className="border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
          Mode démo : ces matchs sont fictifs. <Link href="/connecter" className="underline">Connecte Bet261</Link> pour analyser les vrais matchs.
        </Card>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Matchs analysés" value={analyses.length} hint={`${sports.length} sport(s)`} />
        <Stat label="Conseils retenus" value={picks.length} hint={`cotes ${settings.minOdds.toFixed(2)} – ${settings.maxOdds.toFixed(2)}`} />
        <Stat label="Pari le plus sûr" value={safest ? pct(safest.probability) : "—"} hint={safest?.description} />
        <Stat label="Faible risque" value={picks.filter((p) => p.risk === "faible").length} hint="note ≥ 72" />
      </section>

      <SettingsBar />

      <section>
        <SectionTitle title="Top conseils" subtitle="Le meilleur pari de chaque match, du plus sûr au plus risqué" />
        <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
          <Chip active={sport === "all"} onClick={() => setSport("all")}>
            Tous
          </Chip>
          {sports.map((s) => (
            <Chip key={s} active={sport === s} onClick={() => setSport(s)}>
              {SPORT_LABELS[s]}
            </Chip>
          ))}
        </div>
        {picks.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {picks.slice(0, 12).map((p, i) => (
              <PickCard key={p.id} pick={p} rank={i} />
            ))}
          </div>
        ) : (
          <Card className="p-6 text-sm text-slate-400">Aucun pari ne correspond aux filtres. Élargis la plage de cotes.</Card>
        )}
      </section>

      {combos.length > 0 && (
        <section>
          <SectionTitle
            title="Combinés suggérés"
            subtitle="Chaque sélection ajoutée multiplie le risque : la probabilité affichée est celle que TOUT passe."
            right={
              <label className="flex items-center gap-2 text-sm text-slate-400">
                Mise (Ar)
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={stake}
                  onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
                  className="w-28 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-slate-100"
                />
              </label>
            }
          />
          <div className="grid gap-3 md:grid-cols-3">
            {combos.map((c) => (
              <ComboCard key={c.name} combo={c} stake={stake} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle title="Tous les matchs" subtitle="Probabilités sans marge (1 / X / 2) — clique pour le détail des paris" />
        <Card className="overflow-hidden">
          {filtered
            .slice()
            .sort((a, b) => (b.best?.safety ?? 0) - (a.best?.safety ?? 0))
            .map((a) => (
              <MatchRow key={a.match.id} a={a} />
            ))}
        </Card>
      </section>
    </div>
  );
}
