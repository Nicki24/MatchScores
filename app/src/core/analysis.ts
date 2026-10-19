/**
 * Statistiques descriptives (cahier des charges, section 7) : les matchs virtuels
 * sont tirés au sort ; on décrit les cotes et l'historique, on ne prédit rien.
 */
import { teamKey } from "./normalize/util";
import type { MatchRow, OddsRow } from "./types";

export function impliedProbabilities(odds: number[]) {
  const raw = odds.map((o) => (o > 1 ? 1 / o : 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  return { fair: raw.map((p) => (sum > 0 ? p / sum : 0)), margin: sum - 1 };
}

export interface OddsPoint {
  value: number;
  at: string;
}
export interface SelectionOdds {
  selection: string;
  value: number;
  history: OddsPoint[];
  /** Probabilité implicite, marge du bookmaker retirée. */
  probability: number;
}
export interface MarketOdds {
  market: string;
  selections: SelectionOdds[];
  margin: number;
  updated_at: string;
}

const MARKET_ORDER = ["1X2", "12", "DC", "OU0.5", "OU1.5", "OU2.5", "OU3.5", "OU4.5", "OU5.5", "BTTS", "CS"];
const SELECTION_ORDER = ["1", "X", "2", "1X", "12", "X2", "Over", "Under", "Oui", "Non"];

/** Dernières cotes de chaque marché, avec leur historique de changements. */
export function marketsOf(rows: OddsRow[]): MarketOdds[] {
  const byMarket = new Map<string, Map<string, OddsPoint[]>>();
  for (const r of [...rows].sort((a, b) => a.captured_at.localeCompare(b.captured_at))) {
    const m = byMarket.get(r.market) ?? new Map<string, OddsPoint[]>();
    const h = m.get(r.selection) ?? [];
    if (h.length === 0 || h[h.length - 1].value !== r.value) h.push({ value: r.value, at: r.captured_at });
    m.set(r.selection, h);
    byMarket.set(r.market, m);
  }
  const out: MarketOdds[] = [];
  for (const [market, sels] of byMarket) {
    const list = [...sels.entries()].map(([selection, history]) => ({ selection, history, value: history[history.length - 1].value }));
    list.sort((a, b) => rank(SELECTION_ORDER, a.selection) - rank(SELECTION_ORDER, b.selection));
    // Pour le score exact, la marge porte sur toutes les issues : on normalise quand même
    const { fair, margin } = impliedProbabilities(list.map((s) => s.value));
    out.push({
      market,
      margin,
      updated_at: list.flatMap((s) => s.history).reduce((a, p) => (p.at > a ? p.at : a), ""),
      selections: list.map((s, i) => ({ ...s, probability: fair[i] })),
    });
  }
  return out.sort((a, b) => rank(MARKET_ORDER, a.market) - rank(MARKET_ORDER, b.market));
}

function rank(order: string[], v: string) {
  const i = order.indexOf(v);
  return i < 0 ? order.length : i;
}

export function marketLabel(market: string): string {
  if (market === "1X2") return "Résultat (1X2)";
  if (market === "12") return "Vainqueur";
  if (market === "DC") return "Double chance";
  if (market === "BTTS") return "Les deux équipes marquent";
  if (market === "CS") return "Score exact";
  const ou = market.match(/^OU(\d+\.5)?$/);
  if (ou) return ou[1] ? `Plus / moins de ${ou[1]} buts` : "Plus / moins de buts";
  return market;
}

export function selectionLabel(market: string, selection: string, m: Pick<MatchRow, "home_team" | "away_team">): string {
  if (market === "1X2" || market === "12") return selection === "1" ? m.home_team : selection === "2" ? m.away_team : "Nul";
  if (market === "DC") return selection === "1X" ? `${m.home_team} ou nul` : selection === "X2" ? `${m.away_team} ou nul` : "Pas de nul";
  if (market.startsWith("OU")) return selection === "Over" ? "Plus" : "Moins";
  return selection;
}

/** L'issue la plus probable selon les cotes (description des cotes, pas une prédiction). */
export function favourite(markets: MarketOdds[]) {
  const main = markets.find((m) => m.market === "1X2") ?? markets.find((m) => m.market === "12");
  if (!main) return undefined;
  const best = [...main.selections].sort((a, b) => b.probability - a.probability)[0];
  return { market: main.market, selection: best.selection, probability: best.probability, odds: best.value };
}

export type FormLetter = "V" | "N" | "D";

export interface TeamForm {
  team: string;
  form: FormLetter[];
  played: number;
  goalsFor: number;
  goalsAgainst: number;
}

const finishedOnly = (ms: MatchRow[]) => ms.filter((m) => m.status === "finished" && m.home_score != null && m.away_score != null);

/**
 * Forme récente d'une équipe (du plus ancien au plus récent), à partir des résultats enregistrés.
 * Pour un match déjà joué (`ref`), seuls les résultats antérieurs comptent.
 */
export function teamForm(team: string, matches: MatchRow[], ref?: MatchRow, n = 5): TeamForm {
  const k = teamKey(team);
  const games = finishedOnly(matches)
    .filter(
      (m) =>
        (teamKey(m.home_team) === k || teamKey(m.away_team) === k) &&
        m.key !== ref?.key &&
        (!ref || ref.status !== "finished" || m.updated_at < ref.updated_at),
    )
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(-n);
  const out: TeamForm = { team, form: [], played: games.length, goalsFor: 0, goalsAgainst: 0 };
  for (const g of games) {
    const home = teamKey(g.home_team) === k;
    const gf = home ? g.home_score! : g.away_score!;
    const ga = home ? g.away_score! : g.home_score!;
    out.goalsFor += gf;
    out.goalsAgainst += ga;
    out.form.push(gf > ga ? "V" : gf === ga ? "N" : "D");
  }
  return out;
}

export function headToHead(home: string, away: string, matches: MatchRow[], n = 5): MatchRow[] {
  const h = teamKey(home);
  const a = teamKey(away);
  return finishedOnly(matches)
    .filter((m) => {
      const mh = teamKey(m.home_team);
      const ma = teamKey(m.away_team);
      return (mh === h && ma === a) || (mh === a && ma === h);
    })
    .sort((x, y) => y.updated_at.localeCompare(x.updated_at))
    .slice(0, n);
}

export interface TableRow {
  team: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
  form: FormLetter[];
}

/**
 * Classement recalculé à partir des résultats de la saison en cours
 * (quand le site n'affiche pas son propre classement).
 */
export function computeTable(matches: MatchRow[], league?: string): TableRow[] {
  let games = finishedOnly(matches).filter((m) => !league || m.league === league);
  games.sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at));
  // Nouvelle saison virtuelle quand la journée repart de zéro
  let start = 0;
  for (let i = 1; i < games.length; i++) {
    const prev = games[i - 1].round;
    const cur = games[i].round;
    if (prev != null && cur != null && cur < prev - 5) start = i;
  }
  games = games.slice(start);
  const rows = new Map<string, TableRow>();
  const row = (team: string) => {
    const k = teamKey(team);
    if (!rows.has(k)) rows.set(k, { team, position: 0, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0, form: [] });
    return rows.get(k)!;
  };
  for (const g of games) {
    const h = row(g.home_team);
    const a = row(g.away_team);
    const hs = g.home_score!;
    const as = g.away_score!;
    h.played++;
    a.played++;
    h.goals_for += hs;
    h.goals_against += as;
    a.goals_for += as;
    a.goals_against += hs;
    if (hs > as) {
      h.won++;
      a.lost++;
      h.points += 3;
      h.form.push("V");
      a.form.push("D");
    } else if (hs < as) {
      a.won++;
      h.lost++;
      a.points += 3;
      a.form.push("V");
      h.form.push("D");
    } else {
      h.drawn++;
      a.drawn++;
      h.points++;
      a.points++;
      h.form.push("N");
      a.form.push("N");
    }
  }
  const list = [...rows.values()].sort(
    (x, y) => y.points - x.points || y.goals_for - y.goals_against - (x.goals_for - x.goals_against) || y.goals_for - x.goals_for || x.team.localeCompare(y.team),
  );
  list.forEach((r, i) => {
    r.position = i + 1;
    r.form = r.form.slice(-5);
  });
  return list;
}

export const pct = (p: number) => `${Math.round(p * 100)} %`;
