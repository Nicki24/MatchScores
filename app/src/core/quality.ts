/**
 * Protocole de vérification (cahier des charges, section 4) calculé sur les
 * données réellement collectées par le téléphone, pour chaque méthode.
 *
 * Grille : exactitude 6, complétude 4, stabilité 4, fraîcheur 3, coût 3 = /20.
 * Retenue si note ≥ 14, aucune erreur d'exactitude et conformité validée.
 */
import type { Check } from "./store";
import type { CycleLog, MatchRow, Method, OddsRow } from "./types";
import { KIND_METHOD } from "./types";

export interface MethodScore {
  method: Method;
  label: string;
  access: boolean;
  /** Matchs vus par cette méthode. */
  matches: number;
  exactness: { value: number; checked: number; errors: number; mode: "manuel" | "croisé" | "aucun" };
  completeness: { value: number; rounds: number; detail: string };
  stability: { value: number; minutes: number; ok: number };
  freshness: { value: number; medianLagSeconds: number | null };
  cost: { value: number; note: string };
  total: number;
  eliminated: string | null;
  retained: boolean;
}

export const METHOD_LABELS: Record<Method, string> = {
  A: "A – API officielle",
  B: "B – Endpoint JSON rejoué",
  C: "C – Écoute réseau (navigateur)",
  D: "D – Texte de la page",
  E: "E – Capture d'écran + OCR",
};

const clamp = (v: number) => Math.max(0, Math.min(1, v));

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Dernière cote 1X2 de chaque issue fournie par une méthode donnée. */
function last1x2(odds: OddsRow[], matchKey: string, method: Method) {
  const out = new Map<string, number>();
  for (const o of odds) if (o.match_key === matchKey && o.method === method && o.market === "1X2") out.set(o.selection, o.value);
  return out;
}

export interface QualityInput {
  matches: MatchRow[];
  odds: OddsRow[];
  cycles: CycleLog[];
  checks: Check[];
  conformity: boolean;
}

export function scoreMethods(input: QualityInput, methods: Method[] = ["B", "C", "D"]): MethodScore[] {
  const { matches, odds, cycles, checks, conformity } = input;
  const byKey = new Map(matches.map((m) => [m.key, m]));
  const timer = cycles.filter((c) => c.kind === "timer");

  // Journées complètes les plus récentes : celles dont au moins un résultat est connu
  const rounds = new Map<string, MatchRow[]>();
  for (const m of matches) {
    if (m.round == null) continue;
    const k = `${m.league ?? ""}|${m.season ?? ""}|${m.round}`;
    rounds.set(k, [...(rounds.get(k) ?? []), m]);
  }
  const finishedRounds = [...rounds.entries()]
    .filter(([, ms]) => ms.some((m) => m.status === "finished"))
    .sort((a, b) => Math.max(...b[1].map((m) => Date.parse(m.updated_at))) - Math.max(...a[1].map((m) => Date.parse(m.updated_at))))
    .slice(0, 3);

  return methods.map((method) => {
    const seen = matches.filter((m) => m.methods.includes(method));
    const access = seen.length > 0;

    // Exactitude : vérification manuelle (20 matchs comparés à l'écran) ou, à défaut,
    // comparaison automatique avec ce que la page affiche (méthode D).
    let exactness: MethodScore["exactness"] = { value: 0, checked: 0, errors: 0, mode: "aucun" };
    const manual = checks.filter((c) => byKey.get(c.match_key)?.methods.includes(method));
    if (manual.length) {
      const errors = manual.filter((c) => !c.ok).length;
      exactness = { value: clamp((manual.length - errors) / 20), checked: manual.length, errors, mode: "manuel" };
    } else if (method !== "D") {
      let compared = 0;
      let errors = 0;
      for (const m of seen.filter((x) => x.methods.includes("D"))) {
        const mine = last1x2(odds, m.key, method);
        const screen = last1x2(odds, m.key, "D");
        if (!mine.size || !screen.size) continue;
        compared++;
        if ([...screen].some(([sel, v]) => mine.get(sel) !== v)) errors++;
      }
      if (compared) exactness = { value: clamp((compared - errors) / 20), checked: compared, errors, mode: "croisé" };
    }

    // Complétude : sur les 3 dernières journées, affiches + cotes 1X2 + résultat fournis par la méthode
    let expected = 0;
    let complete = 0;
    for (const [, ms] of finishedRounds) {
      expected += ms.length;
      complete += ms.filter((m) => m.methods.includes(method) && last1x2(odds, m.key, method).size >= 2 && (m.result_methods ?? []).includes(method)).length;
    }
    const completeness = { value: expected ? complete / expected : 0, rounds: finishedRounds.length, detail: `${complete}/${expected} matchs complets` };

    // Stabilité : minutes de collecte où la méthode a renvoyé des données
    const minutes = new Set(timer.map((c) => c.started_at.slice(0, 16)));
    const okMinutes = new Set(
      cycles
        .filter((c) => c.kind !== "timer" && KIND_METHOD[c.kind] === method && !c.error && (c.unchanged || c.matches + c.odds + c.standings > 0))
        .map((c) => c.started_at.slice(0, 16)),
    );
    const ok = [...minutes].filter((m) => okMinutes.has(m)).length;
    const stability = { value: minutes.size ? ok / minutes.size : 0, minutes: minutes.size, ok };

    // Fraîcheur : retard de la méthode sur la première apparition du match (toutes méthodes confondues)
    const lags: number[] = [];
    for (const m of seen) {
      const firstMine = odds.filter((o) => o.match_key === m.key && o.method === method).reduce((a, o) => (a && a < o.captured_at ? a : o.captured_at), "");
      if (!firstMine) continue;
      lags.push(Math.max(0, (Date.parse(firstMine) - Date.parse(m.first_seen_at)) / 1000));
    }
    const lag = median(lags);
    const freshness = { value: lag == null ? 0 : lag <= 60 ? 1 : clamp(1 - (lag - 60) / 240), medianLagSeconds: lag };

    const cost = { value: 1, note: "Sur le téléphone : gratuit, sans serveur" };
    const total = Math.round((6 * exactness.value + 4 * completeness.value + 4 * stability.value + 3 * freshness.value + 3 * cost.value) * 10) / 10;
    const eliminated = !conformity
      ? "Conformité non validée"
      : exactness.errors > 0
        ? `${exactness.errors} erreur(s) d'exactitude`
        : !access
          ? "Aucune donnée"
          : null;
    return {
      method,
      label: METHOD_LABELS[method],
      access,
      matches: seen.length,
      exactness,
      completeness,
      stability,
      freshness,
      cost,
      total,
      eliminated,
      retained: !eliminated && total >= 14,
    };
  });
}

/** Méthode retenue : la première (B → C → D) qui passe la grille. */
export function retainedMethod(scores: MethodScore[]): MethodScore | undefined {
  return scores.find((s) => s.retained);
}
