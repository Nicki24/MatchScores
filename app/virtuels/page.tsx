"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ClipboardPaste, Trophy } from "lucide-react";
import { useStore } from "@/lib/store";
import { analyzeLeague, effectiveStandings, type VirtualAnalysis } from "@/lib/analysis/virtuals";
import { snapshotFromText } from "@/lib/snapshot";
import type { FormResult, Standing } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { Onboarding } from "@/components/Onboarding";
import { Button, Card, Chip, OutcomeBar, RiskBadge, SafetyRing, SectionTitle, pct } from "@/components/ui";
import { formatTime } from "@/components/PickCard";
import { useHydrated } from "@/components/useHydrated";

const FORM_COLOR: Record<FormResult, string> = { W: "bg-emerald-400/80", D: "bg-slate-400/70", L: "bg-rose-400/80" };
const FORM_LABEL: Record<FormResult, string> = { W: "V", D: "N", L: "D" };

function Form({ form }: { form?: FormResult[] }) {
  if (!form?.length) return <span className="text-slate-600">—</span>;
  return (
    <span className="inline-flex gap-0.5">
      {form.slice(-5).map((f, i) => (
        <span key={i} className={`grid h-4 w-4 place-items-center rounded text-[9px] font-bold text-ink-950 ${FORM_COLOR[f]}`}>
          {FORM_LABEL[f]}
        </span>
      ))}
    </span>
  );
}

function StandingsTable({ rows }: { rows: Standing[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase text-slate-500">
          <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
            <th>#</th>
            <th>Équipe</th>
            <th className="text-right">J</th>
            <th className="text-right">Diff</th>
            <th className="text-right">Pts</th>
            <th>Forme</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.team} className="border-t border-white/5 [&>td]:px-2 [&>td]:py-2">
              <td className="tabular-nums text-slate-400">{s.position ?? i + 1}</td>
              <td className="whitespace-nowrap font-medium">{s.team}</td>
              <td className="text-right tabular-nums text-slate-400">{s.played ?? "—"}</td>
              <td className="text-right tabular-nums text-slate-400">
                {s.goalsFor != null && s.goalsAgainst != null ? s.goalsFor - s.goalsAgainst : "—"}
              </td>
              <td className="text-right font-semibold tabular-nums">{s.points ?? "—"}</td>
              <td>
                <Form form={s.form} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VirtualCard({ a, i }: { a: VirtualAnalysis; i: number }) {
  const best = a.best!;
  const pos = (n?: number) => (n ? `${n}e` : "");
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
      <Card className="h-full p-5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{formatTime(a.match.startTime) ?? "Prochain tour"}</span>
          <span>Score probable {a.mostLikelyScore.join(" - ")}</span>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          <div>
            <div className="font-display font-bold">{a.match.home}</div>
            <div className="text-xs text-slate-500">
              {pos(a.home.standing?.position)} <Form form={a.home.standing?.form?.slice(-5)} />
            </div>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-1 font-display text-xs tabular-nums text-slate-400">
            {a.expectedGoals[0]} – {a.expectedGoals[1]}
            <div className="text-[10px] uppercase">xG</div>
          </div>
          <div>
            <div className="font-display font-bold">{a.match.away}</div>
            <div className="text-xs text-slate-500">
              {pos(a.away.standing?.position)} <Form form={a.away.standing?.form?.slice(-5)} />
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-xs">
          <div>
            <div className="mb-1 text-slate-500">Analyse combinée (cotes + stats)</div>
            <OutcomeBar
              parts={[
                { label: "1", value: a.blended.home, color: "#34d399" },
                { label: "X", value: a.blended.draw, color: "#94a3b8" },
                { label: "2", value: a.blended.away, color: "#22d3ee" },
              ]}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/[.03] p-3">
          <SafetyRing value={best.safety} size={48} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Conseil</div>
            <div className="font-display font-bold">{best.description}</div>
            <div className="text-xs text-slate-400">
              Probabilité {pct(best.probability)}
              {best.edge != null && ` · espérance ${best.edge >= 0 ? "+" : ""}${(best.edge * 100).toFixed(1)} %`}
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-lg font-bold text-emerald-300 tabular-nums" title={best.odds ? undefined : "Cote juste estimée : vérifie la cote réelle sur Bet261"}>
              {best.odds?.toFixed(2) ?? `≈${(1 / best.probability).toFixed(2)}`}
            </div>
            <RiskBadge risk={best.risk} />
          </div>
        </div>

        <ul className="mt-3 space-y-1 text-xs text-slate-400">
          {a.insights.map((t) => (
            <li key={t}>• {t}</li>
          ))}
        </ul>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-300">Tous les paris analysés</summary>
          <table className="mt-2 w-full">
            <tbody>
              {a.picks.map((p) => (
                <tr key={p.label} className="border-t border-white/5">
                  <td className="py-1">{p.description}</td>
                  <td className="py-1 text-right tabular-nums">{pct(p.probability)}</td>
                  <td className="py-1 text-right tabular-nums text-slate-400">{p.odds?.toFixed(2) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>
    </motion.div>
  );
}

function PasteBox() {
  const setSnapshot = useStore((s) => s.setSnapshot);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 font-display font-bold">
        <ClipboardPaste className="h-4 w-4 text-cyan-300" /> Ajouter des données virtuelles
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Sur la page Virtuels de Bet261 : sélectionne tout (Ctrl+A), copie (Ctrl+C) et colle ici — matchs, classement et
        résultats sont détectés automatiquement.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"1 Londres Rouge 9 7 1 1 20 8 12 22 VVNVV\nLondres Rouge\nLisbonne\n1.38\n4.60\n7.20"}
        className="mt-3 w-full rounded-xl border border-white/10 bg-ink-900/60 p-3 font-mono text-xs text-slate-200 outline-none focus:border-emerald-400/40"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!text.trim()}
          onClick={() => {
            const snap = snapshotFromText(text, "virtual");
            const l = snap.virtual[0];
            if (!l) return setMsg("Rien de reconnu dans ce texte.");
            setSnapshot(snap);
            setMsg(`${l.matches.length} match(s), ${l.standings.length} équipe(s), ${l.results.length} résultat(s) importés.`);
            setText("");
          }}
        >
          Analyser
        </Button>
        {msg && <span className="text-xs text-slate-400">{msg}</span>}
      </div>
    </Card>
  );
}

export default function VirtualsPage() {
  const hydrated = useHydrated();
  const { snapshot, settings } = useStore();
  const leagues = snapshot?.virtual ?? [];
  const [idx, setIdx] = useState(0);
  const league = leagues[Math.min(idx, leagues.length - 1)];
  const analyses = useMemo(() => (league ? analyzeLeague(league, settings.minOdds) : []), [league, settings.minOdds]);
  const standings = useMemo(() => (league ? effectiveStandings(league) : []), [league]);

  if (!hydrated) return null;

  return (
    <div className="space-y-8">
      <Onboarding />
      <section>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Matchs <span className="text-gradient">virtuels</span>
        </h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Pour chaque match, l&apos;outil combine les cotes avec le classement, la forme (5 derniers matchs), les buts
          marqués/encaissés et les résultats passés pour estimer les buts attendus et la probabilité de chaque pari.
        </p>
      </section>

      <Card className="flex gap-3 border-amber-400/25 bg-amber-400/[.04] p-4 text-sm text-amber-100/90">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <p>
          Les matchs virtuels sont générés par un algorithme aléatoire certifié : le classement et la forme influencent
          peu le résultat et les cotes intègrent déjà la force des équipes. Le modèle ne pèse donc que 10 à 45 % face aux
          cotes. Aucune méthode ne permet de « battre » durablement les virtuels.
        </p>
      </Card>

      {!league ? (
        <>
          <EmptyState title="Aucune donnée virtuelle" text="Ouvre la section Virtuels sur Bet261 avec l'assistant flottant, ou colle le texte de la page ci-dessous." />
          <PasteBox />
        </>
      ) : (
        <>
          {leagues.length > 1 && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              {leagues.map((l, i) => (
                <Chip key={l.name} active={i === idx} onClick={() => setIdx(i)}>
                  {l.name}
                </Chip>
              ))}
            </div>
          )}
          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <section>
              <SectionTitle title="Prochains matchs" subtitle={`${league.name} · classés du plus sûr au plus risqué`} />
              {analyses.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {analyses.map((a, i) => (
                    <VirtualCard key={a.match.id} a={a} i={i} />
                  ))}
                </div>
              ) : (
                <Card className="p-6 text-sm text-slate-400">Classement chargé mais aucun match à venir détecté.</Card>
              )}
            </section>
            <aside className="space-y-6">
              <Card className="overflow-hidden">
                <div className="flex items-center gap-2 px-4 pt-4 font-display font-bold">
                  <Trophy className="h-4 w-4 text-amber-300" /> Classement
                </div>
                {standings.length ? (
                  <StandingsTable rows={standings} />
                ) : (
                  <p className="p-4 text-sm text-slate-500">Classement non détecté.</p>
                )}
              </Card>
              {league.results.length > 0 && (
                <Card className="p-4">
                  <div className="mb-2 font-display font-bold">Derniers résultats</div>
                  <ul className="space-y-1 text-sm">
                    {league.results.slice(-10).reverse().map((r, i) => (
                      <li key={i} className="flex justify-between gap-2 text-slate-300">
                        <span className="truncate">{r.home}</span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {r.homeGoals} - {r.awayGoals}
                        </span>
                        <span className="truncate text-right">{r.away}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <PasteBox />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
