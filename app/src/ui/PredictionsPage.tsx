/**
 * Onglet « Pronos » : pour chaque match à venir, l'issue et les scores les plus probables d'après
 * les cotes (marge retirée), avec le risque de chaque pronostic ; puis le bilan réel des
 * pronostics sur les matchs terminés.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { Target } from "lucide-react";
import { db } from "../db";
import { marketsOf, pct } from "../core/analysis";
import { backtest, combined, expectedReturn, predict, type Backtest } from "../core/predict";
import type { OddsRow } from "../core/types";
import { useMatches, useOddsFor, useTick, useViewSource } from "./hooks";
import { Card, choiceLabel, ConfidencePill, cx, Empty, fmtTime, scoreLabel, Section } from "./kit";
import { Disclaimer, groupByRound } from "./MatchesPages";

const lossPct = (v: number) => `${Math.abs(v * 100).toFixed(1).replace(".", ",")} %`;

/** Bilan des pronostics sur les matchs terminés de la source (les 1 500 plus récents). */
function useBacktest(source: string): Backtest | undefined {
  return useLiveQuery(async () => {
    const finished = await db.matches
      .where("status")
      .equals("finished")
      .filter((m) => m.source_id === source)
      .toArray();
    const recent = finished.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(-1500);
    const keys = recent.map((m) => m.key);
    const byMatch = new Map<string, OddsRow[]>();
    for (const r of keys.length ? await db.odds.where("match_key").anyOf(keys).toArray() : []) {
      const list = byMatch.get(r.match_key);
      if (list) list.push(r);
      else byMatch.set(r.match_key, [r]);
    }
    return backtest(recent, (k) => byMatch.get(k) ?? []);
  }, [source]);
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

export function PredictionsPage({ onOpen }: { onOpen: (key: string) => void }) {
  const [source] = useViewSource();
  const matches = useMatches(source);
  useTick(15_000);
  const now = Date.now();
  const upcoming = (matches ?? [])
    .filter((m) => m.status === "scheduled" && Date.parse(m.updated_at) > now - 20 * 60_000)
    .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? "") || (a.round ?? 0) - (b.round ?? 0));
  const odds = useOddsFor(upcoming.map((m) => m.key));
  const preds = upcoming.flatMap((m) => {
    const p = predict(marketsOf(odds?.get(m.key) ?? []));
    return p ? [{ m, p }] : [];
  });
  const bt = useBacktest(source);
  const safe = [...preds].sort((a, b) => b.p.outcome.probability - a.p.outcome.probability).slice(0, 5);
  const margin = preds.length ? preds.reduce((s, x) => s + x.p.margin, 0) / preds.length : undefined;

  return (
    <div>
      <Disclaimer />
      <Card className="mb-5 p-4 text-[13px] leading-snug text-slate-300">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
          <Target className="h-4 w-4 text-emerald-300" /> Comment sont calculés les pronostics
        </div>
        <p className="mt-2">
          À partir des cotes de bet261, marge du bookmaker retirée : c'est la meilleure estimation possible pour des matchs tirés au sort. Aucun match
          n'est sûr : le <b className="text-slate-100">risque</b> est la probabilité que le pronostic soit faux.
          {margin != null && margin > 0 && ` Avec la marge actuelle (${pct(margin)}), une mise perd en moyenne ${lossPct(expectedReturn(margin))} à long terme, quel que soit le pronostic.`}
        </p>
      </Card>

      {preds.length === 0 ? (
        <Empty title="Pas de pronostic pour l'instant">Ils apparaissent dès que les cotes des prochains matchs sont relevées (onglet Collecte).</Empty>
      ) : (
        <>
          <Section title="Les moins risqués">
            <Card className="divide-y divide-white/5">
              {safe.map(({ m, p }) => (
                <div key={m.key} data-testid="safe-pick" className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm" onClick={() => onOpen(m.key)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{choiceLabel(p.outcome, m)}</div>
                    <div className="truncate text-xs text-slate-500">
                      {m.home_team} – {m.away_team} · {fmtTime(m.kickoff_at)}
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
                  Les 3 premiers dans un combiné : {pct(combined(safe.slice(0, 3).map((x) => x.p.outcome.probability)))} de chances qu'ils passent
                  tous.
                </p>
              )}
            </Card>
          </Section>

          {groupByRound(preds.map((x) => x.m)).map(([title, ms]) => (
            <Section key={title} title={`Pronostics · ${title}`}>
              <div className="space-y-2">
                {ms.map((m) => {
                  const p = preds.find((x) => x.m.key === m.key)!.p;
                  return (
                    <Card key={m.key} className="p-3" onClick={() => onOpen(m.key)}>
                      <div data-testid="prediction-card">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-semibold">
                              {m.home_team} – {m.away_team}
                            </div>
                            <div className="text-[11px] text-slate-500 tabular">{fmtTime(m.kickoff_at)}</div>
                          </div>
                          <ConfidencePill c={p.confidence} />
                        </div>
                        <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 text-sm">
                          <span className="text-slate-400">Résultat</span>
                          <span className="truncate font-semibold" data-testid="prediction-outcome">
                            {choiceLabel(p.outcome, m)}
                          </span>
                          <span className="font-bold tabular">{pct(p.outcome.probability)}</span>
                          <span className="text-slate-400">Double chance</span>
                          <span className="truncate">{choiceLabel(p.safest, m)}</span>
                          <span className="tabular">{pct(p.safest.probability)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" data-testid="prediction-scores">
                          <span className="text-slate-400">Score exact</span>
                          {p.scores.slice(0, 3).map((s, i) => (
                            <span
                              key={scoreLabel(s)}
                              className={cx("rounded-md px-1.5 py-0.5 tabular", i === 0 ? "bg-emerald-400/15 font-bold text-emerald-200" : "bg-white/6 text-slate-300")}
                            >
                              {scoreLabel(s)} · {pct(s.probability)}
                            </span>
                          ))}
                        </div>
                        <div className="mt-1.5 text-[11px] text-slate-500 tabular">
                          Risque que le résultat soit faux : {pct(1 - p.outcome.probability)} · buts attendus {p.expected.home.toFixed(1)} –{" "}
                          {p.expected.away.toFixed(1)}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </Section>
          ))}
        </>
      )}

      <Section title="Bilan sur tes données">
        <Card className="p-4 text-sm">
          <div className="space-y-2" data-testid="backtest">
          {!bt || bt.matches === 0 ? (
            <p className="text-slate-400">Le bilan apparaît quand des matchs dont les cotes ont été relevées avant le coup d'envoi sont terminés.</p>
          ) : (
            <>
              <div className="text-slate-400">
                Pronostics d'avant-match comparés aux résultats de <b className="text-slate-100" data-testid="backtest-matches">{bt.matches}</b> matchs
                terminés :
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
                « Attendu » : ce que les probabilités annonçaient. Quand le réel reste proche de l'attendu, les cotes décrivent bien le tirage et
                l'issue la plus probable est le choix qui réussit le plus souvent — sans garantie sur un match.
              </p>
            </>
          )}
          </div>
        </Card>
      </Section>
    </div>
  );
}
