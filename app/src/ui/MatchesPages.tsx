import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Check, Radio, TriangleAlert, X } from "lucide-react";
import { db } from "../db";
import { computeTable, favourite, headToHead, mainLeague, marketLabel, marketsOf, pct, selectionLabel, teamForm } from "../core/analysis";
import { teamKey } from "../core/normalize/util";
import { openingMarkets, outcomeOf, predict, type Prediction } from "../core/predict";
import { upcomingMatches } from "../core/schedule";
import type { Category, MatchRow, Method, OddsRow } from "../core/types";
import { useCategory, useFinishedMatches, useLatestStandings, useOddsFor, usePolled, useRecentMatches, useScoped, useTick, useViewSource } from "./hooks";
import {
  Button,
  Card,
  Chances,
  choiceLabel,
  ConfidencePill,
  Countdown,
  cx,
  Empty,
  fmtDateTime,
  fmtKickoff,
  FormChips,
  Pill,
  scoreLabel,
  scoreSentence,
  Section,
  verdict,
} from "./kit";

export function Disclaimer({ category = "virtual" }: { category?: Category }) {
  return (
    <div className="mb-4 flex gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[.06] px-3 py-2 text-[11.5px] leading-snug text-amber-100/90">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
      <p>
        {category === "virtual" ? "Matchs virtuels tirés au sort : " : ""}un pronostic est une probabilité calculée à partir des cotes, jamais une certitude. L'appli
        ne place aucun pari. Mise uniquement ce que tu peux perdre.
      </p>
    </div>
  );
}

export function roundTitle(m: MatchRow) {
  return [m.league ?? "Ligue", m.season ? `Saison ${m.season}` : null, m.round != null ? `Journée ${m.round}` : null].filter(Boolean).join(" · ");
}

/** Regroupe une liste déjà triée par journée (deux journées de même numéro mais de saisons différentes restent séparées). */
export function groupByRound(ms: MatchRow[]): [string, MatchRow[], string][] {
  const groups: [string, MatchRow[], string][] = [];
  for (const m of ms) {
    const title = roundTitle(m);
    const last = groups[groups.length - 1];
    if (last && last[0] === title) last[1].push(m);
    else groups.push([title, [m], `${title}#${groups.length}`]);
  }
  return groups;
}

const probabilities = (p: Pick<Prediction, "p1" | "pX" | "p2">) => ({ "1": p.p1, X: p.pX, "2": p.p2 });

/** Méthodes de relevé, en clair (voir Plus → Qualité). */
const METHOD_SHORT: Record<Method, string> = { A: "API", B: "relecture", C: "réseau", D: "texte de la page", E: "capture d'écran" };

/** Pronostic d'avant-match d'un match terminé : l'issue la plus probable s'est-elle produite ? */
export function PredictionCheck({ m, odds }: { m: MatchRow; odds: OddsRow[] }) {
  const p = predict(openingMarkets(odds));
  if (!p) return null;
  const ok = p.outcome.selection === outcomeOf(m);
  return (
    <div className={cx("flex items-center justify-center gap-1 text-[11px]", ok ? "text-emerald-300" : "text-rose-300/90")} data-testid="result-check">
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      Pronostic : {verdict(p.outcome, m)} ({pct(p.outcome.probability)}) — {ok ? "réussi" : "raté"}
    </div>
  );
}

export function MatchesPage({ onOpen, onCollect, onDemo }: { onOpen: (key: string) => void; onCollect: () => void; onDemo: () => void }) {
  const [source] = useViewSource();
  const { matches, category } = useScoped(useRecentMatches(source));
  useTick(15_000);
  const upcoming = matches ? upcomingMatches(matches, Date.now(), { live: true }) : [];
  const odds = useOddsFor(upcoming.map((m) => m.key));

  if (matches && matches.length === 0) {
    return (
      <div>
        <Disclaimer category={category} />
        <Card className="p-5">
          <div className="text-lg font-bold">{category === "virtual" ? "Aucun match virtuel pour l'instant" : "Aucun match réel relevé"}</div>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
            <li>Ouvre l'onglet « Collecte » : bet261 s'affiche dans l'appli.</li>
            {category === "virtual" ? (
              <li>Va dans Virtuels → Football → English League (pas besoin de te connecter).</li>
            ) : (
              <li>Ouvre une liste de matchs (Sport → Football) : les matchs réels sont relevés à part des virtuels.</li>
            )}
            <li>Laisse la page ouverte quelques secondes, puis touche « ← Analyse ».</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={onCollect} testId="go-collect">
              Ouvrir la collecte
            </Button>
            {category === "virtual" && (
              <Button onClick={onDemo} testId="go-demo">
                Essayer avec la démo
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const next = upcoming.find((m) => m.status !== "live" && m.kickoff_at);
  return (
    <div>
      <Disclaimer category={category} />
      {next?.kickoff_at && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl bg-emerald-400/10 px-3 py-2 text-sm" data-testid="next-kickoff">
          <span className="min-w-0 truncate text-emerald-100">
            Prochain coup d'envoi{next.round != null ? ` · Journée ${next.round}` : ""} · {fmtKickoff(next.kickoff_at)}
          </span>
          <span className="shrink-0 font-bold text-emerald-200">
            <Countdown iso={next.kickoff_at} />
          </span>
        </div>
      )}
      {upcoming.length === 0 && (
        <Empty title="Pas de match à venir en ce moment">
          Les matchs déjà joués ne sont plus affichés ici (voir Résultats). Les prochains apparaissent dès que la page des matchs est ouverte dans l'onglet
          Collecte.
        </Empty>
      )}
      {groupByRound(upcoming).map(([title, ms, id]) => (
        <Section key={id} title={title} right={<span className="text-xs text-slate-500">{ms.length} matchs</span>}>
          <div className="space-y-2">
            {ms.map((m) => {
              const markets = marketsOf(odds?.get(m.key) ?? []);
              const main = markets.find((x) => x.market === "1X2") ?? markets.find((x) => x.market === "12");
              const fav = favourite(markets);
              const p = (s: string) => main?.selections.find((x) => x.selection === s)?.probability ?? 0;
              return (
                <Card key={m.key} className="p-3" onClick={() => onOpen(m.key)}>
                  <div data-testid="match-card" className="flex items-center gap-3">
                    <div className="w-14 shrink-0 text-center text-xs text-slate-400">
                      {m.status === "live" ? (
                        <Pill tone="red">
                          <Radio className="h-3 w-3" /> Direct
                        </Pill>
                      ) : (
                        <span className="tabular">{fmtKickoff(m.kickoff_at)}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold" data-testid="home">
                        {m.home_team}
                      </div>
                      <div className="truncate font-semibold" data-testid="away">
                        {m.away_team}
                      </div>
                    </div>
                    {m.status === "live" && m.home_score != null && (
                      <div className="text-lg font-bold tabular">
                        {m.home_score}-{m.away_score}
                      </div>
                    )}
                    <div className="flex gap-1">
                      {(main?.selections ?? []).map((s) => (
                        <div key={s.selection} className="w-12 rounded-lg bg-white/6 py-1 text-center">
                          <div className="text-[10px] text-slate-400">{s.selection}</div>
                          <div className="text-sm font-bold tabular" data-testid={`odd-${s.selection}`}>
                            {s.value.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {main?.market === "1X2" && <Chances m={m} p={{ "1": p("1"), X: p("X"), "2": p("2") }} />}
                  {fav && (
                    <div className="mt-1.5 text-[12px] text-slate-400">
                      Favori : <b className="text-slate-100">{fav.selection === "X" ? "match nul" : selectionLabel(fav.market, fav.selection, m)}</b> ({pct(fav.probability)} de
                      chances)
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}

export function ResultsPage({ onOpen }: { onOpen: (key: string) => void }) {
  const [source] = useViewSource();
  const { matches, category } = useScoped(useFinishedMatches(source, 600));
  const finished = (matches ?? [])
    .sort((a, b) => (b.kickoff_at ?? b.updated_at).localeCompare(a.kickoff_at ?? a.updated_at) || b.updated_at.localeCompare(a.updated_at))
    .slice(0, 120);
  const odds = useOddsFor(finished.map((m) => m.key));
  if (matches && !finished.length)
    return (
      <Empty title={category === "virtual" ? "Aucun résultat virtuel enregistré" : "Aucun résultat de match réel enregistré"}>
        Les scores s'ajoutent quand la page des résultats (ou la fin des matchs) est visible dans la collecte.
      </Empty>
    );
  return (
    <div>
      {groupByRound(finished).map(([title, ms, id]) => {
        const judged = ms.flatMap((m) => {
          const p = predict(openingMarkets(odds?.get(m.key) ?? []));
          return p ? [p.outcome.selection === outcomeOf(m)] : [];
        });
        const hits = judged.filter(Boolean).length;
        return (
          <Section
            key={id}
            title={title}
            right={judged.length > 0 && <span className="text-xs text-slate-400">{`${hits}/${judged.length} pronostic${judged.length > 1 ? "s" : ""} juste${hits > 1 ? "s" : ""}`}</span>}
          >
            <Card className="divide-y divide-white/5">
              {ms.map((m) => (
                <div key={m.key} data-testid="result-row" className="cursor-pointer px-3 py-2 text-sm" onClick={() => onOpen(m.key)}>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <span className={cx("truncate text-right", m.home_score! > m.away_score! && "font-bold")}>{m.home_team}</span>
                    <span className="rounded-md bg-white/8 px-2 py-0.5 font-bold tabular">
                      {m.home_score} - {m.away_score}
                    </span>
                    <span className={cx("truncate", m.away_score! > m.home_score! && "font-bold")}>{m.away_team}</span>
                  </div>
                  <PredictionCheck m={m} odds={odds?.get(m.key) ?? []} />
                </div>
              ))}
            </Card>
          </Section>
        );
      })}
    </div>
  );
}

export function StandingsPage() {
  const [source] = useViewSource();
  const [category] = useCategory();
  const latest = useLatestStandings(source);
  const { matches } = useScoped(useFinishedMatches(source, 600));
  // Classement recalculé : seulement pour une ligue virtuelle (une saison complète est relevée en quelques heures)
  const league = matches ? mainLeague(matches) : undefined;
  const computed = latest && latest.length === 0 && matches && category === "virtual" ? computeTable(matches, league) : [];
  const rows = latest?.length
    ? latest.map((r) => ({ ...r, form: r.form ?? "" }))
    : computed.map((r) => ({ ...r, form: r.form.join(""), key: r.team }));
  if (!rows.length)
    return (
      <Empty title="Classement indisponible">
        {category === "virtual"
          ? "Il apparaît dès qu'un classement ou des résultats virtuels ont été collectés."
          : "Pour une ligue réelle, ouvre sa page de classement dans la collecte."}
      </Empty>
    );
  return (
    <Section
      title={
        latest?.length
          ? `Classement${latest[0].league ? ` — ${latest[0].league}` : ""}${latest[0].round ? ` · après la journée ${latest[0].round}` : ""}`
          : `Classement recalculé${league ? ` — ${league}` : ""} (résultats collectés)`
      }
    >
      <Card className="overflow-x-auto">
        <table className="w-full text-sm tabular" data-testid="standings">
          <thead className="text-[11px] uppercase text-slate-500">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-right [&>th:nth-child(2)]:text-left">
              <th>#</th>
              <th>Équipe</th>
              <th>J</th>
              <th className="hidden min-[480px]:table-cell">G</th>
              <th className="hidden min-[480px]:table-cell">N</th>
              <th className="hidden min-[480px]:table-cell">P</th>
              <th>Diff</th>
              <th>Pts</th>
              <th>Forme</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-white/5 [&>td]:px-2 [&>td]:py-1.5 [&>td]:text-right [&>td:nth-child(2)]:text-left">
                <td className="text-slate-400">{r.position}</td>
                <td className="whitespace-nowrap font-medium">{r.team}</td>
                <td>{r.played}</td>
                <td className="hidden min-[480px]:table-cell">{r.won ?? "—"}</td>
                <td className="hidden min-[480px]:table-cell">{r.drawn ?? "—"}</td>
                <td className="hidden min-[480px]:table-cell">{r.lost ?? "—"}</td>
                <td>{r.goals_for - r.goals_against}</td>
                <td className="font-bold">{r.points}</td>
                <td>
                  <FormChips form={r.form} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

export function MatchDetail({ matchKey, onClose }: { matchKey: string; onClose: () => void }) {
  const m = useLiveQuery(() => db.matches.get(matchKey), [matchKey]);
  const odds = useLiveQuery(() => db.odds.where("match_key").equals(matchKey).toArray(), [matchKey]);
  // Résultats de la même ligue (forme, confrontations) : relus toutes les 30 s, pas à chaque capture
  const history = usePolled(
    async () =>
      m
        ? db.matches
            .orderBy("updated_at")
            .reverse()
            .filter((x) => x.source_id === m.source_id && x.status === "finished" && x.league === m.league && x.key !== m.key)
            .limit(1500)
            .toArray()
        : [],
    [m?.key, m?.league, m?.source_id],
  );
  const standings = useLatestStandings(m?.source_id ?? "");
  if (!m) return null;
  const markets = marketsOf(odds ?? []);
  // Match terminé : le pronostic d'avant-match (premières cotes relevées), comparé au résultat
  const finished = m.status === "finished" && m.home_score != null && m.away_score != null;
  const pred = predict(finished ? openingMarkets(odds ?? []) : markets);
  const forms = [teamForm(m.home_team, history ?? [], m), teamForm(m.away_team, history ?? [], m)];
  const h2h = headToHead(m.home_team, m.away_team, history ?? []);
  const positions = new Map((standings ?? []).filter((r) => !m.league || r.league === m.league).map((r) => [teamKey(r.team), r.position]));
  const position = (team: string) => (positions.get(teamKey(team)) ? `${positions.get(teamKey(team))}e du classement` : "");
  const hit = finished && pred ? pred.outcome.selection === outcomeOf(m) : undefined;
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink-950 safe-bottom" data-testid="match-detail">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/5 bg-ink-950/95 px-3 py-2 backdrop-blur">
        <button className="grid h-9 w-9 place-items-center rounded-lg bg-white/6" onClick={onClose} aria-label="Retour">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 truncate text-sm text-slate-400">{roundTitle(m)}</div>
      </div>
      <div className="mx-auto max-w-xl p-4">
        <Card className="p-4">
          <div className="text-center text-xs text-slate-400 tabular">{fmtKickoff(m.kickoff_at)}</div>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <div className="min-w-0">
              <div className="font-bold">{m.home_team}</div>
              <div className="mt-1 text-[11px] text-slate-400">domicile{position(m.home_team) && ` · ${position(m.home_team)}`}</div>
            </div>
            <div className="text-2xl font-black tabular">{m.home_score != null ? `${m.home_score} - ${m.away_score}` : <span className="text-base text-slate-500">VS</span>}</div>
            <div className="min-w-0">
              <div className="font-bold">{m.away_team}</div>
              <div className="mt-1 text-[11px] text-slate-400">extérieur{position(m.away_team) && ` · ${position(m.away_team)}`}</div>
            </div>
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <Pill tone={m.status === "finished" ? "slate" : m.status === "live" ? "red" : "green"}>
              {m.status === "finished" ? "Terminé" : m.status === "live" ? "En direct" : "À venir"}
            </Pill>
            <Pill tone="cyan">Relevé par : {m.methods.map((x) => METHOD_SHORT[x]).join(", ")}</Pill>
          </div>
        </Card>

        {pred && (
          <Section title={finished ? "Pronostic d'avant-match" : "Pronostic (d'après les cotes)"}>
            <Card className="p-3">
              <div data-testid="detail-prediction">
                <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-400/10 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-emerald-200/80">Le plus probable</div>
                    <div className="truncate text-[15px] font-bold text-emerald-100">{verdict(pred.outcome, m)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-black tabular">{pct(pred.outcome.probability)}</div>
                    {hit === undefined ? <ConfidencePill c={pred.confidence} /> : <Pill tone={hit ? "green" : "red"}>{hit ? "Réussi" : "Raté"}</Pill>}
                  </div>
                </div>
                <Chances m={m} p={probabilities(pred)} />
                <div className="mt-2 space-y-1 text-[12.5px] text-slate-300">
                  <div>
                    Option plus sûre : <b className="text-slate-100">{choiceLabel(pred.safest, m)}</b> — {pct(pred.safest.probability)} de chances
                  </div>
                  <div>Risque que le pronostic soit faux : {pct(1 - pred.outcome.probability)}</div>
                </div>
                <div className="mt-3 text-xs font-semibold text-slate-300">
                  Scores exacts les plus probables {pred.scoreSource === "marché" ? "(cotes du score exact)" : "(modèle de buts ajusté sur les cotes)"}
                </div>
                <div className="mt-1.5 space-y-1">
                  {pred.scores.map((s) => (
                    <div key={scoreLabel(s)} className="flex items-center gap-2 text-sm" data-testid="detail-score">
                      <span className={cx("w-[48%] shrink-0 truncate tabular", finished && s.home === m.home_score && s.away === m.away_score && "font-bold text-emerald-300")}>{scoreSentence(s, m)}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-cyan-400/80" style={{ width: `${(s.probability / pred.scores[0].probability) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs text-slate-400 tabular">{pct(s.probability)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] leading-tight text-slate-400">
                  <div className="rounded-lg bg-white/5 p-2">
                    <div className="text-sm font-bold text-slate-100 tabular">
                      {pred.expected.home.toFixed(1)} – {pred.expected.away.toFixed(1)}
                    </div>
                    buts attendus
                  </div>
                  <div className="rounded-lg bg-white/5 p-2">
                    <div className="text-sm font-bold text-slate-100 tabular">{pct(pred.over25)}</div>3 buts ou plus
                  </div>
                  <div className="rounded-lg bg-white/5 p-2">
                    <div className="text-sm font-bold text-slate-100 tabular">{pct(pred.btts)}</div>
                    les deux marquent
                  </div>
                </div>
              </div>
            </Card>
          </Section>
        )}

        <Section title="Forme récente (5 derniers matchs relevés)">
          <Card className="divide-y divide-white/5">
            {forms.map((f) => (
              <div key={f.team} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate font-medium">{f.team}</span>
                <span className="flex items-center gap-2 text-xs text-slate-400 tabular">
                  {f.played ? `${f.goalsFor} but${f.goalsFor > 1 ? "s" : ""} marqué${f.goalsFor > 1 ? "s" : ""} · ${f.goalsAgainst} encaissé${f.goalsAgainst > 1 ? "s" : ""}` : "pas encore de résultat"}
                  <FormChips form={f.form} />
                </span>
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Confrontations précédentes">
          {h2h.length === 0 ? (
            <Empty title="Aucune confrontation enregistrée" />
          ) : (
            <Card className="divide-y divide-white/5">
              {h2h.map((x) => (
                <div key={x.key} className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 py-2 text-sm">
                  <span className="truncate text-right">{x.home_team}</span>
                  <span className="font-bold tabular">
                    {x.home_score} - {x.away_score}
                  </span>
                  <span className="truncate">{x.away_team}</span>
                </div>
              ))}
            </Card>
          )}
        </Section>

        <Section title="Cotes relevées (probabilités sans la marge)">
          {markets.length === 0 ? (
            <Empty title="Pas de cotes enregistrées" />
          ) : (
            <div className="space-y-2">
              {markets.map((mk) => (
                <Card key={mk.market} className="p-3">
                  <div className="mb-2 flex justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{marketLabel(mk.market)}</span>
                    <span>
                      marge {pct(Math.max(0, mk.margin))} · {fmtKickoff(mk.updated_at)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {mk.selections.map((s) => (
                      <div key={s.selection} className="flex items-center gap-2 text-sm">
                        <span className="w-28 truncate">{selectionLabel(mk.market, s.selection, m)}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                          <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${s.probability * 100}%` }} />
                        </div>
                        <span className="w-10 text-right text-xs text-slate-400 tabular">{pct(s.probability)}</span>
                        <span className="w-12 text-right font-bold tabular">{s.value.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  {mk.selections.some((s) => s.history.length > 1) && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      Évolution :{" "}
                      {mk.selections
                        .filter((s) => s.history.length > 1)
                        .map((s) => `${selectionLabel(mk.market, s.selection, m)} ${s.history.map((h) => h.value.toFixed(2)).join(" → ")}`)
                        .join(" · ")}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Section>
        <p className="pb-6 text-center text-[11px] text-slate-500">
          Première capture {fmtDateTime(m.first_seen_at)} · mise à jour {fmtDateTime(m.updated_at)}
        </p>
        <Button className="mb-8 w-full" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </div>
  );
}
