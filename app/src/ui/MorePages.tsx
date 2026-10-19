import { useLiveQuery } from "dexie-react-hooks";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { db } from "../db";
import { buildDiagnostic, diagnosticFileName } from "../core/diagnostic";
import { marketsOf } from "../core/analysis";
import { METHOD_LABELS, retainedMethod, scoreMethods, type MethodScore } from "../core/quality";
import { renormalize, setSetting } from "../core/store";
import { APP_VERSION, metas, requestCollectorShot, saveFile, setDemo, toast, useRuntime } from "../runtime";
import { useSetting, useViewSource } from "./hooks";
import { Button, Card, cx, Empty, fmtDateTime, fmtTime, Pill, Section, Toggle } from "./kit";

const pct = (v: number) => `${Math.round(v * 100)} %`;

async function sourceData(source: string) {
  const prefix = `${source}|`;
  return {
    matches: await db.matches.where("source_id").equals(source).toArray(),
    odds: await db.odds.filter((o) => o.match_key.startsWith(prefix)).toArray(),
    cycles: await db.cycles.where("source_id").equals(source).toArray(),
    checks: (await db.checks.toArray()).filter((c) => c.match_key.startsWith(prefix)),
  };
}

function ScoreRow({ s }: { s: MethodScore }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">{s.label}</div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-black tabular" data-testid={`score-${s.method}`}>
            {s.total}/20
          </span>
          {s.retained ? <Pill tone="green">Retenue</Pill> : <Pill tone={s.access ? "amber" : "slate"}>{s.access ? "Non retenue" : "Pas de données"}</Pill>}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-x-3 text-xs text-slate-400 tabular">
        <span>
          Exactitude (6) : {pct(s.exactness.value)}{" "}
          {s.exactness.mode !== "aucun" && `· ${s.exactness.checked} comparés ${s.exactness.mode === "croisé" ? "avec l'écran" : "à la main"}, ${s.exactness.errors} erreur(s)`}
        </span>
        <span>
          Complétude (4) : {pct(s.completeness.value)} · {s.completeness.detail} ({s.completeness.rounds} j.)
        </span>
        <span>
          Stabilité (4) : {pct(s.stability.value)} · {s.stability.ok}/{s.stability.minutes} min
        </span>
        <span>
          Fraîcheur (3) : {pct(s.freshness.value)}
          {s.freshness.medianLagSeconds != null && ` · retard médian ${Math.round(s.freshness.medianLagSeconds)} s`}
        </span>
        <span>Coût (3) : {pct(s.cost.value)} · gratuit</span>
        <span>Accès sans compte : {s.access ? "oui" : "—"}</span>
      </div>
      {s.eliminated && <div className="mt-2 text-xs text-amber-200">Critère éliminatoire : {s.eliminated}</div>}
    </Card>
  );
}

export function QualityPage() {
  const [source] = useViewSource();
  const [conformity, setConformity] = useSetting("conformity", false);
  const data = useLiveQuery(() => sourceData(source), [source]);
  if (!data) return null;
  const scores = scoreMethods({ ...data, conformity });
  const retained = retainedMethod(scores);
  const checked = new Map(data.checks.map((c) => [c.match_key, c.ok]));
  const toCheck = data.matches
    .filter((m) => data.odds.some((o) => o.match_key === m.key && o.market === "1X2"))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 20);
  const okCount = data.checks.filter((c) => c.ok).length;
  return (
    <div>
      <p className="mb-4 text-sm text-slate-400">
        Grille du cahier des charges (section 4) calculée sur les données réellement collectées par ce téléphone. Une méthode est retenue avec au
        moins 14/20, aucune erreur d'exactitude et la conformité validée.
      </p>
      <Section title="Notes par méthode">
        <div className="space-y-2">
          {scores.map((s) => (
            <ScoreRow key={s.method} s={s} />
          ))}
        </div>
      </Section>

      <Section title="Tableau de suivi">
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th>Source</th>
                <th>Méthode testée</th>
                <th>Date</th>
                <th>Note /20</th>
                <th>Retenue</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.method} className="border-t border-white/5 [&>td]:px-3 [&>td]:py-2">
                  <td>{source}</td>
                  <td className="whitespace-nowrap">{METHOD_LABELS[s.method]}</td>
                  <td className="whitespace-nowrap">{new Date().toLocaleDateString("fr-FR")}</td>
                  <td className="tabular">{s.total}</td>
                  <td>{s.retained ? "Oui" : "Non"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-2 px-1 text-xs text-slate-400">
          Méthode retenue : <span className="font-semibold text-slate-200">{retained ? retained.label : "aucune pour l'instant"}</span>
        </p>
      </Section>

      <Section title="Conformité (éliminatoire)">
        <Card className="px-4 py-2">
          <Toggle
            testId="conformity"
            label="J'ai lu les conditions d'utilisation de bet261 et cet usage personnel est autorisé"
            hint="À vérifier dans la rubrique Règles / Conditions du site, depuis l'onglet Collecte. La collecte ne contourne aucune protection et ne place aucun pari."
            checked={conformity}
            onChange={setConformity}
          />
        </Card>
      </Section>

      <Section title={`Exactitude : 20 matchs comparés à l'écran (${data.checks.length}/20, ${okCount} identiques)`}>
        {toCheck.length === 0 ? (
          <Empty title="Aucun match à vérifier">Ouvre la page des matchs dans la collecte.</Empty>
        ) : (
          <Card className="divide-y divide-white/5">
            {toCheck.map((m) => {
              const main = marketsOf(data.odds.filter((o) => o.match_key === m.key)).find((x) => x.market === "1X2");
              const state = checked.get(m.key);
              return (
                <div key={m.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {m.home_team} – {m.away_team} {m.home_score != null && <b className="tabular">({m.home_score}-{m.away_score})</b>}
                    </div>
                    <div className="text-xs text-slate-500 tabular">
                      {fmtTime(m.kickoff_at)} · J{m.round ?? "?"} · {main?.selections.map((s) => s.value.toFixed(2)).join(" / ") ?? "—"}
                    </div>
                  </div>
                  <button
                    className={cx("grid h-8 w-8 place-items-center rounded-lg", state === true ? "bg-emerald-400 text-emerald-950" : "bg-white/6")}
                    onClick={() => db.checks.put({ match_key: m.key, ok: true, checked_at: new Date().toISOString() })}
                    aria-label="Identique"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    className={cx("grid h-8 w-8 place-items-center rounded-lg", state === false ? "bg-rose-400 text-rose-950" : "bg-white/6")}
                    onClick={() => db.checks.put({ match_key: m.key, ok: false, checked_at: new Date().toISOString() })}
                    aria-label="Différent"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </Card>
        )}
      </Section>
    </div>
  );
}

export function JournalPage() {
  const cycles = useLiveQuery(() => db.cycles.orderBy("id").reverse().limit(200).toArray(), []);
  if (!cycles) return null;
  if (!cycles.length) return <Empty title="Journal vide">Chaque réponse reçue et chaque minute de collecte y sont consignées (NF3).</Empty>;
  return (
    <Card className="divide-y divide-white/5" >
      {cycles.map((c) => (
        <div key={c.id} className="px-3 py-2 text-xs" data-testid="cycle">
          <div className="flex justify-between gap-2">
            <span className="tabular text-slate-300">{fmtDateTime(c.started_at)}</span>
            <span className="flex gap-1">
              <Pill tone={c.kind === "timer" ? "slate" : c.kind === "dom" ? "cyan" : "green"}>{c.kind === "timer" ? "cycle 1 min" : c.kind}</Pill>
              {c.error ? <Pill tone="red">erreur</Pill> : c.unchanged ? <Pill>inchangé</Pill> : null}
            </span>
          </div>
          {c.url && <div className="mt-0.5 truncate text-slate-500">{c.url}</div>}
          <div className="mt-0.5 text-slate-400 tabular">
            {c.kind === "timer" ? `${c.matches} réponse(s) utiles dans la minute` : `${c.matches} match(s) · ${c.odds} cote(s) · ${c.standings} ligne(s) de classement · ${c.duration_ms} ms`}
            {c.error && <span className="text-rose-300"> · {c.error}</span>}
          </div>
        </div>
      ))}
    </Card>
  );
}

export function SettingsPage() {
  const rt = useRuntime();
  const sources = useLiveQuery(() => db.sources.toArray(), []);
  const [view, setView] = useViewSource();
  const [withShot, setWithShot] = useSetting("diagShot", true);
  const [progress, setProgress] = useState<string>();
  const counts = useLiveQuery(async () => ({ raw: await db.raw_captures.count(), matches: await db.matches.count(), odds: await db.odds.count(), standings: await db.standings.count() }), []);

  const createDiagnostic = async () => {
    setProgress("Préparation du relevé…");
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    const raw = (await db.raw_captures.where("captured_at").above(since).toArray()).filter((r) => r.source_id === "bet261");
    const cycles = (await db.cycles.where("started_at").above(since).toArray()).filter((c) => c.source_id === "bet261");
    const screenshot = withShot ? await requestCollectorShot() : undefined;
    const report = buildDiagnostic({
      appVersion: `${APP_VERSION}${rt.nativeVersion ? ` (Android ${rt.nativeVersion})` : ""}`,
      userAgent: navigator.userAgent,
      collectorUrl: rt.collector.url,
      raw,
      cycles,
      metas,
      counts: { matches: counts?.matches ?? 0, odds: counts?.odds ?? 0, standings: counts?.standings ?? 0 },
      screenshot,
    });
    saveFile(diagnosticFileName(), "application/json", JSON.stringify(report, null, 1));
    setProgress(undefined);
    if (!rt.native) toast("Relevé téléchargé");
  };

  return (
    <div>
      <Section title="Sources (F6)">
        <Card className="px-4 py-2">
          {(sources ?? []).map((s) => (
            <Toggle
              key={s.id}
              testId={`source-${s.id}`}
              label={s.name}
              hint={s.id === "demo" ? "Ligue simulée sur le téléphone, pour découvrir l'appli." : `Méthode retenue : ${s.method} · ${s.startUrl ?? ""}`}
              checked={s.enabled}
              onChange={async (v) => {
                await db.sources.update(s.id, { enabled: v });
                if (s.id === "demo") {
                  await setDemo(v);
                  if (v) setView("demo");
                }
              }}
            />
          ))}
          <label className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="font-medium">Source affichée</span>
            <select className="rounded-lg bg-white/8 px-2 py-1" value={view} onChange={(e) => setView(e.target.value)} data-testid="view-source">
              {(sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
          </label>
        </Card>
      </Section>

      <Section title="Relevé de diagnostic">
        <Card className="p-4">
          <p className="text-sm text-slate-300">
            Rassemble ce que la collecte a vu sur bet261 ces 6 dernières heures (adresses de données, WebSockets, texte affiché, résultat de la
            lecture). Envoie le fichier pour adapter la lecture au format exact du site. Les données de compte (solde, paiements, connexion) ne
            sont jamais enregistrées.
          </p>
          <Toggle label="Inclure une capture d'écran de la page bet261" hint="Si tu es connecté, ton solde peut y apparaître : décoche alors." checked={withShot} onChange={setWithShot} />
          <Button className="mt-2 w-full" variant="primary" onClick={createDiagnostic} disabled={!!progress} testId="diagnostic">
            {progress ?? "Créer le relevé"}
          </Button>
        </Card>
      </Section>

      <Section title="Données">
        <Card className="space-y-3 p-4">
          <div className="text-xs text-slate-400 tabular">
            {counts?.raw ?? 0} captures brutes (7 jours) · {counts?.matches ?? 0} matchs · {counts?.odds ?? 0} cotes · {counts?.standings ?? 0} lignes de classement
          </div>
          <Button
            className="w-full"
            onClick={async () => {
              setProgress("Re-normalisation…");
              await renormalize(db, (d, t) => setProgress(`Re-normalisation ${d}/${t}`));
              setProgress(undefined);
              toast("Captures re-normalisées");
            }}
            disabled={!!progress}
          >
            Re-normaliser les captures brutes (F7)
          </Button>
          <Button
            className="w-full"
            variant="danger"
            onClick={async () => {
              if (!confirm("Effacer toutes les données collectées ?")) return;
              await Promise.all([db.raw_captures.clear(), db.matches.clear(), db.aliases.clear(), db.odds.clear(), db.standings.clear(), db.cycles.clear(), db.checks.clear()]);
              await setSetting(db, "viewSource", "bet261");
              toast("Données effacées");
            }}
          >
            Tout effacer
          </Button>
        </Card>
      </Section>

      <Section title="À propos">
        <Card className="space-y-2 p-4 text-sm text-slate-300">
          <p>MatchScores {APP_VERSION}{rt.nativeVersion ? ` · appli ${rt.nativeVersion}` : ""}. Les données restent sur ce téléphone.</p>
          <p>
            Les matchs virtuels sont tirés par un générateur aléatoire : l'historique sert aux statistiques descriptives, pas à prédire le prochain
            résultat. L'appli ne place aucun pari.
          </p>
          <p className="text-amber-200/90">Jeu responsable : fixe-toi une limite, ne cherche pas à te refaire, fais des pauses. Interdit aux mineurs.</p>
        </Card>
      </Section>
    </div>
  );
}
