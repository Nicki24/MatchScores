import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Radio, TriangleAlert } from "lucide-react";
import { db } from "../db";
import { computeTable, favourite, headToHead, marketLabel, marketsOf, pct, selectionLabel, teamForm } from "../core/analysis";
import { teamKey } from "../core/normalize/util";
import type { MatchRow } from "../core/types";
import { useLatestStandings, useMatches, useOddsFor, useTick, useViewSource } from "./hooks";
import { Button, Card, Empty, FormChips, fmtDateTime, fmtTime, Pill, ProbBar, Section } from "./kit";

const COLORS: Record<string, string> = { "1": "#34d399", X: "#94a3b8", "2": "#22d3ee" };

export function Disclaimer() {
  return (
    <div className="mb-4 flex gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[.06] p-3 text-[12px] leading-snug text-amber-100/90">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <p>
        Les matchs virtuels sont tirés au sort par un générateur aléatoire : les statistiques décrivent le passé et les cotes, elles ne prédisent
        pas le prochain résultat. MatchScores ne place aucun pari. Jouer comporte des risques : mise uniquement ce que tu peux perdre.
      </p>
    </div>
  );
}

function roundTitle(m: MatchRow) {
  return [m.league ?? "Ligue", m.season ? `Saison ${m.season}` : null, m.round != null ? `Journée ${m.round}` : null].filter(Boolean).join(" · ");
}

function groupByRound(ms: MatchRow[]) {
  const groups = new Map<string, MatchRow[]>();
  for (const m of ms) {
    const k = roundTitle(m);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.entries()];
}

export function MatchesPage({ onOpen, onCollect, onDemo }: { onOpen: (key: string) => void; onCollect: () => void; onDemo: () => void }) {
  const [source] = useViewSource();
  const matches = useMatches(source);
  useTick(15_000);
  const now = Date.now();
  const upcoming = (matches ?? [])
    .filter((m) => m.status !== "finished" && Date.parse(m.updated_at) > now - 20 * 60_000)
    .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? "") || (a.round ?? 0) - (b.round ?? 0));
  const odds = useOddsFor(upcoming.map((m) => m.key));

  if (matches && matches.length === 0) {
    return (
      <div>
        <Disclaimer />
        <Card className="p-5">
          <div className="text-lg font-bold">Aucun match pour l'instant</div>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
            <li>Ouvre l'onglet « Collecte » : bet261 s'affiche dans l'appli.</li>
            <li>Va dans Virtuels → Football → English League (pas besoin de te connecter).</li>
            <li>Laisse la page ouverte quelques secondes, puis reviens ici.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={onCollect} testId="go-collect">
              Ouvrir la collecte
            </Button>
            <Button onClick={onDemo} testId="go-demo">
              Essayer avec la démo
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const favourites = upcoming
    .map((m) => ({ m, f: favourite(marketsOf(odds?.get(m.key) ?? [])) }))
    .filter((x) => x.f)
    .sort((a, b) => b.f!.probability - a.f!.probability)
    .slice(0, 3);

  return (
    <div>
      <Disclaimer />
      {upcoming.length === 0 && <Empty title="Pas de match à venir en ce moment">Les nouveaux matchs apparaissent dès que la page des matchs est ouverte dans l'onglet Collecte.</Empty>}
      {groupByRound(upcoming).map(([title, ms]) => (
        <Section key={title} title={title} right={<span className="text-xs text-slate-500">{ms.length} matchs</span>}>
          <div className="space-y-2">
            {ms.map((m) => {
              const markets = marketsOf(odds?.get(m.key) ?? []);
              const main = markets.find((x) => x.market === "1X2") ?? markets.find((x) => x.market === "12");
              const fav = favourite(markets);
              return (
                <Card key={m.key} className="p-3" onClick={() => onOpen(m.key)}>
                  <div data-testid="match-card" className="flex items-center gap-3">
                    <div className="w-12 shrink-0 text-center text-xs text-slate-400">
                      {m.status === "live" ? (
                        <Pill tone="red">
                          <Radio className="h-3 w-3" /> Direct
                        </Pill>
                      ) : (
                        <span className="tabular">{fmtTime(m.kickoff_at)}</span>
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
                  {main && (
                    <div className="mt-2.5">
                      <ProbBar parts={main.selections.map((s) => ({ label: s.selection, value: s.probability, color: COLORS[s.selection] ?? "#a5b4fc" }))} />
                      <div className="mt-1 flex justify-between text-[11px] text-slate-400 tabular">
                        {main.selections.map((s) => (
                          <span key={s.selection}>
                            <span style={{ color: COLORS[s.selection] }}>●</span> {s.selection} {pct(s.probability)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {fav && (
                    <div className="mt-1.5 text-[11px] text-slate-500">
                      Plus probable selon la cote : <span className="text-slate-300">{selectionLabel(fav.market, fav.selection, m)}</span> ({pct(fav.probability)})
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </Section>
      ))}
      {favourites.length > 0 && (
        <Section title="Issues les plus probables selon les cotes">
          <Card className="divide-y divide-white/5">
            {favourites.map(({ m, f }) => (
              <div key={m.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" onClick={() => onOpen(m.key)}>
                <span className="min-w-0 truncate">
                  {selectionLabel(f!.market, f!.selection, m)} <span className="text-slate-500">· {m.home_team} – {m.away_team}</span>
                </span>
                <span className="shrink-0 tabular text-slate-300">
                  {pct(f!.probability)} · {f!.odds.toFixed(2)}
                </span>
              </div>
            ))}
            <p className="px-3 py-2 text-[11px] text-slate-500">Probabilités déduites des cotes, marge du bookmaker retirée. Ce ne sont pas des certitudes.</p>
          </Card>
        </Section>
      )}
    </div>
  );
}

export function ResultsPage({ onOpen }: { onOpen: (key: string) => void }) {
  const [source] = useViewSource();
  const matches = useMatches(source);
  const finished = (matches ?? []).filter((m) => m.status === "finished").sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 120);
  if (matches && !finished.length) return <Empty title="Aucun résultat enregistré">Les scores s'ajoutent quand la page des résultats (ou la fin des matchs) est visible dans la collecte.</Empty>;
  return (
    <div>
      {groupByRound(finished).map(([title, ms]) => (
        <Section key={title} title={title}>
          <Card className="divide-y divide-white/5">
            {ms.map((m) => (
              <div key={m.key} data-testid="result-row" className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 text-sm" onClick={() => onOpen(m.key)}>
                <span className="truncate text-right">{m.home_team}</span>
                <span className="rounded-md bg-white/8 px-2 py-0.5 font-bold tabular">
                  {m.home_score} - {m.away_score}
                </span>
                <span className="truncate">{m.away_team}</span>
              </div>
            ))}
          </Card>
        </Section>
      ))}
    </div>
  );
}

export function StandingsPage() {
  const [source] = useViewSource();
  const latest = useLatestStandings(source);
  const matches = useMatches(source);
  const computed = latest && latest.length === 0 && matches ? computeTable(matches) : [];
  const rows = latest?.length
    ? latest.map((r) => ({ ...r, form: r.form ?? "" }))
    : computed.map((r) => ({ ...r, form: r.form.join(""), key: r.team }));
  if (!rows.length) return <Empty title="Classement indisponible">Il apparaît dès qu'un classement ou des résultats ont été collectés.</Empty>;
  return (
    <Section
      title={latest?.length ? `Classement${latest[0].league ? ` — ${latest[0].league}` : ""}${latest[0].round ? ` · après la journée ${latest[0].round}` : ""}` : "Classement recalculé avec les résultats collectés"}
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
  const all = useMatches(m?.source_id ?? "", 2000);
  const standings = useLatestStandings(m?.source_id ?? "");
  if (!m) return null;
  const markets = marketsOf(odds ?? []);
  const forms = [teamForm(m.home_team, all ?? [], m), teamForm(m.away_team, all ?? [], m)];
  const h2h = headToHead(m.home_team, m.away_team, (all ?? []).filter((x) => x.key !== m.key));
  const lastStand = (standings ?? []).reduce<Record<string, number>>((acc, r) => {
    const k = teamKey(r.team);
    acc[k] = r.position;
    return acc;
  }, {});
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink-950 safe-bottom" data-testid="match-detail">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/5 bg-ink-950/95 px-3 py-2 backdrop-blur">
        <button className="grid h-9 w-9 place-items-center rounded-lg bg-white/6" onClick={onClose} aria-label="Retour">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 text-sm text-slate-400">{roundTitle(m)}</div>
      </div>
      <div className="mx-auto max-w-xl p-4">
        <Card className="p-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <div>
              <div className="font-bold">{m.home_team}</div>
              <div className="mt-1 text-xs text-slate-400">{lastStand[teamKey(m.home_team)] ? `${lastStand[teamKey(m.home_team)]}e` : ""}</div>
            </div>
            <div className="text-2xl font-black tabular">{m.home_score != null ? `${m.home_score} - ${m.away_score}` : fmtTime(m.kickoff_at)}</div>
            <div>
              <div className="font-bold">{m.away_team}</div>
              <div className="mt-1 text-xs text-slate-400">{lastStand[teamKey(m.away_team)] ? `${lastStand[teamKey(m.away_team)]}e` : ""}</div>
            </div>
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <Pill tone={m.status === "finished" ? "slate" : m.status === "live" ? "red" : "green"}>
              {m.status === "finished" ? "Terminé" : m.status === "live" ? "En direct" : "À venir"}
            </Pill>
            <Pill tone="cyan">Vu par : {m.methods.join(", ")}</Pill>
          </div>
        </Card>

        <Section title="Cotes et probabilités (marge retirée)">
          {markets.length === 0 ? (
            <Empty title="Pas de cotes enregistrées" />
          ) : (
            <div className="space-y-2">
              {markets.map((mk) => (
                <Card key={mk.market} className="p-3">
                  <div className="mb-2 flex justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{marketLabel(mk.market)}</span>
                    <span>marge {pct(Math.max(0, mk.margin))} · {fmtTime(mk.updated_at)}</span>
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
                        .map((s) => `${s.selection} ${s.history.map((h) => h.value.toFixed(2)).join(" → ")}`)
                        .join(" · ")}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Section>

        <Section title="Forme récente (5 derniers matchs collectés)">
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

