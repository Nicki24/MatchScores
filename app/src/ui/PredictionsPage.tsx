/**
 * Onglet « Pronos » : pour chaque match à venir, qui joue contre qui, qui devrait gagner et avec
 * quelles chances (d'après les cotes, marge retirée), l'option la plus sûre et le score le plus
 * probable ; puis ce qu'ont donné les pronostics de la dernière journée et le bilan sur tes données.
 */
import { CircleHelp } from "lucide-react";
import { db } from "../db";
import { categoryResolver } from "../core/category";
import { marketsOf, pct } from "../core/analysis";
import { backtest, combined, expectedReturn, openingMarkets, outcomeOf, predict, type Backtest, type Prediction } from "../core/predict";
import type { Category, MatchRow, OddsRow } from "../core/types";
import { upcomingMatches } from "../core/schedule";
import { useCategory, useLeagueOverrides, useOddsFor, usePolled, useRecentMatches, useScoped, useTick, useViewSource } from "./hooks";
import { Card, Chances, choiceLabel, ConfidencePill, Countdown, cx, Empty, fmtKickoff, scoreSentence, Section, verdict } from "./kit";
import { Disclaimer, groupByRound, PredictionCheck, roundTitle } from "./MatchesPages";

const lossPct = (v: number) => `${Math.abs(v * 100).toFixed(1).replace(".", ",")} %`;

/** Bilan des pronostics sur les matchs terminés de la catégorie affichée (les 1 500 plus récents), recalculé toutes les 30 s. */
function useBacktest(source: string, category: Category): Backtest | undefined {
  const [overrides] = useLeagueOverrides();
  return usePolled(async () => {
    const finished = await db.matches
      .where("status")
      .equals("finished")
      .filter((m) => m.source_id === source)
      .toArray();
    const categoryOf = categoryResolver(finished, overrides);
    const recent = finished
      .filter((m) => categoryOf(m) === category)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .slice(-1500);
    const keys = recent.map((m) => m.key);
    const byMatch = new Map<string, OddsRow[]>();
    for (const r of keys.length ? await db.odds.where("match_key").anyOf(keys).toArray() : []) {
      const list = byMatch.get(r.match_key);
      if (list) list.push(r);
      else byMatch.set(r.match_key, [r]);
    }
    return backtest(recent, (k) => byMatch.get(k) ?? []);
  }, [source, category, overrides]);
}

function Rate({ label, hits, n, expected, testId }: { label: string; hits: number; n: number; expected: number; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3" data-testid={testId}>
      <span className="text-slate-300">{label}</span>
      <span className="shrink-0 text-right tabular">
        <b>
          {hits}/{n}
        </b>{" "}
        ({pct(hits / n)}) <span className="text-slate-500">· attendu {pct(expected / n)}</span>
      </span>
    </div>
  );
}

/** Taux de réussite observé des pronostics du même niveau de confiance (à partir de 30 matchs). */
function observed(bt: Backtest | undefined, p: Prediction) {
  const b = bt?.buckets.find((x) => x.label === p.confidence);
  return b && b.matches >= 30 ? b : undefined;
}

function PredictionCard({ m, p, bt, onOpen }: { m: MatchRow; p: Prediction; bt?: Backtest; onOpen: (key: string) => void }) {
  const seen = observed(bt, p);
  // Le score qui va avec le pronostic (« Leeds gagne » → 1-0 pour Leeds), puis le plus fréquent s'il diffère
  const score = p.scoreFor[p.outcome.selection as "1" | "X" | "2"] ?? p.scores[0];
  const top = p.scores[0];
  return (
    <Card className="p-3" onClick={() => onOpen(m.key)}>
      <div data-testid="prediction-card">
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 tabular">
          <span>
            {fmtKickoff(m.kickoff_at)}
            {m.round != null && ` · Journée ${m.round}`}
          </span>
          <ConfidencePill c={p.confidence} />
        </div>
        <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold" data-testid="pred-home">
              {m.home_team}
            </div>
            <div className="text-[10px] text-slate-500">domicile</div>
          </div>
          <div className="text-xs font-black text-slate-500">VS</div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold" data-testid="pred-away">
              {m.away_team}
            </div>
            <div className="text-[10px] text-slate-500">extérieur</div>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl bg-emerald-400/10 px-3 py-2">
          <div className="min-w-0">
            <div className="text-[11px] text-emerald-200/80">Pronostic</div>
            <div className="truncate text-[15px] font-bold text-emerald-100" data-testid="prediction-outcome">
              {verdict(p.outcome, m)}
            </div>
          </div>
          <div className="shrink-0 text-right tabular">
            <div className="text-lg font-black leading-tight">{pct(p.outcome.probability)}</div>
            <div className="text-[10px] text-slate-400">{p.outcome.odds != null ? `de chances · cote ${p.outcome.odds.toFixed(2)}` : "de chances"}</div>
          </div>
        </div>
        <Chances m={m} p={{ "1": p.p1, X: p.pX, "2": p.p2 }} />
        <div className="mt-2 space-y-1 text-[12.5px] text-slate-300">
          <div>
            Plus sûr : <b className="text-slate-100">{choiceLabel(p.safest, m)}</b> — {pct(p.safest.probability)}
          </div>
          <div data-testid="prediction-scores">
            Score probable : <b className="text-slate-100 tabular">{scoreSentence(score, m)}</b> ({pct(score.probability)})
            {top !== score && <span className="text-slate-500 tabular"> · score le plus fréquent : {scoreSentence(top, m)}</span>}
          </div>
          <div className="text-slate-400">
            3 buts ou plus : {pct(p.over25)} · les deux équipes marquent : {pct(p.btts)}
          </div>
        </div>
        {seen && (
          <p className="mt-1.5 text-[11px] text-slate-500">
            Sur tes données, les pronostics « {p.confidence} » ont réussi {pct(seen.hits / seen.matches)} du temps ({seen.matches} matchs).
          </p>
        )}
      </div>
    </Card>
  );
}

export function PredictionsPage({ onOpen }: { onOpen: (key: string) => void }) {
  const [source] = useViewSource();
  const [category] = useCategory();
  const { matches } = useScoped(useRecentMatches(source));
  useTick(15_000);
  const now = Date.now();
  const upcoming = matches ? upcomingMatches(matches, now) : [];
  // Dernière journée terminée : ce qu'ont donné ses pronostics
  const lastFinished = (matches ?? [])
    .filter((m) => m.status === "finished")
    .sort((a, b) => (b.kickoff_at ?? b.first_seen_at).localeCompare(a.kickoff_at ?? a.first_seen_at))[0];
  const lastRound = lastFinished
    ? (matches ?? []).filter((m) => m.status === "finished" && roundTitle(m) === roundTitle(lastFinished) && (m.round != null || m.key === lastFinished.key))
    : [];
  const odds = useOddsFor([...upcoming, ...lastRound].map((m) => m.key));
  const preds = upcoming.flatMap((m) => {
    const p = predict(marketsOf(odds?.get(m.key) ?? []));
    return p ? [{ m, p }] : [];
  });
  const bt = useBacktest(source, category);
  const safe = [...preds].sort((a, b) => b.p.outcome.probability - a.p.outcome.probability).slice(0, 5);
  const margin = preds.length ? preds.reduce((s, x) => s + x.p.margin, 0) / preds.length : undefined;
  const lastJudged = lastRound.filter((m) => predict(openingMarkets(odds?.get(m.key) ?? [])));
  const lastHits = lastJudged.filter((m) => predict(openingMarkets(odds?.get(m.key) ?? []))!.outcome.selection === outcomeOf(m)).length;
  const groups = groupByRound(preds.map((x) => x.m));
  const byKey = new Map(preds.map((x) => [x.m.key, x.p]));

  return (
    <div>
      <Disclaimer category={category} />
      <details className="mb-4 rounded-xl bg-white/[.04] px-3 py-2 text-[12.5px] leading-snug text-slate-300">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold text-slate-200">
          <CircleHelp className="h-4 w-4 text-emerald-300" /> Comment lire un pronostic ?
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <b>Pronostic</b> : l'issue la plus probable (victoire d'une équipe ou match nul), avec ses chances. Elles viennent des cotes de bet261, marge du
            bookmaker retirée : c'est la meilleure estimation possible pour {category === "virtual" ? "des matchs tirés au sort" : "un match"}.
          </li>
          <li>
            <b>Plus sûr</b> : la double chance (deux issues sur trois) — plus de chances de passer, cote plus basse.
          </li>
          <li>
            <b>Très probable</b> : au moins 70 % de chances · <b>Probable</b> : au moins 55 % · <b>Incertain</b> : moins.
          </li>
          {margin != null && margin > 0 && (
            <li>
              Aucun match n'est sûr. Avec la marge actuelle ({pct(margin)}), une mise perd en moyenne {lossPct(expectedReturn(margin))} à long terme, quel que
              soit le pronostic.
            </li>
          )}
        </ul>
      </details>

      {preds.length === 0 ? (
        <Empty title="Pas de pronostic pour l'instant">Ils apparaissent dès que les cotes des prochains matchs sont relevées (onglet Collecte).</Empty>
      ) : (
        <>
          <Section title="Les plus sûrs">
            <Card className="divide-y divide-white/5">
              {safe.map(({ m, p }) => (
                <div key={m.key} data-testid="safe-pick" className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm" onClick={() => onOpen(m.key)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{verdict(p.outcome, m)}</div>
                    <div className="truncate text-xs text-slate-500">
                      {m.home_team} vs {m.away_team} · {fmtKickoff(m.kickoff_at)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular">
                    <div className="font-bold" data-testid="safe-probability">
                      {pct(p.outcome.probability)}
                    </div>
                    <div className="text-[11px] text-rose-300/90">risque {pct(1 - p.outcome.probability)}</div>
                  </div>
                  {p.outcome.odds != null && <div className="w-12 shrink-0 rounded-lg bg-white/6 py-1 text-center font-bold tabular">{p.outcome.odds.toFixed(2)}</div>}
                </div>
              ))}
              {safe.length >= 3 && (
                <p className="px-3 py-2 text-[11px] text-slate-400">
                  Les 3 premiers dans un combiné : {pct(combined(safe.slice(0, 3).map((x) => x.p.outcome.probability)))} de chances qu'ils passent tous.
                </p>
              )}
            </Card>
          </Section>

          {groups.map(([title, ms, id], i) => {
            const kickoff = ms.find((m) => m.kickoff_at)?.kickoff_at;
            return (
              <Section
                key={id}
                title={title}
                right={
                  kickoff && (
                    <span className={cx("text-xs tabular", i === 0 ? "font-bold text-emerald-300" : "text-slate-500")}>
                      {fmtKickoff(kickoff)} · <Countdown iso={kickoff} />
                    </span>
                  )
                }
              >
                <div className="space-y-2">
                  {ms.map((m) => (
                    <PredictionCard key={m.key} m={m} p={byKey.get(m.key)!} bt={bt} onOpen={onOpen} />
                  ))}
                </div>
              </Section>
            );
          })}
        </>
      )}

      {lastJudged.length > 0 && (
        <Section
          title={`Dernière journée jouée · ${lastHits}/${lastJudged.length} pronostics justes`}
          right={<span className="text-xs text-slate-500">{roundTitle(lastFinished!)}</span>}
        >
          <Card>
            <div data-testid="last-round" className="divide-y divide-white/5">
              {lastJudged.map((m) => (
                <div key={m.key} className="cursor-pointer px-3 py-2 text-sm" onClick={() => onOpen(m.key)}>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <span className="truncate text-right">{m.home_team}</span>
                    <span className="rounded-md bg-white/8 px-2 py-0.5 font-bold tabular">
                      {m.home_score} - {m.away_score}
                    </span>
                    <span className="truncate">{m.away_team}</span>
                  </div>
                  <PredictionCheck m={m} odds={odds?.get(m.key) ?? []} />
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      <Section title="Bilan sur tes données">
        <Card className="p-4 text-sm">
          <div className="space-y-2" data-testid="backtest">
            {!bt || bt.matches === 0 ? (
              <p className="text-slate-400">Le bilan apparaît quand des matchs dont les cotes ont été relevées avant le coup d'envoi sont terminés.</p>
            ) : (
              <>
                <div className="text-slate-400">
                  Pronostics d'avant-match comparés aux résultats de{" "}
                  <b className="text-slate-100" data-testid="backtest-matches">
                    {bt.matches}
                  </b>{" "}
                  matchs terminés :
                </div>
                <Rate label="Résultat le plus probable" hits={bt.outcome.hits} n={bt.matches} expected={bt.outcome.expected} testId="backtest-outcome" />
                <Rate label="Score exact le plus probable" hits={bt.score.hits} n={bt.matches} expected={bt.score.expected} />
                {bt.buckets
                  .filter((b) => b.matches > 0)
                  .map((b) => (
                    <Rate key={b.label} label={`Pronostics « ${b.label} »`} hits={b.hits} n={b.matches} expected={b.expected} />
                  ))}
                {bt.form.matches > 0 && (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-300">Équipe en meilleure forme</span>
                    <span className="shrink-0 text-right tabular">
                      {pct(bt.form.hits / bt.form.matches)} <span className="text-slate-500">· favori des cotes {pct(bt.form.oddsHits / bt.form.matches)}</span>
                    </span>
                  </div>
                )}
                <p className="pt-1 text-xs text-slate-500">
                  « Attendu » : ce que les probabilités annonçaient. Quand le réel reste proche de l'attendu, les cotes décrivent bien le tirage et l'issue la
                  plus probable est le choix qui réussit le plus souvent — sans garantie sur un match.
                </p>
              </>
            )}
          </div>
        </Card>
      </Section>
    </div>
  );
}
